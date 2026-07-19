// Tool Adapter Orchestration types. Extends model/primitive routing into actual executor decisions.
// Patterns adopted: adapter registry + health/cooldown (LiteLLM), provider order + data policy deny (OpenRouter),
// unified adapter interface + execution traces (Vercel AI Gateway), local detection + fallback/cascade (Nadir-like).

export type ExecutionMode = "real" | "dry_run" | "deterministic" | "manual_gate" | "scanner" | "proof";

export type AvailabilityStatus = "available" | "unavailable" | "unknown" | "cooldown";

export type WellKnownAdapterId =
  | "deterministic-local"
  | "manual-gate"
  | "scanner"
  | "semgrep"
  | "playwright-proof"
  | "github-actions"
  | "claude-code"
  | "codex"
  | "gemini-cli"
  | "aider"
  | "cursor";
export type ToolAdapterId = WellKnownAdapterId | (string & {});

export type ProofAdapterClass = "security_scan" | "browser_proof" | "ci_readonly";

export type ProofExecutionMetadata = {
  adapterClass: ProofAdapterClass;
  summary: string;
  findingCount: number;
  artifactCount: number;
  fake: boolean;
  localOnly: boolean;
  sanitized: true;
};

export type DelegatedAdapterConfig = {
  id: ToolAdapterId;
  binaryName: string;
  versionFlag: string;
  execArgs: (sanitizedTask: string) => string[];
  outputFormat: "json" | "text";
  authDetectionPatterns: string[];
  notInstalledReason: string;
  executionReasonCode: string;
  notInstalledReasonCode: string;
  authRequiredReasonCode: string;
  taskFailedReasonCode: string;
  taskExecutedReasonCode: string;
};

export type DataPolicy = "local_only" | "zdr" | "no_training" | "training_included";

export type RiskCeiling = "low" | "medium" | "high" | "critical";

export type IrreversibleActionPolicy = "block" | "approval_required" | "allow_with_proof";

export type FailureClass = "not_installed" | "not_detected" | "version_incompatible" | "cooldown" | "timeout" | "permission_denied" | "network_required" | "unknown";

export type AdapterCapabilityDescriptor = {
  id: ToolAdapterId;
  displayName: string;
  localOnly: boolean;
  requiresNetwork: boolean;
  requiresLogin: boolean;
  supportsDryRun: boolean;
  supportsRealRun: boolean;
  supportsPatch: boolean;
  supportsShell: boolean;
  supportsReview: boolean;
  supportsLongContext: boolean;
  supportsSubagents: boolean;
  supportsHooks: boolean;
  supportsSandbox: boolean;
  supportsMCP: boolean;
  supportsProofCollection: boolean;
  supportedPlatforms: string[];
  riskCeiling: RiskCeiling;
  irreversibleActionPolicy: IrreversibleActionPolicy;
  dataPolicy: DataPolicy;
  limitations: string[];
};

export type ToolAvailability = {
  adapterId: ToolAdapterId;
  status: AvailabilityStatus;
  detectionMethod: string;
  version: string | null;
  signals: string[];
  failureClass: FailureClass | null;
  checkedAt: number;
};

export type AdapterHealthState = {
  adapterId: ToolAdapterId;
  healthy: boolean;
  lastError: string | null;
  cooldownUntil: number;
  consecutiveFailures: number;
};

export type AdapterPolicyConstraints = {
  localOnly: boolean;
  denyDataCollection: boolean;
  requireSandbox: boolean;
  requireProofCollection: boolean;
  maxRiskCeiling: RiskCeiling;
  allowedAdapters: ToolAdapterId[] | null;
  deniedAdapters: ToolAdapterId[] | null;
  preferenceOrder: ToolAdapterId[];
  allowFallback: boolean;
  fallbackCannotLowerPrivacy: boolean;
  fallbackCannotLowerProof: boolean;
};

export type AdapterSafeCommandPreview = {
  adapterId: ToolAdapterId;
  command: string;
  args: string[];
  safe: boolean;
  requiresApproval: boolean;
  estimatedDuration: string;
};

export type ToolExecutionPlan = {
  selectedAdapter: ToolAdapterId;
  executionMode: ExecutionMode;
  fallbackAdapters: ToolAdapterId[];
  approvalRequired: boolean;
  proofRequired: boolean;
  commandPreview: AdapterSafeCommandPreview | null;
  reasonCodes: string[];
  forbiddenActions: string[];
  policyConstraints: AdapterPolicyConstraints;
  toolMayExecute: boolean;
  modelMayDecide: false;
  scannerMayDecide: false;
  finalDecisionOwner: "kernel/stop-continue-gate";
};

