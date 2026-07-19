import type { ContextEfficiencyWorkType } from "../context-efficiency/index.ts";
import type { ModelRoutingInputMode } from "../model-routing-input/index.ts";

export type WorkflowRadarDecisionState =
  | "ON_TRACK"
  | "ON_TRACK_WITH_WARNINGS"
  | "DRIFT_DETECTED"
  | "NEEDS_EVIDENCE"
  | "NEEDS_REVIEW"
  | "BLOCKED"
  | "UNAVAILABLE";

export type WorkflowRadarRiskLevel = "low" | "medium" | "high" | "critical";

export type WorkflowRadarRecommendedNextAction =
  | "continue_work"
  | "run_validation"
  | "produce_receipt"
  | "summarize_and_handoff"
  | "ask_for_decision"
  | "switch_to_guarded_mode"
  | "stop_and_review"
  | "unavailable";

export type WorkflowRadarSignalType =
  | "context_brief_available"
  | "model_routing_profile_available"
  | "workspace_map_available"
  | "expected_scope_available"
  | "changed_paths_detected"
  | "unexpected_path_touched"
  | "generated_output_touched"
  | "runtime_artifact_touched"
  | "release_owned_path_touched"
  | "production_sensitive_path_touched"
  | "billing_sensitive_path_touched"
  | "secret_sensitive_path_touched"
  | "validation_missing"
  | "evidence_missing"
  | "work_mode_mismatch"
  | "human_review_required"
  | "safe_metadata_only";

export type WorkflowRadarSignalSeverity = "info" | "warning" | "high" | "critical";

export type WorkflowRadarChangedPathStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "type_changed"
  | "untracked"
  | "unknown";

export type WorkflowRadarValidationCommand = {
  command: string;
  reason: string;
};

export type WorkflowRadarSignal = {
  type: WorkflowRadarSignalType;
  severity: WorkflowRadarSignalSeverity;
  summary: string;
  reasonCode: string;
  paths: string[];
};

export type WorkflowRadarChangedPath = {
  path: string;
  status: WorkflowRadarChangedPathStatus;
  staged: boolean;
  unstaged: boolean;
  tags: string[];
  workTypeHints: ContextEfficiencyWorkType[];
  riskLevel: WorkflowRadarRiskLevel;
  inExpectedScope: boolean;
  classification: {
    generatedOutput: boolean;
    runtimeArtifact: boolean;
    releaseOwned: boolean;
    productionSensitive: boolean;
    billingSensitive: boolean;
    secretSensitive: boolean;
    authOrDashboardSensitive: boolean;
  };
};

export type WorkflowRadarAssessment = {
  contract: "avorelo.workflowRadar.v1";
  schemaVersion: 1;
  capabilityKey: "workflow-radar";
  capabilityName: "Workflow Radar";
  generatedAt: string;
  repoRoot: string;
  taskSource: "explicit_task" | "context_efficiency_latest" | "model_routing_latest" | "fallback";
  objectiveSummary: string;
  decisionState: WorkflowRadarDecisionState;
  riskLevel: WorkflowRadarRiskLevel;
  recommendedNextAction: WorkflowRadarRecommendedNextAction;
  safeNextAction: string;
  onTrack: boolean;
  scopeDriftDetected: boolean;
  humanReviewRequired: boolean;
  contextBrief: {
    available: boolean;
    source: "latest_brief" | "explicit_task" | "unavailable";
    decisionState: string | null;
    workType: ContextEfficiencyWorkType | "unknown";
    repoAreas: string[];
    sourceOfTruthPaths: string[];
  };
  modelRouting: {
    available: boolean;
    source: "latest_profile" | "explicit_task" | "unavailable";
    recommendedMode: ModelRoutingInputMode | null;
    actualRequiredMode: ModelRoutingInputMode;
    modeConsistent: boolean | null;
    reasonCodes: string[];
  };
  workspaceMap: {
    available: boolean;
    provider: string;
    notes: string[];
  };
  expectedScope: {
    available: boolean;
    source: "context_efficiency" | "fallback";
    repoAreas: string[];
    sourceOfTruthPaths: string[];
    blockedAreas: string[];
  };
  workControls: {
    selectedCapabilities: string[];
    expectedEvidence: string[];
    reasonCodes: string[];
    requiresApproval: boolean;
  };
  changedPaths: {
    totalCount: number;
    stagedCount: number;
    unstagedCount: number;
    untrackedCount: number;
    deletedCount: number;
    unexpectedCount: number;
    generatedOutputCount: number;
    runtimeArtifactCount: number;
    releaseOwnedCount: number;
    productionSensitiveCount: number;
    billingSensitiveCount: number;
    secretSensitiveCount: number;
    authOrDashboardSensitiveCount: number;
    items: WorkflowRadarChangedPath[];
  };
  validation: {
    expectedCommands: WorkflowRadarValidationCommand[];
    missing: boolean;
    proofReportAvailable: boolean;
    verifiedCount: number;
  };
  evidence: {
    expectedKeys: string[];
    missing: boolean;
    receiptCount: number;
    latestReceiptId: string | null;
    proofReportId: string | null;
  };
  signals: WorkflowRadarSignal[];
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

export type WorkflowRadarPathCheck = {
  contract: "avorelo.workflowRadarPathCheck.v1";
  schemaVersion: 1;
  generatedAt: string;
  repoRoot: string;
  inputPath: string;
  normalizedPath: string;
  decisionState: WorkflowRadarDecisionState;
  riskLevel: WorkflowRadarRiskLevel;
  recommendedNextAction: WorkflowRadarRecommendedNextAction;
  safeNextAction: string;
  expectedScopeAvailable: boolean;
  inExpectedScope: boolean | null;
  expectedMode: ModelRoutingInputMode | null;
  actualRequiredMode: ModelRoutingInputMode;
  modeConsistent: boolean | null;
  summary: string;
  workTypeHints: ContextEfficiencyWorkType[];
  tags: string[];
  signalTypes: WorkflowRadarSignalType[];
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
