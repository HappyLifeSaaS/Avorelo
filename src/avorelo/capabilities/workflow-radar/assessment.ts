import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  buildContextEfficiencyBrief,
  loadLatestContextEfficiencyBrief,
  type ContextEfficiencyBrief,
} from "../context-efficiency/index.ts";
import {
  buildModelRoutingInputProfile,
  loadLatestModelRoutingInputProfile,
  type ModelRoutingInputProfile,
} from "../model-routing-input/index.ts";
import { loadLatestProofReport } from "../proof-report/index.ts";
import { listReceipts } from "../../kernel/receipts/index.ts";
import { buildCapabilityRouteDecision, detectProposalHints } from "../../kernel/work-controls/index.ts";

import {
  actualWorkModeFromFlags,
  isAuthOrDashboardSensitivePath,
  isProductionSensitivePath,
  maxRisk,
  modelRoutingModeIsConsistent,
  pathIsInExpectedScope,
  unique,
  workflowRadarDecisionStateIsReady,
} from "./policy.ts";
import { writeWorkflowRadarAssessment } from "./persistence.ts";
import { buildWorkflowRadarSignals, readWorkflowRadarChangedPaths } from "./signals.ts";
import type {
  WorkflowRadarAssessment,
  WorkflowRadarChangedPath,
  WorkflowRadarDecisionState,
  WorkflowRadarPathCheck,
  WorkflowRadarRecommendedNextAction,
  WorkflowRadarRiskLevel,
  WorkflowRadarValidationCommand,
} from "./types.ts";
import { classifyPathForContextEfficiency } from "../context-efficiency/workspace-map-compat.ts";

export type BuildWorkflowRadarAssessmentInput = {
  dir: string;
  task?: string;
  fromContextBrief?: boolean;
  fromModelRoute?: boolean;
  generatedAt?: string;
};

type ResolvedSources = {
  taskSource: WorkflowRadarAssessment["taskSource"];
  objectiveSummary: string;
  contextBrief: ContextEfficiencyBrief | null;
  contextBriefSource: WorkflowRadarAssessment["contextBrief"]["source"];
  modelProfile: ModelRoutingInputProfile | null;
  modelProfileSource: WorkflowRadarAssessment["modelRouting"]["source"];
};

function defaultValidationCommands(dir: string, changedPaths: WorkflowRadarChangedPath[]): WorkflowRadarValidationCommand[] {
  const commands: WorkflowRadarValidationCommand[] = [
    { command: "git diff --check", reason: "Detect patch hygiene issues before staging." },
  ];
  const touchesCode = changedPaths.some((item) =>
    item.path.startsWith("src/") ||
    item.path.startsWith("tests/") ||
    item.tags.includes("capability_source") ||
    item.path.endsWith(".ts") ||
    item.path.endsWith(".js")
  );
  const touchesPublicWeb = changedPaths.some((item) => item.tags.includes("public_web_source") || item.path.endsWith(".html"));

  if (touchesCode) {
    commands.push({ command: "npm run build", reason: "Keep the CLI bundle and capability entrypoints healthy." });
    commands.push({ command: "npm run naming-check", reason: "Preserve repo naming and boundary invariants." });
  }
  if (touchesPublicWeb) {
    commands.push({ command: "npm run build:site", reason: "Regenerate canonical public-web output from source files." });
    commands.push({ command: "npm run site:check", reason: "Verify static public-web health after source changes." });
  }
  if (existsSync(join(dir, "tests", "workflow-radar.test.ts"))) {
    commands.push({ command: "node --test tests/workflow-radar.test.ts", reason: "Run focused Workflow Radar coverage." });
  }
  if (existsSync(join(dir, "tests", "workflow-radar-cli.test.ts"))) {
    commands.push({ command: "node --test tests/workflow-radar-cli.test.ts", reason: "Verify CLI surface behavior for Workflow Radar." });
  }

  return unique(commands.map((item) => item.command)).map((command) => commands.find((item) => item.command === command)!);
}