export type ToolExecutionResult = {
  adapterId: ToolAdapterId;
  executionMode: ExecutionMode;
  status: "planned" | "executed" | "blocked" | "failed" | "approval_required";
  durationMs: number | null;
  proofCollected: boolean;
  receiptId: string;
  reasonCodes: string[];
  failureClass: FailureClass | null;
};

export type ToolProofReceipt = {
  contract: "avorelo.toolProofReceipt.v1";
  receiptId: string;
  adapterId: ToolAdapterId;
  executionMode: ExecutionMode;
  status: string;
  reasonCodes: string[];
  forbiddenActions: string[];
  proofCollected: boolean;
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawSecret: false;
  containsRawOutput: false;
  modelMayDecide: false;
  scannerMayDecide: false;
  finalDecisionOwner: "kernel/stop-continue-gate";
  createdAt: number;
};

// --- Multi-Agent Review types ---

export type AgentRole = "executor" | "reviewer" | "verifier";

export type ReviewVerdict = "approved" | "rejected" | "needs_changes" | "inconclusive";

export type ReviewRound = {
  round: number;
  executorAdapter: ToolAdapterId;
  reviewerAdapter: ToolAdapterId;
  verdict: ReviewVerdict;
  reasonCodes: string[];
  durationMs: number;
  verifierPassed: boolean | null;
  containsRawModelOutput: false;
};

export type MultiAgentReviewPlan = {
  enabled: boolean;
  executorAdapter: ToolAdapterId;
  reviewerAdapter: ToolAdapterId | null;
  maxRounds: number;
  requireVerifier: boolean;
  triggerReasonCodes: string[];
  modelMayDecide: false;
  scannerMayDecide: false;
  finalDecisionOwner: "kernel/stop-continue-gate";
};

export type MultiAgentReviewResult = {
  attempted: boolean;
  roundsCompleted: number;
  maxRoundsReached: boolean;
  finalVerdict: ReviewVerdict | null;
  rounds: ReviewRound[];
  totalDurationMs: number;
  reasonCodes: string[];
  modelConsensusOnly: boolean;
  externalProofRequired: boolean;
  routedToManualGate: boolean;
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawSecret: false;
  containsRawModelOutput: false;
};

export type MultiAgentStopCondition =
  | "REVIEWER_APPROVED"
  | "VERIFIER_PASSED"
  | "REVIEWER_DISAGREEMENT"
  | "MAX_REVIEW_ROUNDS_REACHED"
  | "MANUAL_GATE_AFTER_DISAGREEMENT"
  | "VERIFIER_OVERRIDE";

export type ToolFailureClassification = {
  adapterId: ToolAdapterId;
  failureClass: FailureClass;
  retryable: boolean;
  cooldownMs: number;
  detail: string;
};

export type ToolRoutingProjection = {
  selectedAdapter: ToolAdapterId;
  executionMode: ExecutionMode;
  fallbackAdapters: ToolAdapterId[];
  adapterAvailability: Record<ToolAdapterId, AvailabilityStatus>;
  approvalRequired: boolean;
  proofRequired: boolean;
  reasonCodes: string[];
  forbiddenActions: string[];
  toolMayExecute: boolean;
  modelMayDecide: false;
  scannerMayDecide: false;
  finalDecisionOwner: "kernel/stop-continue-gate";
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawSecret: false;
  // Execution result fields (populated after runToolExecution)
  executionStatus?: "executed" | "blocked" | "failed" | "approval_required" | "skipped" | "not_run";
  executionReceiptId?: string;
  executionDurationMs?: number;
  executionProofCollected?: boolean;
  executionOutput?: string | null;
  proofMetadata?: ProofExecutionMetadata | null;
  containsRawOutput?: false;
  containsRawModelOutput?: false;
  containsRawTerminalOutput?: false;
  containsRawGitDiff?: false;
  // Multi-agent review fields (populated after review execution)
  multiAgentReview?: MultiAgentReviewResult | null;
  // Delegated task execution fields (real Claude Code / Codex execution)
  delegatedExecution?: {
    attempted: boolean;
    toolVersion: string | null;
    authRequired: boolean;
    patchSummary: string | null;
    filesChangedCount: number;
    taskSafetyClass: string;
    failureReason: string | null;
    containsRawModelOutput: false;
  } | null;
};
