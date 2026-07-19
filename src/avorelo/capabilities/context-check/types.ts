// Avorelo Agent Context Check — type definitions.
// Capability contract: structured integrity check of agent operating context before work starts.

export type ContextCheckMode = "generic" | "task-aware" | "ci";
export type OutputPreference = "human" | "json" | "receipt";
export type CheckStatus = "pass" | "info" | "warning" | "needs_attention";
export type RiskLevel = "none" | "low" | "medium" | "high";
export type Confidence = "low" | "medium" | "high";
export type Severity = "info" | "warning" | "needs_attention";

export type FindingCode =
  | "BROKEN_CONTEXT_REFERENCE"
  | "OVERSIZED_AGENT_CONTEXT"
  | "STALE_TEMP_INSTRUCTION"
  | "BROAD_INSTRUCTION_SCOPE"
  | "RULE_MATCHES_NO_FILES"
  | "EXCLUDED_RELEVANT_CONTEXT"
  | "POSSIBLE_CONFLICTING_INSTRUCTIONS"
  | "WORK_CONTRACT_CONTEXT_MISMATCH";

export type ContextCheckInput = {
  repoRoot: string;
  workContract?: WorkContractRef;
  currentTask?: string;
  expectedScope?: string[];
  changedFiles?: string[];
  agentHint?: string;
  mode: ContextCheckMode;
  outputPreference: OutputPreference;
  strict?: boolean;
};

export type WorkContractRef = {
  objective?: string;
  nonGoals?: string[];
  allowedPaths?: string[];
  excludedPaths?: string[];
  riskFlags?: string[];
  validationPlan?: string[];
  definitionOfDone?: string[];
};

export type ContextSource = {
  path: string;
  sourceType: "claude_md" | "claude_dir" | "agents_md" | "cursor_rule" | "codex_config" | "generic";
  agentFamily: "claude" | "cursor" | "codex" | "copilot" | "generic";
  appliesToPaths?: string[];
  sizeBytes: number;
  estimatedTokens: number;
  lastModified: number;
  references: string[];
  excludedPaths?: string[];
  matchedFilesCount?: number;
  nested?: boolean;
};

export type ContextFinding = {
  code: FindingCode;
  severity: Severity;
  confidence: Confidence;
  path: string;
  message: string;
  reason: string;
  evidence: string;
  relatedPaths: string[];
  suggestedAction: string;
  blocksAutonomousWork: boolean;
};

export type ContextCheckResult = {
  schemaVersion: "agent-context-check.v1";
  status: CheckStatus;
  riskLevel: RiskLevel;
  sourcesChecked: number;
  sources: ContextSource[];
  findings: ContextFinding[];
  summary: string;
  recommendedActions: string[];
  evidence: ContextCheckEvidence;
  receiptLines: string[];
  generatedAt: string;
  repoRoot: string;
  mode: ContextCheckMode;
  strict: boolean;
};

export type ContextCheckEvidence = {
  scanDurationMs: number;
  totalContextSizeBytes: number;
  totalEstimatedTokens: number;
  agentFamiliesDetected: string[];
  workContractProvided: boolean;
};