function fallbackWorkControls(objectiveSummary: string, changedPaths: WorkflowRadarChangedPath[]) {
  const proposalHints = detectProposalHints(objectiveSummary, changedPaths.map((item) => item.path));
  const riskLevel = changedPaths.reduce<WorkflowRadarRiskLevel>((risk, item) => maxRisk(risk, item.riskLevel), "low");
  const decision = buildCapabilityRouteDecision({
    taskType: "workflow_radar",
    riskClass: riskLevel,
    proofTier: changedPaths.length > 0 ? "tests" : "local",
    approvalPolicy: changedPaths.some((item) => item.classification.releaseOwned || item.classification.productionSensitive)
      ? "blocked"
      : changedPaths.some((item) => item.classification.billingSensitive || item.classification.secretSensitive || item.classification.authOrDashboardSensitive)
      ? "require_manual_review"
      : "require_confirmation",
    proposalHints,
    touchedLayers: changedPaths.map((item) => item.path),
    paymentTouched: changedPaths.some((item) => item.classification.billingSensitive),
    authTouched: changedPaths.some((item) => item.classification.authOrDashboardSensitive),
    dashboardTouched: changedPaths.some((item) => item.classification.authOrDashboardSensitive),
    publicCopyTouched: changedPaths.some((item) => item.tags.includes("public_web_source")),
    contextBudgetRemaining: 40,
    tokenBudgetRemaining: 20_000,
  });

  return {
    selectedCapabilities: decision.selectedCapabilities,
    expectedEvidence: decision.expectedEvidence,
    reasonCodes: decision.reasonCodes,
    requiresApproval: decision.requiredApprovals.length > 0,
  };
}

function resolveSources(input: BuildWorkflowRadarAssessmentInput): ResolvedSources {
  if (input.fromContextBrief && input.fromModelRoute) {
    throw new Error("Choose either --from-context-brief or --from-model-route, not both.");
  }

  const latestBrief = loadLatestContextEfficiencyBrief(input.dir);
  const latestProfile = loadLatestModelRoutingInputProfile(input.dir);
  const explicitTask = input.task?.trim();

  if (input.fromContextBrief) {
    if (!latestBrief) throw new Error("No context-efficiency brief has been generated yet.");
    return {
      taskSource: "context_efficiency_latest",
      objectiveSummary: latestBrief.objectiveSummary,
      contextBrief: latestBrief,
      contextBriefSource: "latest_brief",
      modelProfile: latestProfile,
      modelProfileSource: latestProfile ? "latest_profile" : "unavailable",
    };
  }

  if (input.fromModelRoute) {
    if (!latestProfile) throw new Error("No model-routing input profile has been generated yet.");
    return {
      taskSource: "model_routing_latest",
      objectiveSummary: latestProfile.objectiveSummary,
      contextBrief: latestBrief,
      contextBriefSource: latestBrief ? "latest_brief" : "unavailable",
      modelProfile: latestProfile,
      modelProfileSource: "latest_profile",
    };
  }

  if (explicitTask) {
    const contextBrief = buildContextEfficiencyBrief({ dir: input.dir, task: explicitTask, generatedAt: input.generatedAt });
    const modelProfile = buildModelRoutingInputProfile({ dir: input.dir, task: explicitTask, generatedAt: input.generatedAt });
    return {
      taskSource: "explicit_task",
      objectiveSummary: contextBrief.objectiveSummary,
      contextBrief,
      contextBriefSource: "explicit_task",
      modelProfile,
      modelProfileSource: "explicit_task",
    };
  }

  if (latestBrief) {
    return {
      taskSource: "context_efficiency_latest",
      objectiveSummary: latestBrief.objectiveSummary,
      contextBrief: latestBrief,
      contextBriefSource: "latest_brief",
      modelProfile: latestProfile,
      modelProfileSource: latestProfile ? "latest_profile" : "unavailable",
    };
  }

  if (latestProfile) {
    return {
      taskSource: "model_routing_latest",
      objectiveSummary: latestProfile.objectiveSummary,
      contextBrief: null,
      contextBriefSource: "unavailable",
      modelProfile: latestProfile,
      modelProfileSource: "latest_profile",
    };
  }

  return {
    taskSource: "fallback",
    objectiveSummary: "No explicit task recorded.",
    contextBrief: null,
    contextBriefSource: "unavailable",
    modelProfile: null,
    modelProfileSource: "unavailable",
  };
}

