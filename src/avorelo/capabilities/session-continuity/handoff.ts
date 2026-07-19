import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import {
  buildAndPersistWorkflowRadarAssessment,
  buildWorkflowRadarPathCheck,
  loadLatestWorkflowRadarAssessment,
  type WorkflowRadarAssessment,
} from "../workflow-radar/index.ts";
import { loadLatestContextEfficiencyBrief, latestContextEfficiencyBriefPath } from "../context-efficiency/index.ts";
import { loadLatestModelRoutingInputProfile, latestModelRoutingInputProfilePath } from "../model-routing-input/index.ts";
import { loadLatestProofReport } from "../proof-report/index.ts";
import { listReceipts } from "../../kernel/receipts/index.ts";
import { latestWorkflowRadarPath } from "../workflow-radar/persistence.ts";

import {
  categoryFromChangedPath,
  decisionStateIsReady,
  inferContinuationMode,
  inferDecisionState,
  inferDependency,
  inferRecommendedNextAction,
  inferStage,
  inferWorkstreamName,
  mapChangedPath,
  safeToContinue,
  unique,
} from "./policy.ts";
import { writeSessionContinuityHandoff } from "./persistence.ts";
import { buildSessionContinuitySignals } from "./signals.ts";
import type {
  SessionContinuityArtifactSource,
  SessionContinuityChangedPath,
  SessionContinuityHandoff,
  SessionContinuityPathCheck,
} from "./types.ts";

export type BuildSessionContinuityHandoffInput = {
  dir: string;
  task?: string;
  fromWorkflowRadar?: boolean;
  generatedAt?: string;
};

type ResolvedWorkflowRadar = {
  assessment: WorkflowRadarAssessment | null;
  source: SessionContinuityHandoff["workflowRadar"]["source"];
};

function gitOutput(dir: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    }).trim();
  } catch {
    return null;
  }
}

