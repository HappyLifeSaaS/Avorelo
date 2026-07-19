import type { ContextEfficiencyDecisionState, ContextEfficiencyWorkType } from "../context-efficiency/index.ts";

export type ModelRoutingInputMode =
  | "simple_fast"
  | "standard_reasoning"
  | "deep_reasoning"
  | "guarded_high_risk"
  | "human_review_required"
  | "blocked_needs_decision";

export type ModelRoutingInputComplexity = "simple" | "moderate" | "complex" | "deep";
export type ModelRoutingInputPathRisk = "low" | "medium" | "high" | "critical";
export type ModelRoutingInputConfidence = "low" | "medium" | "high";
export type ModelRoutingInputContextSize = "tiny" | "small" | "medium" | "large";

export type ModelRoutingInputValidationCommand = {
  command: string;
  reason: string;
};

export type ModelRoutingInputProfile = {
  contract: "avorelo.modelRoutingInputProfile.v1";
  schemaVersion: 1;
  generatedAt: string;
  repoRoot: string;
  taskSource: "explicit_task" | "context_efficiency_latest" | "runtime_flow" | "continuity" | "fallback";
  objectiveSummary: string;
  recommendedMode: ModelRoutingInputMode;
  workType: ContextEfficiencyWorkType;
  taskComplexity: ModelRoutingInputComplexity;
  pathRisk: ModelRoutingInputPathRisk;
  expectedContextSize: ModelRoutingInputContextSize;
  evidenceRequirements: string[];
  confidence: ModelRoutingInputConfidence;
  sensitivities: {
    productionOrRelease: boolean;
    billingOrEntitlement: boolean;
    secretOrCredential: boolean;
    dashboardOrAuthOrSettings: boolean;
  };
  workspaceMap: {
    available: boolean;
    provider: string;
    notes: string[];
  };
  contextEfficiency: {
    available: boolean;
    source: "latest_brief" | "generated" | "unavailable";
    decisionState: ContextEfficiencyDecisionState | null;
    reasonCodes: string[];
  };
  workControls: {
    selectedCapabilities: string[];
    expectedEvidence: string[];
    reasonCodes: string[];
    requiresApproval: boolean;
  };
  recommendedValidation: {
    commands: ModelRoutingInputValidationCommand[];
  };
  safeNextAction: string;
  warnings: string[];
  reasonCodes: string[];
  containsRawSource: false;
  containsRawPrompt: false;
  containsRawDiff: false;
  containsRawSecret: false;
  containsRawEnvValue: false;
  containsRawTerminalOutput: false;
  containsRawCustomerData: false;
  containsRawScreenshot: false;
  containsProviderPayload: false;
  contentStorageClass: "safe_metadata_only";
};

export type ModelRoutingInputCheck = {
  contract: "avorelo.modelRoutingInputPathCheck.v1";
  schemaVersion: 1;
  generatedAt: string;
  repoRoot: string;
  inputPath: string;
  normalizedPath: string;
  recommendedMode: ModelRoutingInputMode;
  pathRisk: ModelRoutingInputPathRisk;
  workTypeHints: ContextEfficiencyWorkType[];
  summary: string;
  safeNextAction: string;
  recommendedValidation: {
    commands: ModelRoutingInputValidationCommand[];
  };
  workspaceMapAvailable: boolean;
  contextEfficiencyAvailable: boolean;
  sensitivityTags: string[];
  reasonCodes: string[];
  containsRawSource: false;
  containsRawPrompt: false;
  containsRawDiff: false;
  containsRawSecret: false;
  containsRawEnvValue: false;
  containsRawTerminalOutput: false;
  containsRawCustomerData: false;
  containsRawScreenshot: false;
  containsProviderPayload: false;
  contentStorageClass: "safe_metadata_only";
};