function proofAndReceiptState(dir: string) {
  const proofReport = loadLatestProofReport(dir);
  const receipts = listReceipts(dir);
  const latestReceipt = receipts.length > 0 ? receipts[receipts.length - 1]! : null;
  return {
    proofReport,
    receipts,
    latestReceiptId: latestReceipt?.receiptId ?? null,
    verifiedCount: proofReport?.sections.verified.length ?? 0,
    proofReportId: proofReport?.reportId ?? null,
  };
}

function buildWarnings(input: {
  contextBriefAvailable: boolean;
  modelProfileAvailable: boolean;
  workspaceMapAvailable: boolean;
  expectedScopeAvailable: boolean;
  validationMissing: boolean;
  evidenceMissing: boolean;
  workModeMismatch: boolean;
}): string[] {
  return unique([
    ...(input.contextBriefAvailable ? [] : ["Context Efficiency brief is missing; Workflow Radar is using conservative scope fallback."]),
    ...(input.modelProfileAvailable ? [] : ["Model Routing Input profile is missing; Workflow Radar is using conservative work-mode fallback."]),
    ...(input.workspaceMapAvailable ? [] : ["Workspace Map is unavailable in this base; fallback path classification is active."]),
    ...(input.expectedScopeAvailable ? [] : ["Expected scope metadata is missing; unexpected-path checks are conservative."]),
    ...(input.validationMissing ? ["Validation metadata is still missing for the current changed paths."] : []),
    ...(input.evidenceMissing ? ["Expected evidence or receipt metadata is still missing for the current changed paths."] : []),
    ...(input.workModeMismatch ? ["Changed paths require a safer work mode than the stored routing profile."] : []),
  ]);
}

function buildSafeNextAction(input: {
  nextAction: WorkflowRadarRecommendedNextAction;
  unexpectedCount: number;
  generatedOutputCount: number;
  runtimeArtifactCount: number;
  validationCommands: WorkflowRadarValidationCommand[];
  expectedEvidence: string[];
}): string {
  switch (input.nextAction) {
    case "continue_work":
      return "Continue in the expected source-of-truth paths and keep validation attached before handoff.";
    case "run_validation":
      return `Run the recommended validation next${input.validationCommands.length > 0 ? ": " + input.validationCommands.slice(0, 3).map((item) => item.command).join(", ") : "."}`;
    case "produce_receipt":
      return `Validation metadata exists, but receipt or evidence metadata is missing. Produce a receipt that covers ${input.expectedEvidence.slice(0, 3).join(", ") || "the expected evidence"}.`;
    case "summarize_and_handoff":
      return "No risky drift signals are active. Summarize the current state and hand off the bounded next step.";
    case "ask_for_decision":
      return input.runtimeArtifactCount > 0
        ? `Changed paths drifted outside the expected scope (${input.unexpectedCount}) or touched non-source paths (generated=${input.generatedOutputCount}, runtime=${input.runtimeArtifactCount}). Keep runtime artifacts local-only and ask for a scope decision before continuing.`
        : `Changed paths drifted outside the expected scope (${input.unexpectedCount}) or touched non-source paths (generated=${input.generatedOutputCount}, runtime=${input.runtimeArtifactCount}). Ask for a scope decision before continuing.`;
    case "switch_to_guarded_mode":
      return input.runtimeArtifactCount > 0
        ? "Keep the task in reviewed source-of-truth paths, keep runtime artifacts local-only, require human review, and use a guarded work mode before trusting the result."
        : "Keep the task in reviewed source-of-truth paths, require human review, and use a guarded work mode before trusting the result.";
    case "stop_and_review":
      return "Stop editing and review the blocked or production-sensitive path set before any further work.";
    default:
      return "Workflow Radar could not assess the session from available metadata.";
  }
}

