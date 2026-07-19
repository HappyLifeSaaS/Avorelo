export type ContextEfficiencyDecisionState =
  | "READY"
  | "READY_WITH_WARNINGS"
  | "NEEDS_REVIEW"
  | "BLOCKED"
  | "UNAVAILABLE";

export type ContextEfficiencyRiskLevel = "low" | "medium" | "high" | "critical";

export type ContextEfficiencyWorkType =
  | "feature_development"
  | "bug_fix"
  | "test_repair"
  | "release_preparation"
  | "documentation"
  | "security_review"
  | "dashboard_ux"
  | "public_site"
  | "billing_or_entitlement"
  | "unknown";

export type ContextRecommendationMode =
  | "include"
  | "summarize"
  | "exclude"
  | "defer_until_needed"
  | "requires_user_confirmation";

export type ContextEfficiencyReasonCode =
  | "CONTEXT_EFFICIENCY_SOURCE_OF_TRUTH"
  | "CONTEXT_EFFICIENCY_GENERATED_OUTPUT_EXCLUDED"
  | "CONTEXT_EFFICIENCY_RUNTIME_ARTIFACT_EXCLUDED"
  | "CONTEXT_EFFICIENCY_RELEASE_SCOPE_BLOCKED"
  | "CONTEXT_EFFICIENCY_BILLING_SCOPE_REVIEW"
  | "CONTEXT_EFFICIENCY_SECRET_SCOPE_REVIEW"
  | "CONTEXT_EFFICIENCY_TESTS_RECOMMENDED"
  | "CONTEXT_EFFICIENCY_CONTEXT_BUDGET_APPLIED"
  | "CONTEXT_EFFICIENCY_WORK_TYPE_INFERRED"
  | "CONTEXT_EFFICIENCY_NEEDS_WORKSPACE_MAP"
  | "CONTEXT_EFFICIENCY_SAFE_METADATA_ONLY";

export type ContextEfficiencyPathRecommendation = {
  path: string;
  recommendation: ContextRecommendationMode;
  summary: string;
  reasonCode: ContextEfficiencyReasonCode | string;
  tags: string[];
};

export type ContextEfficiencyValidationCommand = {
  command: string;
  reason: string;
};

export type ContextEfficiencyEvidenceRecommendation = {
  key: string;
  summary: string;
  source: "context-efficiency" | "work-controls";
};

export type ContextEfficiencyWorkspaceCompatibility = {
  workspaceMapAvailable: boolean;
  provider: string;
  notes: string[];
};

export type ContextEfficiencyBrief = {
  contract: "avorelo.contextEfficiencyBrief.v1";
  schemaVersion: 1;
  generatedAt: string;
  repoRoot: string;
  taskSource: "explicit_task" | "runtime_flow" | "continuity" | "fallback";
  objectiveSummary: string;
  decisionState: ContextEfficiencyDecisionState;
  riskLevel: ContextEfficiencyRiskLevel;
  workType: ContextEfficiencyWorkType;
  repoAreas: string[];
  sourceOfTruthPaths: string[];
  generatedOutputPaths: string[];
  runtimeArtifactPaths: string[];
  blockedAreas: string[];
  contextPlan: {
    include: ContextEfficiencyPathRecommendation[];
    summarize: ContextEfficiencyPathRecommendation[];
    exclude: ContextEfficiencyPathRecommendation[];
    deferUntilNeeded: ContextEfficiencyPathRecommendation[];
    requiresUserConfirmation: ContextEfficiencyPathRecommendation[];
  };
  validation: {
    commands: ContextEfficiencyValidationCommand[];
  };
  expectedEvidence: ContextEfficiencyEvidenceRecommendation[];
  workControls: {
    selectedCapabilities: string[];
    expectedEvidence: string[];
    reasonCodes: string[];
  };
  workspaceMapCompatibility: ContextEfficiencyWorkspaceCompatibility;
  safeNextAction: string;
  warnings: string[];
  containsRawSource: false;
  containsRawPrompt: false;
  containsRawDiff: false;
  containsRawSecret: false;
  containsRawEnvValue: false;
  containsRawTerminalOutput: false;
  containsRawCustomerData: false;
  containsRawScreenshot: false;
  contentStorageClass: "safe_metadata_only";
};

export type ContextEfficiencyPathCheck = {
  contract: "avorelo.contextEfficiencyPathCheck.v1";
  schemaVersion: 1;
  generatedAt: string;
  repoRoot: string;
  inputPath: string;
  normalizedPath: string;
  decisionState: ContextEfficiencyDecisionState;
  riskLevel: ContextEfficiencyRiskLevel;
  recommendation: ContextRecommendationMode;
  summary: string;
  safeNextAction: string;
  workTypeHints: ContextEfficiencyWorkType[];
  tags: string[];
  reasonCodes: string[];
  validation: {
    commands: ContextEfficiencyValidationCommand[];
  };
  containsRawSource: false;
  containsRawPrompt: false;
  containsRawDiff: false;
  containsRawSecret: false;
  containsRawEnvValue: false;
  containsRawTerminalOutput: false;
  containsRawCustomerData: false;
  containsRawScreenshot: false;
  contentStorageClass: "safe_metadata_only";
};
