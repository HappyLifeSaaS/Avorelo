export type ContextSourceKind =
  | "file"
  | "receipt"
  | "git"
  | "cli_output"
  | "dashboard_state"
  | "policy"
  | "external";

export type ContextItemType =
  | "instruction"
  | "policy"
  | "decision"
  | "proof"
  | "constraint"
  | "handoff"
  | "release_state"
  | "workstream_state"
  | "risk_signal"
  | "user_preference"
  | "environment_fact"
  | "dependency"
  | "known_issue"
  | "capability"
  | "artifact"
  | "external_reference";

export type TrustLevel =
  | "verified"
  | "confirmed"
  | "inferred"
  | "unverified"
  | "contradicted"
  | "unsafe";

export type FreshnessStatus =
  | "current"
  | "recent"
  | "stale"
  | "expired"
  | "unknown";

export type LifecycleStatus =
  | "candidate"
  | "promoted"
  | "active"
  | "superseded"
  | "forgotten"
  | "archived";

export type PromotionDecision =
  | "promote"
  | "reject"
  | "supersede"
  | "mark_unsafe"
  | "mark_unverified";

export type WorkMode =
  | "feature_development"
  | "bugfix"
  | "release_verification"
  | "production_release"
  | "qa_proof"
  | "security_guard"
  | "activation_support"
  | "docs_product"
  | "unknown";

export type ConflictType =
  | "production_status_conflict"
  | "version_conflict"
  | "branch_worktree_conflict"
  | "test_result_conflict"
  | "dashboard_local_state_conflict"
  | "release_readiness_conflict"
  | "policy_conflict"
  | "stale_handoff_conflict"
  | "missing_proof_conflict"
  | "receipt_mismatch"
  | "security_safety_conflict"
  | "instruction_conflict";

export interface DiscoveredSource {
  id: string;
  kind: ContextSourceKind;
  path: string;
  exists: boolean;
  sizeBytes: number;
  lastModifiedAt: string | null;
  hash: string;
  candidateCount: number;
  safeToRead: boolean;
  reason: string;
}

export interface DiscoveryResult {
  schemaVersion: "1.0.0";
  generatedAt: string;
  repoRoot: string;
  sources: DiscoveredSource[];
  warnings: string[];
  redactionsApplied: number;
}

export interface ContextMemoryItem {
  id: string;
  schemaVersion: "1.0.0";
  type: ContextItemType;
  summary: string;
  textHash: string;
  source: {
    kind: ContextSourceKind;
    path?: string;
    commit?: string;
    timestamp?: string;
    receiptId?: string;
    url?: string;
  };
  trust: {
    level: TrustLevel;
    confidence: number;
    evidenceIds: string[];
    reason: string;
  };
  freshness: {
    status: FreshnessStatus;
    lastVerifiedAt?: string;
    expiresAt?: string;
    reason: string;
  };
  scope: {
    repo?: string;
    branch?: string;
    worktree?: string;
    feature?: string;
    mode?: string;
    user?: string;
    team?: string;
  };
  safety: {
    containsSecret: boolean;
    containsSensitiveData: boolean;
    productionImpact: boolean;
    ownerOnly: boolean;
    agentVisible: boolean;
    redactionRequired: boolean;
    reason: string;
  };
  lifecycle: {
    status: LifecycleStatus;
    promotedAt?: string;
    supersededBy?: string;
  };
}

export interface PromotionResult {
  schemaVersion: "1.0.0";
  decisionId: string;
  itemId: string;
  decision: PromotionDecision;
  reason: string;
  evidenceIds: string[];
  resultingLifecycleStatus: LifecycleStatus;
  safeForAgent: boolean;
}

export interface TrustScore {
  itemId: string;
  trustLevel: TrustLevel;
  confidence: number;
  reason: string;
  evidenceIds: string[];
}

export interface FreshnessScore {
  itemId: string;
  freshnessStatus: FreshnessStatus;
  lastVerifiedAt: string | null;
  expiresAt: string | null;
  reason: string;
}