function buildDecisionState(input: {
  gitAvailable: boolean;
  changedPaths: WorkflowRadarChangedPath[];
  blocked: boolean;
  needsReview: boolean;
  driftDetected: boolean;
  needsEvidence: boolean;
  warnings: string[];
}): WorkflowRadarDecisionState {
  if (!input.gitAvailable) return "UNAVAILABLE";
  if (input.blocked) return "BLOCKED";
  if (input.needsReview) return "NEEDS_REVIEW";
  if (input.driftDetected) return "DRIFT_DETECTED";
  if (input.needsEvidence) return "NEEDS_EVIDENCE";
  if (input.changedPaths.length === 0 && input.warnings.length === 0) return "ON_TRACK";
  if (input.warnings.length > 0) return "ON_TRACK_WITH_WARNINGS";
  return "ON_TRACK";
}

function buildRecommendedNextAction(input: {
  gitAvailable: boolean;
  blocked: boolean;
  needsReview: boolean;
  driftDetected: boolean;
  validationMissing: boolean;
  evidenceMissing: boolean;
  changedCount: number;
  workModeMismatch: boolean;
}): WorkflowRadarRecommendedNextAction {
  if (!input.gitAvailable) return "unavailable";
  if (input.blocked) return "stop_and_review";
  if (input.needsReview || input.workModeMismatch) return "switch_to_guarded_mode";
  if (input.driftDetected) return "ask_for_decision";
  if (input.validationMissing) return "run_validation";
  if (input.evidenceMissing) return "produce_receipt";
  if (input.changedCount === 0) return "summarize_and_handoff";
  return "continue_work";
}

function countWhere(items: WorkflowRadarChangedPath[], predicate: (item: WorkflowRadarChangedPath) => boolean): number {
  return items.filter(predicate).length;
}

function isBenignLocalArtifact(path: string): boolean {
  const normalizedPath = path.replace(/\\/g, "/").toLowerCase();
  return (
    normalizedPath.startsWith(".avorelo/context-efficiency/") ||
    normalizedPath.startsWith(".avorelo/model-routing/") ||
    normalizedPath.startsWith(".avorelo/workflow-radar/") ||
    normalizedPath.startsWith(".avorelo/reports/") ||
    normalizedPath.startsWith(".avorelo/receipts/")
  );
}