function loadWorkspaceMapArtifact(dir: string): { available: boolean; provider: string; notes: string[]; path: string | null } {
  const path = join(dir, ".avorelo", "workspace-map", "latest.json");
  if (!existsSync(path)) {
    return {
      available: false,
      provider: "fallback_path_rules_v1",
      notes: ["Workspace Map is unavailable in this base; Session Continuity is using conservative path metadata from upstream capabilities."],
      path: null,
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { provider?: string; notes?: string[] };
    return {
      available: true,
      provider: parsed.provider ?? "workspace_map_latest",
      notes: parsed.notes ?? ["Workspace Map metadata is available."],
      path,
    };
  } catch {
    return {
      available: false,
      provider: "fallback_path_rules_v1",
      notes: ["Workspace Map artifact exists but could not be read safely; conservative fallback is active."],
      path,
    };
  }
}

function resolveWorkflowRadar(input: BuildSessionContinuityHandoffInput): ResolvedWorkflowRadar {
  const latest = loadLatestWorkflowRadarAssessment(input.dir);
  if (input.fromWorkflowRadar) {
    if (!latest) throw new Error("No workflow radar assessment has been generated yet.");
    return { assessment: latest, source: "latest_assessment" };
  }
  if (latest && !input.task) {
    return { assessment: latest, source: "latest_assessment" };
  }
  const built = buildAndPersistWorkflowRadarAssessment({ dir: input.dir, task: input.task, generatedAt: input.generatedAt });
  return { assessment: built.assessment, source: "generated_fallback" };
}

function primaryRelevantPaths(paths: SessionContinuityChangedPath[], fallback: string[]): string[] {
  const safeChanged = paths
    .filter((item) => item.category === "safe_source" && item.inExpectedScope)
    .map((item) => item.path);
  if (safeChanged.length > 0) return unique(safeChanged).slice(0, 6);
  return unique(fallback).slice(0, 6);
}

function buildDoNotTouch(input: {
  changedPaths: SessionContinuityChangedPath[];
  blockedAreas: string[];
  generatedOutputPaths: string[];
  runtimeArtifactPaths: string[];
}): string[] {
  return unique([
    ...input.changedPaths
      .filter((item) =>
        item.category !== "safe_source" ||
        item.authOrDashboardSensitive,
      )
      .map((item) => item.path),
    ...input.blockedAreas,
    ...input.generatedOutputPaths,
    ...input.runtimeArtifactPaths,
  ]).slice(0, 14);
}

function buildArtifactSources(input: {
  dir: string;
  workflowRadar: ResolvedWorkflowRadar;
  workspaceMap: ReturnType<typeof loadWorkspaceMapArtifact>;
  proofReportId: string | null;
  receiptCount: number;
}): SessionContinuityArtifactSource[] {
  const contextPath = latestContextEfficiencyBriefPath(input.dir);
  const modelPath = latestModelRoutingInputProfilePath(input.dir);
  const workflowPath = latestWorkflowRadarPath(input.dir);
  return [
    {
      key: "context_efficiency",
      label: "Context Efficiency brief",
      available: existsSync(contextPath),
      path: existsSync(contextPath) ? contextPath : null,
      source: existsSync(contextPath) ? "latest_artifact" : "unavailable",
      notes: existsSync(contextPath) ? [] : ["Context Efficiency brief is missing."],
    },
    {
      key: "model_routing_input",
      label: "Model Routing Input profile",
      available: existsSync(modelPath),
      path: existsSync(modelPath) ? modelPath : null,
      source: existsSync(modelPath) ? "latest_artifact" : "unavailable",
      notes: existsSync(modelPath) ? [] : ["Model Routing Input profile is missing."],
    },
    {
      key: "workflow_radar",
      label: "Workflow Radar assessment",
      available: input.workflowRadar.assessment !== null,
      path: input.workflowRadar.assessment !== null ? workflowPath : null,
      source: input.workflowRadar.source,
      notes: input.workflowRadar.source === "generated_fallback"
        ? ["Workflow Radar was generated conservatively for this handoff."]
        : input.workflowRadar.assessment !== null
        ? []
        : ["Workflow Radar is unavailable."],
    },
    {
      key: "workspace_map",
      label: "Workspace Map metadata",
      available: input.workspaceMap.available,
      path: input.workspaceMap.path,
      source: input.workspaceMap.available ? "latest_artifact" : "unavailable",
      notes: input.workspaceMap.notes,
    },
    {
      key: "receipt_metadata",
      label: "Receipt metadata",
      available: input.receiptCount > 0,
      path: input.receiptCount > 0 ? join(input.dir, ".avorelo", "receipts") : null,
      source: input.receiptCount > 0 ? "latest_artifact" : "unavailable",
      notes: input.receiptCount > 0 ? [] : ["No receipt metadata is available yet."],
    },
    {
      key: "proof_report",
      label: "Proof report metadata",
      available: input.proofReportId !== null,
      path: input.proofReportId !== null ? join(input.dir, ".avorelo", "reports") : null,
      source: input.proofReportId !== null ? "latest_artifact" : "unavailable",
      notes: input.proofReportId !== null ? [] : ["No proof report metadata is available yet."],
    },
    {
      key: "git_metadata",
      label: "Git status metadata",
      available: true,
      path: null,
      source: "git_metadata",
      notes: ["Changed path names, status flags, branch, and worktree were read from git metadata only."],
    },
  ];
}

function buildDependencyNotes(dependency: SessionContinuityHandoff["worktree"]["dependency"]): string[] {
  return unique([
    ...dependency.notes,
    ...(dependency.mustMergeFirst.length > 0
      ? [`Must merge first: ${dependency.mustMergeFirst.join(", ")}.`]
      : []),
    ...(dependency.mustRetargetTo ? [`Retarget or rebase to ${dependency.mustRetargetTo} after dependency merge.`] : []),
  ]);
}

function buildClosureCriteria(input: {
  validationMissing: boolean;
  validationCommands: SessionContinuityHandoff["validation"]["expectedCommands"];
  evidenceMissing: boolean;
  expectedEvidence: string[];
  humanReviewRequired: boolean;
  doNotTouch: string[];
  dependencyNotes: string[];
}): string[] {
  return unique([
    ...(input.validationMissing
      ? [`Run the required validation: ${input.validationCommands.slice(0, 4).map((item) => item.command).join(", ")}.`]
      : ["Keep the attached validation commands green for the changed source paths."]),
    ...(input.evidenceMissing
      ? [`Produce receipt metadata that covers: ${input.expectedEvidence.slice(0, 4).join(", ") || "expected evidence keys"}.`]
      : ["Keep receipt and proof metadata attached to the current workstream."]),
    ...(input.humanReviewRequired
      ? ["Get human review before closing because review-heavy paths were touched."]
      : []),
    ...(input.dependencyNotes.length > 0 ? input.dependencyNotes : []),
    ...(input.doNotTouch.length > 0
      ? [`Keep these paths out of closure scope unless explicitly approved: ${input.doNotTouch.slice(0, 6).join(", ")}.`]
      : []),
    "Do not persist raw source, raw diffs, raw prompts, secrets, env values, terminal output, provider payloads, or full transcripts.",
  ]).slice(0, 8);
}

function buildSafeNextAction(input: {
  recommendedNextAction: SessionContinuityHandoff["recommendedNextAction"];
  validationCommands: SessionContinuityHandoff["validation"]["expectedCommands"];
  expectedEvidence: string[];
  dependencyNotes: string[];
}): string {
  switch (input.recommendedNextAction) {
    case "run_validation":
      return `Run validation next: ${input.validationCommands.slice(0, 3).map((item) => item.command).join(", ") || "validation commands unavailable"}.`;
    case "produce_receipt":
      return `Produce receipt metadata next for ${input.expectedEvidence.slice(0, 3).join(", ") || "the expected evidence keys"}.`;
    case "retarget_or_rebase_after_dependency_merge":
      return input.dependencyNotes[0] ?? "Wait for the dependency branch to merge, then retarget or rebase safely.";
    case "summarize_for_next_session":
      return "Summarize the current safe state and open the next session in the same worktree with the continuation prompt.";
    case "ask_for_decision":
      return "Ask for a scope or review decision before touching the flagged paths.";
    case "stop_and_review":
      return "Stop editing and review the blocked path ownership or release boundary first.";
    case "continue_work":
      return "Continue in the same worktree, starting from the first safe source path and keeping validation attached.";
    default:
      return "Session Continuity could not recommend a safe next action from the available metadata.";
  }
}

function buildContinuationPrompt(input: {
  workstreamName: string;
  branch: string;
  worktreePath: string;
  selectedBase: string | null;
  dependencyNotes: string[];
  safeNextAction: string;
  changedPaths: string[];
  validationMissing: boolean;
  evidenceMissing: boolean;
  doNotTouch: string[];
  closureCriteria: string[];
}): string {
  return [
    `Workstream: ${input.workstreamName}`,
    `Use worktree: ${input.worktreePath}`,
    `Use branch: ${input.branch}`,
    `Selected base: ${input.selectedBase ?? "unknown"}`,
    ...(input.dependencyNotes.length > 0 ? [`Dependency note: ${input.dependencyNotes[0]}`] : []),
    `Safe next action: ${input.safeNextAction}`,
    `Relevant changed paths: ${input.changedPaths.slice(0, 8).join(", ") || "none recorded"}`,
    `Validation gap: ${input.validationMissing ? "yes" : "no"}`,
    `Evidence gap: ${input.evidenceMissing ? "yes" : "no"}`,
    `Do not touch: ${input.doNotTouch.slice(0, 8).join(", ") || "none recorded"}`,
    `Before closure, prove: ${input.closureCriteria.slice(0, 4).join(" | ")}`,
  ].join("\n");
}

function buildPathCheckSummary(
  check: ReturnType<typeof buildWorkflowRadarPathCheck>,
  category: SessionContinuityPathCheck["category"],
): { decisionState: SessionContinuityPathCheck["decisionState"]; continuationMode: SessionContinuityPathCheck["continuationMode"]; recommendedNextAction: SessionContinuityPathCheck["recommendedNextAction"]; summary: string; safeNextAction: string; doNotTouch: boolean; warnings: string[]; reasonCodes: string[] } {
  const unsafe = category !== "safe_source" || check.tags.includes("auth_or_dashboard_sensitive");
  const decisionState =
    check.decisionState === "BLOCKED"
      ? "BLOCKED"
      : check.decisionState === "NEEDS_REVIEW"
      ? "NEEDS_REVIEW"
      : check.decisionState === "DRIFT_DETECTED"
      ? "READY_WITH_WARNINGS"
      : check.decisionState === "UNAVAILABLE"
      ? "UNAVAILABLE"
      : "READY_TO_CONTINUE";
  const continuationMode =
    decisionState === "BLOCKED"
      ? "stop_and_review"
      : decisionState === "NEEDS_REVIEW"
      ? "ask_user_decision"
      : unsafe
      ? "continue_same_worktree"
      : "start_new_session_same_worktree";
  const recommendedNextAction =
    decisionState === "BLOCKED"
      ? "stop_and_review"
      : decisionState === "NEEDS_REVIEW"
      ? "ask_for_decision"
      : unsafe
      ? "summarize_for_next_session"
      : "continue_work";
  return {
    decisionState,
    continuationMode,
    recommendedNextAction,
    summary: check.summary,
    safeNextAction:
      recommendedNextAction === "stop_and_review"
        ? "Keep this path out of scope until the blocked ownership boundary is reviewed."
        : recommendedNextAction === "ask_for_decision"
        ? "Ask for a decision before touching this review-heavy path."
        : unsafe
        ? "Treat this path as a do-not-touch or summarize-only boundary in the handoff."
        : "This path is safe to inspect first in the next session.",
    doNotTouch: unsafe,
    warnings: check.warnings,
    reasonCodes: check.reasonCodes,
  };
}

export function buildSessionContinuityHandoff(input: BuildSessionContinuityHandoffInput): SessionContinuityHandoff {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const repoRoot = gitOutput(input.dir, ["rev-parse", "--show-toplevel"]) ?? input.dir;
  const branch = gitOutput(input.dir, ["branch", "--show-current"]) ?? "unknown";
  const head = gitOutput(input.dir, ["rev-parse", "HEAD"]) ?? "unknown";

  const contextBrief = loadLatestContextEfficiencyBrief(input.dir);
  const modelRouting = loadLatestModelRoutingInputProfile(input.dir);
  const workflowRadar = resolveWorkflowRadar({ ...input, generatedAt });
  const radar = workflowRadar.assessment;
  const workspaceMap = loadWorkspaceMapArtifact(input.dir);
  const receipts = listReceipts(input.dir);
  const proofReport = loadLatestProofReport(input.dir);
  const dependency = inferDependency(input.dir, branch, head);

  const changedItems = radar?.changedPaths.items.map(mapChangedPath) ?? [];
  const validationCommands = (radar?.validation.expectedCommands ?? []).map((item) => ({ command: item.command, reason: item.reason }));
  const relevantChangedPaths = changedItems
    .filter((item) => item.category !== "runtime_artifact")
    .map((item) => item.path);
  const inspectFirst = primaryRelevantPaths(changedItems, radar?.expectedScope.sourceOfTruthPaths ?? contextBrief?.sourceOfTruthPaths ?? []);
  const doNotTouch = buildDoNotTouch({
    changedPaths: changedItems,
    blockedAreas: radar?.expectedScope.blockedAreas ?? contextBrief?.blockedAreas ?? [],
    generatedOutputPaths: contextBrief?.generatedOutputPaths ?? [],
    runtimeArtifactPaths: contextBrief?.runtimeArtifactPaths ?? [],
  });

  const validationMissing = radar?.validation.missing ?? true;
  const evidenceMissing = radar?.evidence.missing ?? (receipts.length === 0);
  const pathReviewRequired = changedItems.some((item) =>
    item.authOrDashboardSensitive ||
    item.category === "billing_sensitive" ||
    item.category === "secret_sensitive" ||
    item.category === "release_owned" ||
    item.category === "production_sensitive",
  );
  const humanReviewRequired = pathReviewRequired;
  const blocked = radar?.decisionState === "BLOCKED";
  const driftDetected = radar?.scopeDriftDetected ?? false;
  const warnings = unique([
    ...(radar?.warnings ?? ["Workflow Radar is unavailable; Session Continuity is using conservative fallback."]),
    ...(workflowRadar.source === "generated_fallback" ? ["Workflow Radar was generated conservatively for this handoff."] : []),
    ...(contextBrief ? [] : ["Context Efficiency brief is missing; inspect source-of-truth paths conservatively."]),
    ...(modelRouting ? [] : ["Model Routing Input profile is missing; work-mode guidance is conservative."]),
    ...(workspaceMap.available ? [] : ["Workspace Map is unavailable; fallback path classification is active."]),
  ]);
  const decisionState = inferDecisionState({
    gitAvailable: radar !== null,
    humanReviewRequired,
    blocked,
    validationMissing,
    evidenceMissing,
    dependencyMergeRequired: dependency.dependencyMergeRequired,
    warnings,
  });
  const continuationMode = inferContinuationMode({
    decisionState,
    dependencyMergeRequired: dependency.dependencyMergeRequired,
    changedCount: relevantChangedPaths.length,
  });
  const recommendedNextAction = inferRecommendedNextAction({
    decisionState,
    dependencyMergeRequired: dependency.dependencyMergeRequired,
    changedCount: relevantChangedPaths.length,
  });
  const dependencyNotes = buildDependencyNotes(dependency);
  const safeNextAction = buildSafeNextAction({
    recommendedNextAction,
    validationCommands,
    expectedEvidence: radar?.evidence.expectedKeys ?? [],
    dependencyNotes,
  });
  const closureCriteria = buildClosureCriteria({
    validationMissing,
    validationCommands,
    evidenceMissing,
    expectedEvidence: radar?.evidence.expectedKeys ?? [],
    humanReviewRequired,
    doNotTouch,
    dependencyNotes,
  });
  const workstreamName = inferWorkstreamName(branch, radar?.objectiveSummary ?? contextBrief?.objectiveSummary ?? "No explicit task recorded.");
  const signals = buildSessionContinuitySignals({
    contextBriefAvailable: contextBrief !== null,
    modelRoutingAvailable: modelRouting !== null,
    workflowRadarAvailable: radar !== null,
    workspaceMapAvailable: workspaceMap.available,
    workControlsAvailable: (radar?.workControls.selectedCapabilities.length ?? 0) > 0,
    receiptMetadataAvailable: receipts.length > 0 || proofReport !== null,
    dependencyBranchDetected: dependency.dependentBranchDetected,
    dependencyMergeRequired: dependency.dependencyMergeRequired,
    changedPaths: relevantChangedPaths,
    validationMissing,
    evidenceMissing,
    driftDetected,
    unsafePaths: changedItems
      .filter((item) => item.category !== "safe_source" || item.authOrDashboardSensitive)
      .map((item) => item.path),
  });
  const continuationPrompt = buildContinuationPrompt({
    workstreamName,
    branch,
    worktreePath: repoRoot,
    selectedBase: dependency.selectedBase,
    dependencyNotes,
    safeNextAction,
    changedPaths: relevantChangedPaths,
    validationMissing,
    evidenceMissing,
    doNotTouch,
    closureCriteria,
  });

  return {
    contract: "avorelo.sessionContinuityHandoff.v1",
    schemaVersion: 1,
    capabilityKey: "session-continuity",
    capabilityName: "Session Continuity",
    generatedAt,
    repoRoot,
    workstreamName,
    taskSummary: radar?.objectiveSummary ?? contextBrief?.objectiveSummary ?? "No explicit task recorded.",
    currentStage: inferStage({
      decisionState,
      continuationMode,
      changedCount: relevantChangedPaths.length,
    }),
    decisionState,
    continuationMode,
    recommendedNextAction,
    safeToContinue: safeToContinue(decisionState),
    safeNextAction,
    worktree: {
      path: repoRoot,
      branch,
      head,
      dependency,
    },
    contextBrief: {
      available: contextBrief !== null,
      source: contextBrief ? "latest_brief" : "unavailable",
      decisionState: contextBrief?.decisionState ?? null,
      workType: contextBrief?.workType ?? radar?.contextBrief.workType ?? "unknown",
      sourceOfTruthPaths: contextBrief?.sourceOfTruthPaths ?? radar?.contextBrief.sourceOfTruthPaths ?? [],
      blockedAreas: contextBrief?.blockedAreas ?? radar?.expectedScope.blockedAreas ?? [],
    },
    modelRouting: {
      available: modelRouting !== null,
      source: modelRouting ? "latest_profile" : "unavailable",
      recommendedMode: modelRouting?.recommendedMode ?? radar?.modelRouting.recommendedMode ?? null,
      actualRequiredMode: radar?.modelRouting.actualRequiredMode ?? null,
      modeConsistent: radar?.modelRouting.modeConsistent ?? null,
    },
    workflowRadar: {
      available: radar !== null,
      source: workflowRadar.source,
      decisionState: radar?.decisionState ?? null,
      recommendedNextAction: radar?.recommendedNextAction ?? null,
      driftDetected,
      humanReviewRequired,
    },
    workspaceMap: {
      available: workspaceMap.available,
      provider: workspaceMap.provider,
      notes: workspaceMap.notes,
    },
    workControls: {
      available: (radar?.workControls.selectedCapabilities.length ?? 0) > 0,
      selectedCapabilities: radar?.workControls.selectedCapabilities ?? contextBrief?.workControls.selectedCapabilities ?? [],
      expectedEvidence: radar?.workControls.expectedEvidence ?? contextBrief?.workControls.expectedEvidence ?? [],
      reasonCodes: radar?.workControls.reasonCodes ?? contextBrief?.workControls.reasonCodes ?? [],
    },
    artifactsUsed: buildArtifactSources({
      dir: input.dir,
      workflowRadar,
      workspaceMap,
      proofReportId: proofReport?.reportId ?? null,
      receiptCount: receipts.length,
    }),
    changedPaths: {
      totalCount: radar?.changedPaths.totalCount ?? 0,
      stagedCount: radar?.changedPaths.stagedCount ?? 0,
      unstagedCount: radar?.changedPaths.unstagedCount ?? 0,
      untrackedCount: radar?.changedPaths.untrackedCount ?? 0,
      relevantPaths: relevantChangedPaths,
      items: changedItems,
    },
    inspectFirst,
    doNotTouch,
    validation: {
      missing: validationMissing,
      expectedCommands: validationCommands,
    },
    evidence: {
      missing: evidenceMissing,
      expectedKeys: radar?.evidence.expectedKeys ?? [],
      receiptCount: receipts.length,
      latestReceiptId: radar?.evidence.latestReceiptId ?? (receipts.at(-1)?.receiptId ?? null),
      proofReportId: radar?.evidence.proofReportId ?? (proofReport?.reportId ?? null),
    },
    dependencyNotes,
    closureCriteria,
    continuationPrompt,
    warnings,
    signals,
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
    containsFullTranscript: false,
    contentStorageClass: "safe_metadata_only",
  };
}

export function buildAndPersistSessionContinuityHandoff(input: BuildSessionContinuityHandoffInput): { handoff: SessionContinuityHandoff; path: string } {
  const handoff = buildSessionContinuityHandoff(input);
  const path = writeSessionContinuityHandoff(input.dir, handoff);
  return { handoff, path };
}

export function buildSessionContinuityPathCheck(dir: string, inputPath: string, generatedAt = new Date().toISOString()): SessionContinuityPathCheck {
  const check = buildWorkflowRadarPathCheck(dir, inputPath, generatedAt);
  const category = categoryFromChangedPath({
    path: check.normalizedPath,
    status: "modified",
    staged: false,
    unstaged: true,
    tags: check.tags,
    workTypeHints: check.workTypeHints,
    riskLevel: check.riskLevel,
    inExpectedScope: check.inExpectedScope ?? false,
    classification: {
      generatedOutput: check.tags.includes("generated_output"),
      runtimeArtifact: check.tags.includes("runtime_artifact"),
      releaseOwned: check.tags.includes("release_owned"),
      productionSensitive: check.tags.includes("production_sensitive"),
      billingSensitive: check.tags.includes("billing_sensitive"),
      secretSensitive: check.tags.includes("secret_sensitive"),
      authOrDashboardSensitive: check.tags.includes("auth_or_dashboard_sensitive") || check.tags.includes("dashboard_surface"),
    },
  });
  const summary = buildPathCheckSummary(check, category);
  return {
    contract: "avorelo.sessionContinuityPathCheck.v1",
    schemaVersion: 1,
    generatedAt,
    repoRoot: dir,
    inputPath,
    normalizedPath: check.normalizedPath,
    category,
    authOrDashboardSensitive: check.tags.includes("auth_or_dashboard_sensitive") || check.tags.includes("dashboard_surface"),
    decisionState: summary.decisionState,
    continuationMode: summary.continuationMode,
    recommendedNextAction: summary.recommendedNextAction,
    summary: summary.summary,
    safeNextAction: summary.safeNextAction,
    doNotTouch: summary.doNotTouch,
    warnings: summary.warnings,
    reasonCodes: summary.reasonCodes,
    containsRawSource: false,
    containsRawPrompt: false,
    containsRawDiff: false,
    containsRawSecret: false,
    containsRawEnvValue: false,
    containsRawTerminalOutput: false,
    containsRawCustomerData: false,
    containsRawScreenshot: false,
    containsProviderPayload: false,
    containsFullTranscript: false,
    contentStorageClass: "safe_metadata_only",
  };
}