export interface ContextConflict {
  schemaVersion: "1.0.0";
  conflictId: string;
  type: ConflictType;
  items: string[];
  strongerEvidence: {
    itemId: string;
    reason: string;
  };
  weakerEvidence: {
    itemId: string;
    reason: string;
  };
  resolution: string;
  impact: string;
  requiredNextProof: string;
  safeDefault: string;
}

export interface ModeDetectionResult {
  schemaVersion: "1.0.0";
  detectedMode: WorkMode;
  confidence: number;
  signals: string[];
  requiredContextClasses: ContextItemType[];
  blockedContextClasses: string[];
  safetyConstraints: string[];
  requiredProofBeforeCompletion: string[];
}

export interface ContextBudget {
  schemaVersion: "1.0.0";
  maxApproxTokens: number;
  reserved: {
    safetyConstraints: number;
    verifiedFacts: number;
    blockersConflicts: number;
    requiredProof: number;
    modeState: number;
    recentDecisions: number;
  };
  includedItemIds: string[];
  excludedItemIds: string[];
  exclusionReasons: Record<string, string>;
}

export interface WorkBriefData {
  schemaVersion: "1.0.0";
  briefId: string;
  generatedAt: string;
  detectedMode: WorkMode;
  modeConfidence: number;
  currentWorkingTruth: string[];
  mustFollowConstraints: string[];
  relevantFacts: string[];
  openBlockers: string[];
  knownRisks: string[];
  whatNotToAssume: string[];
  requiredProofBeforeCompletion: string[];
  suggestedNextActions: string[];
  sourceReceiptReferences: string[];
  budget: ContextBudget;
  conflictCount: number;
}

export type ContextReceiptType =
  | "context_discovery_receipt"
  | "memory_promotion_receipt"
  | "context_conflict_receipt"
  | "work_brief_receipt"
  | "context_recall_receipt"
  | "context_exclusion_receipt"
  | "memory_revision_receipt"
  | "memory_forgetting_receipt"
  | "agent_context_decision_receipt";

export interface ContextReceipt {
  schemaVersion: "1.0.0";
  type: ContextReceiptType;
  receiptId: string;
  createdAt: string;
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawSecret: false;
  contentStored: false;
}

export interface WorkBriefReceipt extends ContextReceipt {
  type: "work_brief_receipt";
  briefId: string;
  briefPath: string;
  detectedMode: WorkMode;
  modeConfidence: number;
  sourceCount: number;
  candidateItemCount: number;
  includedItemCount: number;
  excludedItemCount: number;
  conflictCount: number;
  safetyConstraintsIncluded: boolean;
  redactionsApplied: number;
  safeForAgent: boolean;
  evidenceIds: string[];
  decisionSummary: string;
}

export interface ContextExclusionReceipt extends ContextReceipt {
  type: "context_exclusion_receipt";
  excludedItems: Array<{
    itemId: string;
    reason: string;
    safeDefault: string;
  }>;
}

export interface AgentContextDecisionReceipt extends ContextReceipt {
  type: "agent_context_decision_receipt";
  action: string;
  decision: "block" | "allow" | "downgrade";
  reason: string;
  mode: WorkMode;
  evidenceIds: string[];
}

export interface MemoryPromotionReceipt extends ContextReceipt {
  type: "memory_promotion_receipt";
  promotions: PromotionResult[];
}

export interface ContextConflictReceipt extends ContextReceipt {
  type: "context_conflict_receipt";
  conflicts: ContextConflict[];
}

export interface DashboardContextState {
  schemaVersion: "1.0.0";
  projectConnected: boolean;
  workingTruth: {
    mode: WorkMode;
    confidence: number;
    productionActions: "blocked" | "allowed" | "owner_only";
    npmPublish: "owner_side_only" | "allowed" | "blocked";
    latestBriefPath: string | null;
    latestReceiptId: string | null;
    openBlockers: string[];
    conflicts: string[];
  };
  emptyStates: {
    receiptHistoryEmpty: boolean;
    proofPending: boolean;
  };
}