export function buildWorkflowRadarAssessment(input: BuildWorkflowRadarAssessmentInput): WorkflowRadarAssessment {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const resolved = resolveSources({ ...input, generatedAt });
  const expectedScopePaths = resolved.contextBrief
    ? unique([...resolved.contextBrief.sourceOfTruthPaths, ...resolved.contextBrief.repoAreas])
    : [];
  const git = readWorkflowRadarChangedPaths(input.dir, expectedScopePaths);
  const changedPaths = git.items;
  const proof = proofAndReceiptState(input.dir);

  const workspaceMapAvailable = resolved.contextBrief?.workspaceMapCompatibility.workspaceMapAvailable
    ?? resolved.modelProfile?.workspaceMap.available
    ?? false;
  const workspaceMapProvider = resolved.contextBrief?.workspaceMapCompatibility.provider
    ?? resolved.modelProfile?.workspaceMap.provider
    ?? "fallback_path_rules_v1";
  const workspaceMapNotes = resolved.contextBrief?.workspaceMapCompatibility.notes
    ?? resolved.modelProfile?.workspaceMap.notes
    ?? ["Workflow Radar is using conservative path classification fallback."];
  const expectedScopeAvailable = expectedScopePaths.length > 0;

  const workControls = resolved.modelProfile
    ? {
        selectedCapabilities: resolved.modelProfile.workControls.selectedCapabilities,
        expectedEvidence: resolved.modelProfile.workControls.expectedEvidence,
        reasonCodes: resolved.modelProfile.workControls.reasonCodes,
        requiresApproval: resolved.modelProfile.workControls.requiresApproval,
      }
    : resolved.contextBrief
    ? {
        selectedCapabilities: resolved.contextBrief.workControls.selectedCapabilities,
        expectedEvidence: resolved.contextBrief.workControls.expectedEvidence,
        reasonCodes: resolved.contextBrief.workControls.reasonCodes,
        requiresApproval: resolved.contextBrief.decisionState === "NEEDS_REVIEW" || resolved.contextBrief.decisionState === "BLOCKED",
      }
    : fallbackWorkControls(resolved.objectiveSummary, changedPaths);

  const expectedEvidence = unique([
    ...(resolved.contextBrief?.expectedEvidence.map((item) => item.key) ?? []),
    ...(resolved.modelProfile?.evidenceRequirements ?? []),
    ...workControls.expectedEvidence,
  ]);

  const validationCommands = resolved.modelProfile?.recommendedValidation.commands
    ?? resolved.contextBrief?.validation.commands
    ?? defaultValidationCommands(input.dir, changedPaths);
  const actionableChangedPaths = changedPaths.filter((item) => !isBenignLocalArtifact(item.path));

  const needsValidation = actionableChangedPaths.some((item) =>
    item.tags.includes("capability_source") ||
    item.tags.includes("public_web_source") ||
    item.path.startsWith("tests/") ||
    item.path.endsWith(".ts") ||
    item.path.endsWith(".js") ||
    item.path.endsWith(".html")
  );
  const validationMissing = actionableChangedPaths.length > 0 && needsValidation && proof.verifiedCount === 0;
  const evidenceMissing = actionableChangedPaths.length > 0 && expectedEvidence.length > 0 && proof.receipts.length === 0 && proof.verifiedCount > 0;

  const unexpectedCount = expectedScopeAvailable
    ? countWhere(actionableChangedPaths, (item) => !item.inExpectedScope && !item.classification.generatedOutput && !item.classification.runtimeArtifact)
    : 0;
  const generatedOutputCount = countWhere(actionableChangedPaths, (item) => item.classification.generatedOutput);
  const runtimeArtifactCount = countWhere(actionableChangedPaths, (item) => item.classification.runtimeArtifact);
  const releaseOwnedCount = countWhere(actionableChangedPaths, (item) => item.classification.releaseOwned);
  const productionSensitiveCount = countWhere(actionableChangedPaths, (item) => item.classification.productionSensitive);
  const billingSensitiveCount = countWhere(actionableChangedPaths, (item) => item.classification.billingSensitive);
  const secretSensitiveCount = countWhere(actionableChangedPaths, (item) => item.classification.secretSensitive);
  const authOrDashboardSensitiveCount = countWhere(actionableChangedPaths, (item) => item.classification.authOrDashboardSensitive);

  const blocked = releaseOwnedCount > 0 || productionSensitiveCount > 0 || resolved.modelProfile?.recommendedMode === "blocked_needs_decision";
  const humanReviewRequired = blocked || billingSensitiveCount > 0 || secretSensitiveCount > 0 || authOrDashboardSensitiveCount > 0 || resolved.modelProfile?.recommendedMode === "human_review_required";
  const actualRequiredMode = actualWorkModeFromFlags({
    blocked,
    review: humanReviewRequired,
    guarded: unexpectedCount > 0 || generatedOutputCount > 0 || runtimeArtifactCount > 0 || validationMissing || evidenceMissing,
    changedCount: actionableChangedPaths.length,
  });
  const modeConsistent = resolved.modelProfile?.recommendedMode
    ? modelRoutingModeIsConsistent(resolved.modelProfile.recommendedMode, actualRequiredMode)
    : null;
  const workModeMismatch = modeConsistent === false;

  const driftDetected = unexpectedCount > 0 || generatedOutputCount > 0 || runtimeArtifactCount > 0;
  const warnings = buildWarnings({
    contextBriefAvailable: resolved.contextBrief !== null,
    modelProfileAvailable: resolved.modelProfile !== null,
    workspaceMapAvailable,
    expectedScopeAvailable,
    validationMissing,
    evidenceMissing,
    workModeMismatch,
  });
  const needsReview = !blocked && humanReviewRequired;
  const needsEvidence = !blocked && !needsReview && (validationMissing || evidenceMissing);
  const decisionState = buildDecisionState({
    gitAvailable: git.available,
    changedPaths,
    blocked,
    needsReview,
    driftDetected,
    needsEvidence,
    warnings,
  });
  const recommendedNextAction = buildRecommendedNextAction({
    gitAvailable: git.available,
    blocked,
    needsReview,
    driftDetected,
    validationMissing,
    evidenceMissing,
    changedCount: actionableChangedPaths.length,
    workModeMismatch,
  });
  const safeNextAction = buildSafeNextAction({
    nextAction: recommendedNextAction,
    unexpectedCount,
    generatedOutputCount,
    runtimeArtifactCount,
    validationCommands,
    expectedEvidence,
  });

  let riskLevel = changedPaths.reduce<WorkflowRadarRiskLevel>((risk, item) => maxRisk(risk, item.riskLevel), "low");
  if (validationMissing || evidenceMissing) riskLevel = maxRisk(riskLevel, "medium");
  if (driftDetected || workModeMismatch) riskLevel = maxRisk(riskLevel, "high");
  if (humanReviewRequired) riskLevel = maxRisk(riskLevel, "high");
  if (blocked) riskLevel = "critical";

  const signals = buildWorkflowRadarSignals({
    contextBriefAvailable: resolved.contextBrief !== null,
    modelRoutingProfileAvailable: resolved.modelProfile !== null,
    workspaceMapAvailable,
    expectedScopeAvailable,
    changedPaths,
    validationMissing,
    evidenceMissing,
    workModeMismatch,
    humanReviewRequired,
  });

  return {
    contract: "avorelo.workflowRadar.v1",
    schemaVersion: 1,
    capabilityKey: "workflow-radar",
    capabilityName: "Workflow Radar",
    generatedAt,
    repoRoot: input.dir,
    taskSource: resolved.taskSource,
    objectiveSummary: resolved.objectiveSummary,
    decisionState,
    riskLevel,
    recommendedNextAction,
    safeNextAction,
    onTrack: workflowRadarDecisionStateIsReady(decisionState),
    scopeDriftDetected: driftDetected,
    humanReviewRequired,
    contextBrief: {
      available: resolved.contextBrief !== null,
      source: resolved.contextBriefSource,
      decisionState: resolved.contextBrief?.decisionState ?? null,
      workType: resolved.contextBrief?.workType ?? "unknown",
      repoAreas: resolved.contextBrief?.repoAreas ?? [],
      sourceOfTruthPaths: resolved.contextBrief?.sourceOfTruthPaths ?? [],
    },
    modelRouting: {
      available: resolved.modelProfile !== null,
      source: resolved.modelProfileSource,
      recommendedMode: resolved.modelProfile?.recommendedMode ?? null,
      actualRequiredMode,
      modeConsistent,
      reasonCodes: resolved.modelProfile?.reasonCodes ?? [],
    },
    workspaceMap: {
      available: workspaceMapAvailable,
      provider: workspaceMapProvider,
      notes: workspaceMapNotes,
    },
    expectedScope: {
      available: expectedScopeAvailable,
      source: resolved.contextBrief ? "context_efficiency" : "fallback",
      repoAreas: resolved.contextBrief?.repoAreas ?? [],
      sourceOfTruthPaths: resolved.contextBrief?.sourceOfTruthPaths ?? [],
      blockedAreas: resolved.contextBrief?.blockedAreas ?? [],
    },
    workControls,
    changedPaths: {
      totalCount: changedPaths.length,
      stagedCount: countWhere(changedPaths, (item) => item.staged),
      unstagedCount: countWhere(changedPaths, (item) => item.unstaged),
      untrackedCount: countWhere(changedPaths, (item) => item.status === "untracked"),
      deletedCount: countWhere(changedPaths, (item) => item.status === "deleted"),
      unexpectedCount,
      generatedOutputCount,
      runtimeArtifactCount,
      releaseOwnedCount,
      productionSensitiveCount,
      billingSensitiveCount,
      secretSensitiveCount,
      authOrDashboardSensitiveCount,
      items: changedPaths,
    },
    validation: {
      expectedCommands: validationCommands,
      missing: validationMissing,
      proofReportAvailable: proof.proofReport !== null,
      verifiedCount: proof.verifiedCount,
    },
    evidence: {
      expectedKeys: expectedEvidence,
      missing: evidenceMissing,
      receiptCount: proof.receipts.length,
      latestReceiptId: proof.latestReceiptId,
      proofReportId: proof.proofReportId,
    },
    signals,
    warnings,
    reasonCodes: unique(signals.map((signal) => signal.reasonCode)),
    containsRawSource: false,
    containsRawPrompt: false,
    containsRawDiff: false,
    containsRawSecret: false,
    containsRawEnvValue: false,
    containsRawTerminalOutput: false,
    containsRawCustomerData: false,
    containsRawScreenshot: false,
    containsProviderPayload: false,
    contentStorageClass: "safe_metadata_only",
  };
}

