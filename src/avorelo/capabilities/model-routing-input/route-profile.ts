import {
  buildContextEfficiencyBrief,
  buildContextEfficiencyPathCheck,
  loadLatestContextEfficiencyBrief,
  type ContextEfficiencyBrief,
  type ContextEfficiencyPathCheck,
} from "../context-efficiency/index.ts";

import { writeModelRoutingInputProfile } from "./persistence.ts";
import type {
  ModelRoutingInputCheck,
  ModelRoutingInputComplexity,
  ModelRoutingInputConfidence,
  ModelRoutingInputContextSize,
  ModelRoutingInputMode,
  ModelRoutingInputPathRisk,
  ModelRoutingInputProfile,
  ModelRoutingInputValidationCommand,
} from "./types.ts";

export type BuildModelRoutingInputProfileInput = {
  dir: string;
  task?: string;
  fromContextBrief?: boolean;
  generatedAt?: string;
};

type ContextBriefSource = "latest_brief" | "generated" | "unavailable";

type ResolvedContextBrief = {
  brief: ContextEfficiencyBrief;
  source: ContextBriefSource;
  taskSource: ModelRoutingInputProfile["taskSource"];
};

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function riskRank(risk: ModelRoutingInputPathRisk): number {
  switch (risk) {
    case "critical": return 4;
    case "high": return 3;
    case "medium": return 2;
    default: return 1;
  }
}

function maxRisk(a: ModelRoutingInputPathRisk, b: ModelRoutingInputPathRisk): ModelRoutingInputPathRisk {
  return riskRank(a) >= riskRank(b) ? a : b;
}

function contextSizeFromBrief(brief: ContextEfficiencyBrief): ModelRoutingInputContextSize {
  const weightedCount =
    brief.contextPlan.include.length * 2 +
    brief.contextPlan.summarize.length +
    brief.contextPlan.deferUntilNeeded.length +
    brief.contextPlan.requiresUserConfirmation.length * 2;
  if (weightedCount <= 3) return "tiny";
  if (weightedCount <= 7) return "small";
  if (weightedCount <= 11) return "medium";
  return "large";
}

function pathRiskFromChecks(checks: ContextEfficiencyPathCheck[]): ModelRoutingInputPathRisk {
  let risk: ModelRoutingInputPathRisk = "low";
  for (const check of checks) {
    risk = maxRisk(risk, check.riskLevel);
    if (check.decisionState === "BLOCKED") return "critical";
  }
  return risk;
}

function deriveSensitivities(brief: ContextEfficiencyBrief, checks: ContextEfficiencyPathCheck[]): ModelRoutingInputProfile["sensitivities"] {
  const reasonCodes = checks.flatMap((check) => check.reasonCodes);
  const summaryText = `${brief.objectiveSummary} ${brief.workType} ${brief.warnings.join(" ")}`.toLowerCase();
  return {
    productionOrRelease:
      brief.workType === "release_preparation" ||
      reasonCodes.includes("release_scope_blocked") ||
      /\b(release|deploy|production|publish|tag)\b/.test(summaryText),
    billingOrEntitlement:
      brief.workType === "billing_or_entitlement" ||
      reasonCodes.includes("billing_scope_review") ||
      summaryText.includes("billing") ||
      summaryText.includes("payment"),
    secretOrCredential:
      brief.workType === "security_review" ||
      reasonCodes.includes("secret_scope_review") ||
      /\b(secret|credential|auth|token|security|session)\b/.test(summaryText),
    dashboardOrAuthOrSettings:
      brief.workType === "dashboard_ux" ||
      reasonCodes.includes("dashboard_scope_review") ||
      /\b(dashboard|settings|login|signup|auth)\b/.test(summaryText),
  };
}

