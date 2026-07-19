import type { ContextEfficiencyWorkType } from "../context-efficiency/index.ts";
import type { ModelRoutingInputMode } from "../model-routing-input/index.ts";
import type {
  WorkflowRadarChangedPathStatus,
  WorkflowRadarDecisionState,
  WorkflowRadarRecommendedNextAction,
  WorkflowRadarRiskLevel,
} from "../workflow-radar/index.ts";

export type SessionContinuityDecisionState =
  | "READY_TO_CONTINUE"
  | "READY_WITH_WARNINGS"
  | "NEEDS_VALIDATION"
  | "NEEDS_EVIDENCE"
  | "NEEDS_REVIEW"
  | "BLOCKED"
  | "UNAVAILABLE";

export type SessionContinuityContinuationMode =
  | "continue_same_worktree"
  | "start_new_session_same_worktree"
  | "summarize_and_handoff"
  | "wait_for_dependency_merge"
  | "ask_user_decision"
  | "stop_and_review"
  | "unavailable";

export type SessionContinuityRecommendedNextAction =
  | "continue_work"
  | "run_validation"
  | "produce_receipt"
  | "open_pr"
  | "retarget_or_rebase_after_dependency_merge"
  | "summarize_for_next_session"
  | "ask_for_decision"
  | "stop_and_review"
  | "unavailable";

export type SessionContinuitySignalType =
  | "context_brief_available"
  | "model_routing_profile_available"
  | "workflow_radar_available"
  | "workspace_map_available"
  | "work_controls_available"
  | "receipt_metadata_available"
  | "dependency_branch_detected"
  | "dependency_merge_required"
  | "changed_paths_detected"
  | "validation_missing"
  | "evidence_missing"
  | "drift_detected"
  | "unsafe_path_touched"
  | "safe_metadata_only";

export type SessionContinuitySignalSeverity = "info" | "warning" | "high" | "critical";

export type SessionContinuityStage =
  | "implementation_in_progress"
  | "validation_pending"
  | "evidence_pending"
  | "review_required"
  | "blocked"
  | "waiting_on_dependency"
  | "handoff_ready"
  | "unavailable";

export type SessionContinuityPathCategory =
  | "safe_source"
  | "generated_output"
  | "runtime_artifact"
  | "release_owned"
  | "production_sensitive"
  | "billing_sensitive"
  | "secret_sensitive"
  | "unknown";

export type SessionContinuityValidationCommand = {
  command: string;
  reason: string;
};

export type SessionContinuitySignal = {
  type: SessionContinuitySignalType;
  severity: SessionContinuitySignalSeverity;
  summary: string;
  reasonCode: string;
  paths: string[];
};

export type SessionContinuityArtifactSource = {
  key:
    | "context_efficiency"
    | "model_routing_input"
    | "workflow_radar"
    | "workspace_map"
    | "receipt_metadata"
    | "proof_report"
    | "git_metadata";
  label: string;
  available: boolean;
  path: string | null;
  source: "latest_artifact" | "generated_fallback" | "git_metadata" | "unavailable";
  notes: string[];
};

export type SessionContinuityChangedPath = {
  path: string;
  status: WorkflowRadarChangedPathStatus;
  staged: boolean;
  unstaged: boolean;
  tags: string[];
  workTypeHints: ContextEfficiencyWorkType[];
  riskLevel: WorkflowRadarRiskLevel;
  inExpectedScope: boolean;
  category: SessionContinuityPathCategory;
  authOrDashboardSensitive: boolean;
};

export type SessionContinuityDependency = {
  selectedBase: string | null;
  selectedBaseSource: "upstream" | "ancestor_inference" | "unavailable";
  upstreamRef: string | null;
  dependentBranchDetected: boolean;
  dependencyBranch: string | null;
  dependencyMergeRequired: boolean;
  mustMergeFirst: string[];
  mustRetargetTo: string | null;
  notes: string[];
};

export type SessionContinuityHandoff = {
  contract: "avorelo.sessionContinuityHandoff.v1";
  schemaVersion: 1;
  capabilityKey: "session-continuity";
  capabilityName: "Session Continuity";
  generatedAt: string;
  repoRoot: string;
  workstreamName: string;
  taskSummary: string;
  currentStage: SessionContinuityStage;
  decisionState: SessionContinuityDecisionState;
  continuationMode: SessionContinuityContinuationMode;
  recommendedNextAction: SessionContinuityRecommendedNextAction;
  safeToContinue: boolean;
  safeNextAction: string;
  worktree: {
    path: string;
    branch: string;
    head: string;
    dependency: SessionContinuityDependency;
  };
  contextBrief: {
    available: boolean;
    source: "latest_brief" | "generated_fallback" | "unavailable";
    decisionState: string | null;
    workType: ContextEfficiencyWorkType | "unknown";
    sourceOfTruthPaths: string[];
    blockedAreas: string[];
  };
  modelRouting: {
    available: boolean;
    source: "latest_profile" | "generated_fallback" | "unavailable";
    recommendedMode: ModelRoutingInputMode | null;
    actualRequiredMode: ModelRoutingInputMode | null;
    modeConsistent: boolean | null;
  };
  workflowRadar: {
    available: boolean;
    source: "latest_assessment" | "generated_fallback" | "unavailable";
    decisionState: WorkflowRadarDecisionState | null;
    recommendedNextAction: WorkflowRadarRecommendedNextAction | null;
    driftDetected: boolean;
    humanReviewRequired: boolean;
  };
  workspaceMap: {
    available: boolean;
    provider: string;
    notes: string[];
  };
  workControls: {
    available: boolean;
    selectedCapabilities: string[];
    expectedEvidence: string[];
    reasonCodes: string[];
  };
  artifactsUsed: SessionContinuityArtifactSource[];
  changedPaths: {
    totalCount: number;
    stagedCount: number;
    unstagedCount: number;
    untrackedCount: number;
    relevantPaths: string[];
    items: SessionContinuityChangedPath[];
  };
  inspectFirst: string[];
  doNotTouch: string[];
  validation: {
    missing: boolean;
    expectedCommands: SessionContinuityValidationCommand[];
  };
  evidence: {
    missing: boolean;
    expectedKeys: string[];
    receiptCount: number;
    latestReceiptId: string | null;
    proofReportId: string | null;
  };
  dependencyNotes: string[];
  closureCriteria: string[];
  continuationPrompt: string;
  warnings: string[];
  signals: SessionContinuitySignal[];
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
  containsFullTranscript: false;
  contentStorageClass: "safe_metadata_only";
};

export type SessionContinuityPathCheck = {
  contract: "avorelo.sessionContinuityPathCheck.v1";
  schemaVersion: 1;
  generatedAt: string;
  repoRoot: string;
  inputPath: string;
  normalizedPath: string;
  category: SessionContinuityPathCategory;
  authOrDashboardSensitive: boolean;
  decisionState: SessionContinuityDecisionState;
  continuationMode: SessionContinuityContinuationMode;
  recommendedNextAction: SessionContinuityRecommendedNextAction;
  summary: string;
  safeNextAction: string;
  doNotTouch: boolean;
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
  containsFullTranscript: false;
  contentStorageClass: "safe_metadata_only";
};