export function buildAndPersistWorkflowRadarAssessment(input: BuildWorkflowRadarAssessmentInput): { assessment: WorkflowRadarAssessment; path: string } {
  const assessment = buildWorkflowRadarAssessment(input);
  const path = writeWorkflowRadarAssessment(input.dir, assessment);
  return { assessment, path };
}

export function buildWorkflowRadarPathCheck(dir: string, inputPath: string, generatedAt = new Date().toISOString()): WorkflowRadarPathCheck {
  const latestBrief = loadLatestContextEfficiencyBrief(dir);
  const latestProfile = loadLatestModelRoutingInputProfile(dir);
  const classification = classifyPathForContextEfficiency(dir, inputPath);
  const normalizedPath = classification.normalizedPath || inputPath;
  const expectedScopePaths = latestBrief ? unique([...latestBrief.sourceOfTruthPaths, ...latestBrief.repoAreas]) : [];
  const expectedScopeAvailable = expectedScopePaths.length > 0;
  const inExpectedScope = expectedScopeAvailable ? pathIsInExpectedScope(normalizedPath, expectedScopePaths) : null;
  const authOrDashboardSensitive = classification.dashboardSurface || isAuthOrDashboardSensitivePath(normalizedPath);
  const productionSensitive = classification.releaseOwned || isProductionSensitivePath(normalizedPath);
  const actualRequiredMode = actualWorkModeFromFlags({
    blocked: classification.releaseOwned || productionSensitive,
    review: classification.billingSensitive || classification.secretSensitive || authOrDashboardSensitive,
    guarded: classification.generatedOutput || classification.runtimeArtifact || (inExpectedScope === false),
    changedCount: 1,
  });
  const modeConsistent = latestProfile?.recommendedMode
    ? modelRoutingModeIsConsistent(latestProfile.recommendedMode, actualRequiredMode)
    : null;
  const workModeMismatch = modeConsistent === false;

  let decisionState: WorkflowRadarDecisionState;
  if (!normalizedPath) {
    decisionState = "UNAVAILABLE";
  } else if (classification.releaseOwned || productionSensitive) {
    decisionState = "BLOCKED";
  } else if (classification.billingSensitive || classification.secretSensitive || authOrDashboardSensitive) {
    decisionState = "NEEDS_REVIEW";
  } else if (classification.generatedOutput || classification.runtimeArtifact || inExpectedScope === false) {
    decisionState = "DRIFT_DETECTED";
  } else if (workModeMismatch || !latestBrief || !latestProfile) {
    decisionState = "ON_TRACK_WITH_WARNINGS";
  } else {
    decisionState = "ON_TRACK";
  }

  const recommendedNextAction: WorkflowRadarRecommendedNextAction =
    decisionState === "BLOCKED"
      ? "stop_and_review"
      : decisionState === "NEEDS_REVIEW"
      ? "switch_to_guarded_mode"
      : decisionState === "DRIFT_DETECTED"
      ? "ask_for_decision"
      : decisionState === "UNAVAILABLE"
      ? "unavailable"
      : "continue_work";

  const warnings = unique([
    ...(latestBrief ? [] : ["Context Efficiency brief is missing; expected scope is conservative."]),
    ...(latestProfile ? [] : ["Model Routing Input profile is missing; work-mode check is conservative."]),
    ...(workModeMismatch ? ["The stored routing profile is less strict than this path requires."] : []),
  ]);

  const summary =
    decisionState === "BLOCKED"
      ? "This path is release-owned or production-sensitive and is out of scope for normal AI work."
      : decisionState === "NEEDS_REVIEW"
      ? "This path requires guarded handling and human review before trust or merge."
      : decisionState === "DRIFT_DETECTED"
      ? "This path sits outside the expected source-of-truth lane for the current work."
      : decisionState === "UNAVAILABLE"
      ? "Workflow Radar could not classify this path from available metadata."
      : "This path fits the current bounded workflow expectations.";

  const safeNextAction =
    recommendedNextAction === "stop_and_review"
      ? "Stay out of this path and review the blocked ownership boundary before continuing."
      : recommendedNextAction === "switch_to_guarded_mode"
      ? "Keep the task scoped, require review, and avoid trusting this path without validation and evidence."
      : recommendedNextAction === "ask_for_decision"
      ? "Return to the expected source-of-truth path or ask for a scope decision before continuing."
      : recommendedNextAction === "continue_work"
      ? "Continue in the bounded source-of-truth path and keep validation attached before handoff."
      : "Workflow Radar could not recommend a safe next action for this path.";

  const signalTypes = unique([
    ...(latestBrief ? ["context_brief_available" as const, "expected_scope_available" as const] : []),
    ...(latestProfile ? ["model_routing_profile_available" as const] : []),
    ...(classification.generatedOutput ? ["generated_output_touched" as const] : []),
    ...(classification.runtimeArtifact ? ["runtime_artifact_touched" as const] : []),
    ...(classification.releaseOwned ? ["release_owned_path_touched" as const] : []),
    ...(productionSensitive ? ["production_sensitive_path_touched" as const] : []),
    ...(classification.billingSensitive ? ["billing_sensitive_path_touched" as const] : []),
    ...(classification.secretSensitive ? ["secret_sensitive_path_touched" as const] : []),
    ...(workModeMismatch ? ["work_mode_mismatch" as const] : []),
    ...((classification.billingSensitive || classification.secretSensitive || authOrDashboardSensitive) ? ["human_review_required" as const] : []),
    "safe_metadata_only" as const,
  ]);

  let riskLevel = classification.riskLevel;
  if (classification.generatedOutput || classification.runtimeArtifact || inExpectedScope === false) {
    riskLevel = maxRisk(riskLevel, "medium");
  }
  if (classification.billingSensitive || authOrDashboardSensitive) {
    riskLevel = maxRisk(riskLevel, "high");
  }
  if (classification.secretSensitive || classification.releaseOwned || productionSensitive) {
    riskLevel = "critical";
  }

  return {
    contract: "avorelo.workflowRadarPathCheck.v1",
    schemaVersion: 1,
    generatedAt,
    repoRoot: dir,
    inputPath,
    normalizedPath,
    decisionState,
    riskLevel,
    recommendedNextAction,
    safeNextAction,
    expectedScopeAvailable,
    inExpectedScope,
    expectedMode: latestProfile?.recommendedMode ?? null,
    actualRequiredMode,
    modeConsistent,
    summary,
    workTypeHints: classification.workTypeHints,
    tags: unique([
      ...classification.tags,
      ...(authOrDashboardSensitive ? ["auth_or_dashboard_sensitive"] : []),
      ...(productionSensitive ? ["production_sensitive"] : []),
    ]),
    signalTypes,
    warnings,
    reasonCodes: unique([
      ...(classification.generatedOutput ? ["WORKFLOW_RADAR_GENERATED_OUTPUT_TOUCH"] : []),
      ...(classification.runtimeArtifact ? ["WORKFLOW_RADAR_RUNTIME_ARTIFACT_TOUCH"] : []),
      ...(classification.releaseOwned ? ["WORKFLOW_RADAR_RELEASE_SCOPE_BLOCKED"] : []),
      ...(productionSensitive ? ["WORKFLOW_RADAR_PRODUCTION_SCOPE_BLOCKED"] : []),
      ...(classification.billingSensitive ? ["WORKFLOW_RADAR_BILLING_SCOPE_REVIEW"] : []),
      ...(classification.secretSensitive ? ["WORKFLOW_RADAR_SECRET_SCOPE_REVIEW"] : []),
      ...(workModeMismatch ? ["WORKFLOW_RADAR_WORK_MODE_MISMATCH"] : []),
      "WORKFLOW_RADAR_SAFE_METADATA_ONLY",
    ]),
    containsRawSource: false,
    containsRawPrompt: false,
    containsRawDiff: false,
    containsRawSecret: false,
    containsRawEnvValue: false,
    containsRawTerminalOutput: false,
    containsRawCustomerData: false,
    containsRawScreenshot: false,
    containsProviderPayload: false,
    contentStorageClass: "safe_metadata_only",
  };
}

export { workflowRadarDecisionStateIsReady } from "./policy.ts";