function complexityFromSignals(input: {
  brief: ContextEfficiencyBrief;
  contextSize: ModelRoutingInputContextSize;
  pathRisk: ModelRoutingInputPathRisk;
  sensitivities: ModelRoutingInputProfile["sensitivities"];
}): ModelRoutingInputComplexity {
  let score = 0;
  if (["feature_development", "bug_fix", "test_repair", "public_site"].includes(input.brief.workType)) score += 1;
  if (["security_review", "billing_or_entitlement", "release_preparation", "dashboard_ux"].includes(input.brief.workType)) score += 2;
  if (input.contextSize === "small") score += 1;
  if (input.contextSize === "medium") score += 2;
  if (input.contextSize === "large") score += 3;
  if (input.pathRisk === "high") score += 2;
  if (input.pathRisk === "critical") score += 3;
  if (input.brief.validation.commands.length >= 3) score += 1;
  if (input.brief.workControls.selectedCapabilities.length >= 5) score += 1;
  if (input.brief.warnings.length > 0) score += 1;
  if (Object.values(input.sensitivities).some(Boolean)) score += 1;
  if (score <= 1) return "simple";
  if (score <= 3) return "moderate";
  if (score <= 5) return "complex";
  return "deep";
}

function confidenceFromSignals(input: {
  briefSource: ContextBriefSource;
  brief: ContextEfficiencyBrief;
  pathRisk: ModelRoutingInputPathRisk;
  mode: ModelRoutingInputMode;
}): ModelRoutingInputConfidence {
  if (input.briefSource === "unavailable") return "low";
  if (input.mode === "blocked_needs_decision" || input.mode === "human_review_required") return "low";
  if (input.pathRisk === "critical") return "low";
  if (input.brief.decisionState === "READY" && input.pathRisk === "low") return "high";
  return "medium";
}

function validationCommandsFromBrief(brief: ContextEfficiencyBrief): ModelRoutingInputValidationCommand[] {
  return brief.validation.commands.map((item) => ({ command: item.command, reason: item.reason }));
}

function evidenceRequirementsFromBrief(brief: ContextEfficiencyBrief): string[] {
  return unique([
    ...brief.expectedEvidence.map((item) => item.key),
    ...brief.workControls.expectedEvidence,
  ]);
}

function resolveContextBrief(input: BuildModelRoutingInputProfileInput): ResolvedContextBrief {
  if (input.fromContextBrief) {
    const latest = loadLatestContextEfficiencyBrief(input.dir);
    if (!latest) {
      throw new Error("No context-efficiency brief has been generated yet.");
    }
    return {
      brief: latest,
      source: "latest_brief",
      taskSource: "context_efficiency_latest",
    };
  }

  const explicitTask = input.task?.trim();
  if (explicitTask) {
    return {
      brief: buildContextEfficiencyBrief({ dir: input.dir, task: explicitTask, generatedAt: input.generatedAt }),
      source: "generated",
      taskSource: "explicit_task",
    };
  }

  const latest = loadLatestContextEfficiencyBrief(input.dir);
  if (latest) {
    return {
      brief: latest,
      source: "latest_brief",
      taskSource: "context_efficiency_latest",
    };
  }

  const generated = buildContextEfficiencyBrief({ dir: input.dir, generatedAt: input.generatedAt });
  return {
    brief: generated,
    source: generated.taskSource === "fallback" && generated.decisionState === "UNAVAILABLE" ? "unavailable" : "generated",
    taskSource: generated.taskSource,
  };
}

function recommendedModeFromSignals(input: {
  brief: ContextEfficiencyBrief;
  contextSize: ModelRoutingInputContextSize;
  complexity: ModelRoutingInputComplexity;
  pathRisk: ModelRoutingInputPathRisk;
  sensitivities: ModelRoutingInputProfile["sensitivities"];
}): ModelRoutingInputMode {
  const requiresApproval = input.brief.decisionState === "NEEDS_REVIEW";
  const releaseBlocked = input.sensitivities.productionOrRelease && (input.brief.decisionState === "BLOCKED" || input.brief.workType === "release_preparation");

  if (input.brief.decisionState === "BLOCKED" || input.brief.decisionState === "UNAVAILABLE" || releaseBlocked) {
    return "blocked_needs_decision";
  }
  if (input.sensitivities.billingOrEntitlement || input.sensitivities.secretOrCredential || input.sensitivities.dashboardOrAuthOrSettings || requiresApproval) {
    return "human_review_required";
  }
  if (input.pathRisk === "high" || input.complexity === "deep" || input.brief.decisionState === "READY_WITH_WARNINGS") {
    return "guarded_high_risk";
  }
  if (input.contextSize === "large" || (input.contextSize === "medium" && input.complexity !== "simple")) {
    return "deep_reasoning";
  }
  if (["feature_development", "bug_fix", "test_repair", "public_site"].includes(input.brief.workType)) {
    return "standard_reasoning";
  }
  if (input.complexity === "moderate" || input.complexity === "complex" || input.contextSize === "small") {
    return "standard_reasoning";
  }
  return "simple_fast";
}

function safeNextActionForMode(brief: ContextEfficiencyBrief, mode: ModelRoutingInputMode): string {
  switch (mode) {
    case "blocked_needs_decision":
      return "Narrow the task, resolve the blocked or ambiguous surface, and stay in source-of-truth paths before asking an AI agent to proceed.";
    case "human_review_required":
      return "Prepare a metadata-only brief, confirm approval and evidence expectations, and keep any AI assistance scoped to reviewed source-of-truth paths.";
    case "guarded_high_risk":
      return "Use a guarded work mode, keep sensitive context summarized only, and complete the recommended validation before handoff.";
    case "deep_reasoning":
      return "Start with the top source-of-truth paths, keep the context bounded, and use a deeper reasoning mode with explicit validation checkpoints.";
    case "standard_reasoning":
      return brief.safeNextAction;
    default:
      return "Start from the first source-of-truth path, keep the context small, and finish with the recommended validation.";
  }
}

function reasonCodesForProfile(input: {
  brief: ContextEfficiencyBrief;
  mode: ModelRoutingInputMode;
  pathChecks: ContextEfficiencyPathCheck[];
  complexity: ModelRoutingInputComplexity;
  contextSize: ModelRoutingInputContextSize;
}): string[] {
  return unique([
    `MODE:${input.mode}`,
    `COMPLEXITY:${input.complexity}`,
    `CONTEXT_SIZE:${input.contextSize}`,
    ...input.brief.workControls.reasonCodes,
    ...input.pathChecks.flatMap((check) => check.reasonCodes.map((code) => `PATH:${code}`)),
  ]);
}

function profileExitIsReady(mode: ModelRoutingInputMode): boolean {
  return mode !== "human_review_required" && mode !== "blocked_needs_decision";
}

export function modelRoutingInputModeIsReady(mode: ModelRoutingInputMode): boolean {
  return profileExitIsReady(mode);
}

export function buildModelRoutingInputProfile(input: BuildModelRoutingInputProfileInput): ModelRoutingInputProfile {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const resolved = resolveContextBrief({ ...input, generatedAt });
  const brief = resolved.brief;
  const inspectionPaths = unique([...brief.sourceOfTruthPaths, ...brief.repoAreas]).slice(0, 8);
  const pathChecks = inspectionPaths.map((path) => buildContextEfficiencyPathCheck(input.dir, path, generatedAt));
  const pathRisk = pathRiskFromChecks(pathChecks);
  const contextSize = contextSizeFromBrief(brief);
  const sensitivities = deriveSensitivities(brief, pathChecks);
  const complexity = complexityFromSignals({ brief, contextSize, pathRisk, sensitivities });
  const mode = recommendedModeFromSignals({ brief, contextSize, complexity, pathRisk, sensitivities });
  const confidence = confidenceFromSignals({ briefSource: resolved.source, brief, pathRisk, mode });

  return {
    contract: "avorelo.modelRoutingInputProfile.v1",
    schemaVersion: 1,
    generatedAt,
    repoRoot: input.dir,
    taskSource: resolved.taskSource,
    objectiveSummary: brief.objectiveSummary,
    recommendedMode: mode,
    workType: brief.workType,
    taskComplexity: complexity,
    pathRisk,
    expectedContextSize: contextSize,
    evidenceRequirements: evidenceRequirementsFromBrief(brief),
    confidence,
    sensitivities,
    workspaceMap: {
      available: brief.workspaceMapCompatibility.workspaceMapAvailable,
      provider: brief.workspaceMapCompatibility.provider,
      notes: brief.workspaceMapCompatibility.notes,
    },
    contextEfficiency: {
      available: resolved.source !== "unavailable",
      source: resolved.source,
      decisionState: brief.decisionState,
      reasonCodes: brief.workControls.reasonCodes,
    },
    workControls: {
      selectedCapabilities: brief.workControls.selectedCapabilities,
      expectedEvidence: brief.workControls.expectedEvidence,
      reasonCodes: brief.workControls.reasonCodes,
      requiresApproval: mode === "human_review_required" || mode === "blocked_needs_decision",
    },
    recommendedValidation: {
      commands: validationCommandsFromBrief(brief),
    },
    safeNextAction: safeNextActionForMode(brief, mode),
    warnings: brief.warnings,
    reasonCodes: reasonCodesForProfile({ brief, mode, pathChecks, complexity, contextSize }),
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

export function buildAndPersistModelRoutingInputProfile(input: BuildModelRoutingInputProfileInput): { profile: ModelRoutingInputProfile; path: string } {
  const profile = buildModelRoutingInputProfile(input);
  const path = writeModelRoutingInputProfile(input.dir, profile);
  return { profile, path };
}

function pathModeFromCheck(check: ContextEfficiencyPathCheck): ModelRoutingInputMode {
  if (check.decisionState === "BLOCKED" || check.recommendation === "exclude" || check.decisionState === "UNAVAILABLE") {
    return "blocked_needs_decision";
  }
  if (check.reasonCodes.includes("billing_scope_review") || check.reasonCodes.includes("secret_scope_review") || check.reasonCodes.includes("dashboard_scope_review")) {
    return "human_review_required";
  }
  if (check.riskLevel === "high" || check.riskLevel === "critical") {
    return "guarded_high_risk";
  }
  if (check.workTypeHints.includes("feature_development") || check.workTypeHints.includes("bug_fix") || check.workTypeHints.includes("test_repair")) {
    return "standard_reasoning";
  }
  return "simple_fast";
}

function pathSummary(check: ContextEfficiencyPathCheck, mode: ModelRoutingInputMode): string {
  if (mode === "blocked_needs_decision") return `${check.summary} Inspect the canonical source-of-truth path before requesting AI work.`;
  if (mode === "human_review_required") return `${check.summary} This path should stay review-heavy and tightly scoped.`;
  if (mode === "guarded_high_risk") return `${check.summary} Keep the context bounded and validation explicit.`;
  return check.summary;
}

export function buildModelRoutingInputPathCheck(dir: string, inputPath: string, generatedAt = new Date().toISOString()): ModelRoutingInputCheck {
  const check = buildContextEfficiencyPathCheck(dir, inputPath, generatedAt);
  const latestBrief = loadLatestContextEfficiencyBrief(dir);
  const mode = pathModeFromCheck(check);
  return {
    contract: "avorelo.modelRoutingInputPathCheck.v1",
    schemaVersion: 1,
    generatedAt,
    repoRoot: dir,
    inputPath,
    normalizedPath: check.normalizedPath,
    recommendedMode: mode,
    pathRisk: check.riskLevel,
    workTypeHints: check.workTypeHints,
    summary: pathSummary(check, mode),
    safeNextAction: mode === "blocked_needs_decision"
      ? "Inspect the source-of-truth path instead of asking an AI agent to work directly from this path."
      : mode === "human_review_required"
      ? "Keep the task scoped, require review, and prefer summarized context over raw sensitive material."
      : mode === "guarded_high_risk"
      ? "Use a guarded work mode and complete the recommended validation before handoff."
      : check.safeNextAction,
    recommendedValidation: {
      commands: check.validation.commands.map((item) => ({ command: item.command, reason: item.reason })),
    },
    workspaceMapAvailable: false,
    contextEfficiencyAvailable: latestBrief !== null,
    sensitivityTags: check.tags,
    reasonCodes: unique([`MODE:${mode}`, ...check.reasonCodes]),
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
