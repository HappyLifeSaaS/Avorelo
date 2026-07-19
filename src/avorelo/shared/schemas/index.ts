// Avorelo shared schemas (Slice 1). Strip-types-compatible TypeScript (no enums/namespaces).
// Single source of type truth for the Kernel proof skeleton. Owns no logic — types + validators only.

export type EvidenceLevel = "NAVIGATION" | "INTERACTION" | "OUTCOME" | "POST_ACTION";
export const EVIDENCE_ORDER: EvidenceLevel[] = ["NAVIGATION", "INTERACTION", "OUTCOME", "POST_ACTION"];

export type PlanTier = "Free" | "Pro" | "Teams";
export type GateDecision = "CONTINUE" | "STOP_BLOCKED" | "STOP_DONE";
export type PolicyVerdict = "allow" | "block" | "needs_approval";
export type ReviewerVerdict = "GO" | "NO_GO" | "PARTIAL";
export type DecisionMethod = "deterministic" | "classifier" | "llm-assisted" | "user-approval";
export type ConfidenceLabel = "UNKNOWN" | "LOW" | "MED" | "HIGH";

export type WorkContract = {
  contractId: string;
  objective: string;
  allowedPaths: string[];
  requestedOutputs: string[];
  successCriteria: string[];
  stopConditions: string[];
  evidenceRefs: string[];
  reviewReasons: string[];
  planTier: PlanTier;
};

// A synthetic evidence artifact submitted to the Evidence Router (Slice 1 = synthetic only).
export type EvidenceArtifact = {
  artifactId: string;
  // kind drives deterministic grading; declaredLevel is the submitter's claim (router may grade it DOWN, never up).
  kind:
    | "http_status_ok" // 200/no-404  -> NAVIGATION at most
    | "redirect" // 3xx redirect -> INTERACTION at most (never payment OUTCOME)
    | "ui_action_accepted" // INTERACTION
    | "test_passed" // (Slice 4) a test/CI signal -> INTERACTION at most (test pass is NOT a user outcome)
    | "screenshot" // (Slice 4) UI rendered -> INTERACTION at most (screenshot alone is NOT proof of outcome)
    | "user_confirmed" // (Slice 4) the user says it worked -> INTERACTION at most (lower-confidence; never OUTCOME alone)
    | "persisted_state_change" // OUTCOME (state actually changed)
    | "source_of_truth_readback" // (Slice 4) read the ACTUAL persisted state and it matches expected -> OUTCOME
    | "aftermath_correct" // POST_ACTION (terminal state correct, no false signal)
    | "fixture"; // simulated -> rejected for readiness (graded null)
  ref: string; // a reference (e.g., ledger/event/test id); never raw page/body
  detail?: Record<string, unknown>; // small, redacted before persistence
};

export type GradedEvidence = {
  artifactId: string;
  level: EvidenceLevel | null; // null = rejected for readiness (e.g., fixture)
  ref: string;
};

export type LedgerEvent = {
  eventId: string;
  seq: number;
  ts: number;
  type: string;
  contractId: string | null;
  payload: Record<string, unknown>; // redacted at write
  reasonCodes: string[];
  prevHash: string;
  eventHash: string;
  redacted: true;
};

export type DecisionBasis = {
  method: DecisionMethod;
  confidence: ConfidenceLabel;
  evidenceRefs: string[];
  reasonCodes: string[];
  fallbackUsed: boolean;
};

// Allowlisted, derived-only receipt. NO arbitrary candidate content/prompt/source is ever a field here.
export type Receipt = {
  receiptId: string;
  contractId: string;
  decision: GateDecision;
  evidenceLevels: EvidenceLevel[];
  evidenceRefs: string[];
  safeNextActions: string[];
  decisionBasis: DecisionBasis;
  redactionClasses: string[]; // derived secret/redaction CLASSES only (e.g. "aws_access_key", "key:prompt") — never values
  receiptDigest: string; // stable digest of load-bearing fields
  sampleSize: number;
  // When the receipt was durably written (epoch ms). Optional + additive: receipts written before Slice 3
  // have no timestamp, and the local dashboard surfaces those as "unknown age" rather than implying freshness.
  // NOT part of receiptDigest (a timestamp is not a load-bearing decision field).
  writtenAt?: number;
  redaction: "applied";
};

// --- Skill-to-Capability operating layer foundation ---

export type WorkControlCapability =
  | "context-check"
  | "loop-control"
  | "drift-guard"
  | "proof-review"
  | "receipt-trace"
  | "model-routing"
  | "tool-governance"
  | "context-budget"
  | "context-efficiency"
  | "production-confidence"
  | "local-dashboard"
  | "company-loop"
  | "founder-cockpit";

export type CapabilitySuppression = {
  capability: WorkControlCapability | string;
  reasonCode: string;
  requiredEntitlement: string | null;
};

export type CapabilityEntitlementCheck = {
  capability: WorkControlCapability | string;
  requiredLegacyFeature: string;
  allowed: boolean;
  reasonCode: string;
};

export type CapabilityRouteDecision = {
  selectedCapabilities: string[];
  suppressedCapabilities: CapabilitySuppression[];
  entitlementChecks: CapabilityEntitlementCheck[];
  requiredApprovals: string[];
  expectedEvidence: string[];
  reasonCodes: string[];
  proposalHints: string[];
  finalDecisionOwner: "kernel/stop-continue-gate";
  usesModelRoutingOutput: false;
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawSecret: false;
};

export type ActionWorthinessVerdict =
  | "allow"
  | "allow_with_bounds"
  | "require_approval"
  | "suggest_safer_action"
  | "block";

export type ActionWorthinessDecision = {
  verdict: ActionWorthinessVerdict;
  proposalHints: string[];
  requiredApprovals: string[];
  saferAlternative: string | null;
  bounds: string[];
  expectedEvidence: string[];
  reasonCodes: string[];
  finalDecisionOwner: "kernel/stop-continue-gate";
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawSecret: false;
};

export type SkillExecutionMode = "reference" | "checklist" | "executable";
export type SkillPrivacyReview = "not_needed" | "required" | "approved" | "blocked";
export type SkillAdoptionOutcome =
  | "rejected"
  | "archived"
  | "kept_as_skill"
  | "bound_to_capability"
  | "promotion_candidate";

export type SkillIntakeRecord = {
  intakeId: string;
  title: string;
  sourceType: string;
  sourceId: string;
  version: string | null;
  provenance: string;
  licenseStatus: string;
  owner: string | null;
  executionMode: SkillExecutionMode;
  description: string;
  categories: string[];
  rawTrigger: string;
  routingTriggers: string[];
  requiredTools: string[];
  disallowedTools: string[];
  privacyReview: SkillPrivacyReview;
  fixtureExpectations: string[];
  capabilityBindingHint: string | null;
  evidenceRefs: string[];
};

export type NormalizedSkill = {
  skillId: string;
  title: string;
  sourceId: string;
  executionMode: SkillExecutionMode;
  provenance: string;
  licenseStatus: string;
  owner: string | null;
  normalizedTriggers: string[];
  rawTrigger: string;
  requiredTools: string[];
  disallowedTools: string[];
  privacyReview: SkillPrivacyReview;
  fixtureExpectations: string[];
  capabilityBindingHint: string | null;
  evidenceRefs: string[];
};

export type CapabilityBinding = {
  capabilityKey: string;
  bindingMode: "informational" | "guarded_skill" | "promotion_candidate";
  requiredLegacyFeature: string | null;
  reasonCodes: string[];
};

export type SkillAdoptionDecision = {
  outcome: SkillAdoptionOutcome;
  capabilityBindings: CapabilityBinding[];
  reasonCodes: string[];
  blockers: string[];
  verifiedClaims: string[];
  unverifiedClaims: string[];
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawSecret: false;
};

export type CapabilityHealthState = "healthy" | "watch" | "stale" | "orphaned" | "blocked";

export type CapabilityHealth = {
  capabilityKey: string;
  state: CapabilityHealthState;
  falseActivationRate: number;
  proofContribution: number;
  daysSinceReview: number;
  reasonCodes: string[];
  recommendedAction: string;
};

export type SkillHealth = {
  skillId: string;
  state: CapabilityHealthState;
  falseActivationRate: number;
  proofContribution: number;
  daysSinceReview: number;
  reasonCodes: string[];
  recommendedAction: string;
};

export type WorkControlReceiptSummary = {
  selectedCapabilities: string[];
  suppressedCapabilities: string[];
  entitlementRequired: string[];
  requiredApprovals: string[];
  expectedEvidence: string[];
  actionVerdict: ActionWorthinessVerdict;
  reasonCodes: string[];
  verifiedClaims: string[];
  unverifiedClaims: string[];
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawSecret: false;
};

// --- Slice 3: Local dashboard read-model (a pure PROJECTION of receipts; owns no truth) ---
export type CardKind = "done" | "in_progress" | "blocked" | "needs_attention";

export type ReceiptCard = {
  receiptId: string;
  contractId: string;
  decision: GateDecision;
  kind: CardKind;
  highestEvidenceLevel: EvidenceLevel | null;
  ready: boolean; // STOP_DONE backed by OUTCOME+POST_ACTION (truthful "done")
  stale: boolean;
  ageMs: number | null; // null = unknown age (no writtenAt)
  safeNextActions: string[];
  receiptDigest: string;
  redactionClasses: string[];
};

export type LocalDashboardModel = {
  generatedAt: number;
  receiptDir: string;
  staleWindowMs: number;
  totals: { total: number; done: number; inProgress: number; blocked: number; needsAttention: number; stale: number; unknownAge: number };
  cards: ReceiptCard[];
  notes: string[]; // e.g. truncation notices — never silent caps
  redaction: "applied";
};

// --- Product Operating System types (foundation) ---

export type DataTruthLabel =
  | "Live"
  | "Seed"
  | "Estimated"
  | "Inferred"
  | "Unverified"
  | "Blocked"
  | "Not connected";

export type Entitlement =
  | "local-kernel"
  | "basic-safety"
  | "basic-recovery"
  | "autonomous-iteration"
  | "visual-proof"
  | "payment-proof"
  | "cloud-claim"
  | "remediation"
  | "governed-exposure"
  | "team-rollups"
  | "team-governance";

export const PLAN_ENTITLEMENTS: Record<PlanTier, Entitlement[]> = {
  Free: ["local-kernel", "basic-safety", "basic-recovery"],
  Pro: [
    "local-kernel", "basic-safety", "basic-recovery",
    "autonomous-iteration", "visual-proof", "payment-proof",
    "cloud-claim", "remediation",
  ],
  Teams: [
    "local-kernel", "basic-safety", "basic-recovery",
    "autonomous-iteration", "visual-proof", "payment-proof",
    "cloud-claim", "remediation",
    "governed-exposure", "team-rollups", "team-governance",
  ],
};

export type LabelledMetric<T = unknown> = {
  value: T;
  label: DataTruthLabel;
  source: string;
  updatedAt: number | null;
};

export type CheckoutState = "Not connected" | "Blocked" | "Active" | "PAYMENT_READY";

export type WebhookState = "Not connected" | "Blocked" | "Active" | "Idempotent" | "Non-idempotent";

export type InternalAgentId = "product" | "design" | "billing" | "support" | "qa" | "growth" | "security" | "dogfood";

export type AgentFinding = {
  agentId: InternalAgentId;
  findingId: string;
  summary: string;
  evidenceRefs: string[];
  approved: boolean;
  destination: string;
  redaction: "applied";
};

export type CockpitTab = "saas-ops" | "ai-work-control" | "product-value" | "learn-improve" | "diagnostics";

export type CockpitMetric = {
  metricId: string;
  tab: CockpitTab;
  label: string;
  metric: LabelledMetric;
};

// --- Slice 4.5: Context cost attribution + tool governance + migration ---

export type ContextCostCategory = "low" | "medium" | "high";
export type ContextUsefulness = "used" | "loaded_unused" | "deferred" | "blocked";
export type MeasurementConfidence = "measured" | "estimated" | "inferred" | "unverified";

export type ContextDriver = {
  driverId: string;
  driverType:
    | "selected_files"
    | "repo_map"
    | "carry_forward_memory"
    | "project_instructions"
    | "skills_recipes"
    | "mcp_tool_metadata"
    | "verification_proof_output"
    | "task_ticket_context"
    | "connector_metadata"
    | "old_repo_migration_context";
  label: string;
  contextCostCategory: ContextCostCategory;
  usefulness: ContextUsefulness;
  measurementConfidence: MeasurementConfidence;
  reasonCodes: string[];
  deferredNextRun: boolean;
  savedOrAvoided: string | null; // label only, never precise tokens without measurement
  evidenceRef: string | null;
};

export type ToolRiskLevel = "low" | "medium" | "high";
export type ToolType = "read" | "reason" | "action";
export type ToolExposure = "always" | "on_demand" | "approval" | "blocked";

export type ToolGovernance = {
  toolId: string;
  toolName: string;
  contextCost: ContextCostCategory;
  riskLevel: ToolRiskLevel;
  toolType: ToolType;
  defaultExposure: ToolExposure;
  requiresApprovalFor: string[];
  reasonCodes: string[];
};

export type ExposurePlan = {
  planId: string;
  contractId: string;
  exposed: ToolGovernance[];
  deferred: ToolGovernance[];
  blocked: ToolGovernance[];
  approvalRequired: ToolGovernance[];
  contextCostSummary: { low: number; medium: number; high: number };
  reasonCodes: string[];
};

export type MigrationMode =
  | "REBUILD_NOW"
  | "REBUILD_LATER"
  | "REWRITE_CLEAN"
  | "CONCEPT_ONLY"
  | "MINE_LATER"
  | "TRANSFER_CODE_IF_CONTRACT_COMPATIBLE"
  | "PRESERVE_AS_REQUIREMENT"
  | "PRESERVE_AS_EVIDENCE"
  | "PRESERVE_AS_REFERENCE"
  | "DEPRECATE_DUPLICATE"
  | "REJECT_UNSAFE"
  | "REJECT_SUPERSEDED"
  | "UNKNOWN_NEEDS_REVIEW";

export type ArchitectureLayer = "kernel" | "capability" | "adapter" | "surface" | "product_docs" | "migration_docs" | "discard";

export type MigrationCandidate = {
  candidateId: string;
  capability: string;
  oldPath: string;
  description: string;
  productValue: "user_value" | "internal_only" | "both";
  architectureLayer: ArchitectureLayer;
  evidence: string[];
  riskFlags: string[];
  duplicationRisk: boolean;
  migrationMode: MigrationMode;
  canonicalOwner: string;
  requiredProof: string[];
  slice: string;
  userFacingImpact: string;
};

export type MigrationReceipt = {
  receiptId: string;
  generatedAt: number;
  found: string[];
  fixed: string[];
  proved: string[];
  needsAttention: string[];
  candidateCount: number;
  acceptedCount: number;
  deferredCount: number;
  rejectedCount: number;
  redaction: "applied";
};

export type VerificationMode = "unit" | "integration" | "browser_manual" | "browser_agentic" | "runtime" | "not_run";

export type ProofFields = {
  verificationMode: VerificationMode;
  journeysChecked: string[];
  evidenceArtifacts: string[];
  uncheckedItems: string[];
  reasonIfNotRun: string;
};

// --- Phase 10 (Old Repo Parity Gate & Canonical Readiness) — additive type truth ---
// A readiness/parity GATE. No new product capability. Proves phases 1-9 coverage, old-repo capability
// parity, invariant enforcement, CLI-docs reality, and remaining limitations. Result is honest: never fake
// `ready` if blockers or known limitations exist.

export type ReadinessResult = "ready" | "ready_with_limitations" | "not_ready";
export type PhaseStatus = "implemented" | "merged" | "documented" | "missing" | "deferred";
export type OldCapabilityStatus = "ported" | "adapted" | "deferred" | "intentionally_not_ported";

export type PhaseCoverageItem = { phase: number; name: string; status: PhaseStatus; evidence: string[] };
export type OldRepoCapabilityItem = { capability: string; status: OldCapabilityStatus; canonicalEvidence: string[]; notes: string[] };

export type CanonicalReadinessReport = {
  contract: "avorelo.canonicalReadiness.v1";
  schemaVersion: 1;
  createdAt: string;
  readinessId: string;
  result: ReadinessResult;
  phaseCoverage: PhaseCoverageItem[];
  oldRepoCapabilityCoverage: OldRepoCapabilityItem[];
  invariants: {
    safetyBoundary: boolean;
    noRawSecrets: boolean;
    noRawPrompts: boolean;
    noRawSourceDumps: boolean;
    metadataOnlySync: boolean;
    noFakeSavings: boolean;
    confidenceLabelsPreserved: boolean;
    fullArtifactsLocalOnly: boolean;
    noOldBranding: boolean;
    cliDocsMatchReality: boolean;
  };
  blockers: string[];
  limitations: string[];
  nextTrackRecommendations: string[];
  safety: {
    redacted: true;
    containsRawPrompt: false;
    containsRawSource: false;
    containsRawSecret: false;
    containsTerminalLog: false;
    containsGitDiff: false;
  };
};

// --- Phase 9 (Sanitized Cloud Sync for Efficiency Metadata) — additive type truth (Layer 4) ---
// Cloud sync may carry ONLY explicit sanitized metadata projections, NEVER full local artifacts.
// projectionOnly is always true; fullArtifactsSynced is always false. Every projection independently passes
// the Phase-1 cloud-eligibility gate; anything that fails goes to `blocked` with reason codes only (no payload).

export type EfficiencyMetadataSource = "token_cost_evidence" | "proof_report" | "value_ledger" | "context_packet" | "continuity";
export type EfficiencyMetadataSyncMode = "dry_run" | "local_queue" | "prepared";

export type EfficiencyMetadataProjection = {
  projectionId: string;
  source: EfficiencyMetadataSource;
  contract: string;
  createdAt: string;
  metadata: Record<string, unknown>; // a sanitized projection — never a full artifact
  eligibility: { cloudEligible: true; reasonCodes: string[] };
};

export type EfficiencyMetadataBlockedProjection = {
  source: string;
  contract: string;
  blockedReasonCodes: string[]; // codes only — the unsafe payload is NEVER included
  safeSummary: string;
};

export type EfficiencyMetadataSyncEnvelope = {
  contract: "avorelo.efficiencyMetadataSync.v1";
  schemaVersion: 1;
  createdAt: string;
  envelopeId: string;
  mode: EfficiencyMetadataSyncMode;
  sourceCounts: { tokenCost: number; proofReports: number; valueLedger: number; contextPackets?: number; continuityPackets?: number };
  eligible: EfficiencyMetadataProjection[];
  blocked: EfficiencyMetadataBlockedProjection[];
  safety: {
    redacted: true;
    allowlistOnly: true;
    containsRawPrompt: false;
    containsRawTranscript: false;
    containsRawSource: false;
    containsRawSecret: false;
    containsEnvValue: false;
    containsTerminalLog: false;
    containsGitDiff: false;
    containsSensitivePath: false;
  };
  syncPolicy: { cloudEligible: boolean; projectionOnly: true; fullArtifactsSynced: false };
};

// --- Phase 8 (Value Ledger & Compact Value Surface) — additive type truth (Layer 4) ---
// Local-first, confidence-labelled value HISTORY + compact value cards. Aggregates evidence; never invents
// value. No ROI, no productivity score, no fake savings. unavailable remains unavailable. Cards preserve
// confidence labels; savings appear only if a Phase-7 report explicitly allowed them (never in v1).

export type ValueLedgerSource = "proof_report" | "secret_boundary" | "continuity" | "context_compiler" | "token_cost_evidence" | "manual_safe";
export type ValueLedgerCategory =
  | "scope_safety_protected" | "secret_boundary_protected" | "proof_captured" | "next_run_prepared"
  | "review_load_reduced" | "rework_avoided" | "token_cost_evidence" | "needs_attention";
export type ValueLedgerStatus = "captured" | "prepared" | "protected" | "verified" | "needs_attention" | "unavailable";
export type ValueMetricKind = "count" | "cost_summary" | "evidence_count" | "proof_count" | "finding_count" | "unavailable";

export type ValueLedgerEntry = {
  contract: "avorelo.valueLedger.v1";
  schemaVersion: 1;
  entryId: string;
  createdAt: string;
  source: ValueLedgerSource;
  relatedIds: {
    reportId?: string;
    evidenceIds?: string[];
    continuityPacketId?: string;
    contextPacketId?: string;
    workContractId?: string;
  };
  category: ValueLedgerCategory;
  confidence: EvidenceConfidence;
  status: ValueLedgerStatus;
  metric?: { kind: ValueMetricKind; value: number | null; currency?: string | null; confidence: EvidenceConfidence };
  summary: string; // redacted
  reasonCodes: string[];
  safety: {
    redacted: true;
    containsRawPrompt: false;
    containsRawSource: false;
    containsRawSecret: false;
    containsTerminalLog: false;
    containsGitDiff: false;
  };
};

export type ValueCardTitle =
  | "Scope & Safety Protected" | "Secret Boundary Protected" | "Proof Captured" | "Next Run Prepared"
  | "Review Load Reduced" | "Rework Avoided" | "Token/Cost Evidence" | "Needs Attention";

export type CompactValueCard = {
  cardId: string;
  title: ValueCardTitle;
  status: "available" | "unavailable" | "needs_attention";
  confidence: EvidenceConfidence;
  valueLabel: string; // e.g. "3 protected", "unavailable", "not claimed"
  reasonCodes: string[];
  sourceEntryIds: string[];
};

export type ValueLedgerSyncMetadata = {
  contract: "avorelo.valueLedger.sync.v1";
  entryCount: number;
  categories: Record<string, number>;
  confidenceBreakdown: Record<EvidenceConfidence, number>;
  cardStatuses: { title: ValueCardTitle; status: string; confidence: EvidenceConfidence }[];
  reasonCodes: string[];
  createdAtRange: { first: string | null; last: string | null };
  redacted: true;
};

// --- Phase 7 (Proof & Savings Report) — additive type truth (Layer 4) ---
// A compact, honest report of what Avorelo did + what evidence exists. Consumes Phase 6 token/cost evidence
// and Phase 2-5 metadata. SAVINGS MAY APPEAR ONLY WHEN BACKED BY ELIGIBLE COMPARATIVE EVIDENCE. unavailable
// evidence → "unavailable", never zero, never savings. Phase 7 refuses unevidenced savings.

export type ProofReportScope = "session" | "work_contract" | "local_workspace" | "manual";
export type ProofItemStatus = "found" | "protected" | "prepared" | "verified" | "needs_attention" | "next";

export type ProofReportItem = {
  code: string;
  title: string;
  status: ProofItemStatus;
  confidence: EvidenceConfidence;
  evidenceIds: string[];
  summary: string; // redacted
};

export type ProofReportSavingsSection = {
  canShowSavings: boolean;
  refusalReason?: string;
  costSummary?: {
    totalCost: number | null;
    currency: string | null;
    confidence: EvidenceConfidence;
    mixedCurrency: boolean;
  };
  savingsAmount: null | number;
  savingsCurrency: null | string;
  savingsConfidence: "unavailable" | "measured" | "imported";
  savingsClaimAllowed: boolean;
};

export type ProofReport = {
  contract: "avorelo.proofReport.v1";
  schemaVersion: 1;
  reportId: string;
  createdAt: string;
  scope: ProofReportScope;
  relatedIds?: {
    sessionId?: string;
    workContractId?: string;
    contextPacketId?: string;
    continuityPacketId?: string;
    tokenCostEvidenceIds?: string[];
  };
  sections: {
    found: ProofReportItem[];
    protected: ProofReportItem[];
    fixedOrPrepared: ProofReportItem[];
    verified: ProofReportItem[];
    savedOrAvoided: ProofReportSavingsSection;
    needsAttention: ProofReportItem[];
    next: ProofReportItem[];
  };
  evidenceSummary: {
    tokenCostEvidenceCount: number;
    measuredCount: number;
    importedCount: number;
    estimatedCount: number;
    inferredCount: number;
    unavailableCount: number;
    canShowCostSummary: boolean;
    canShowSavings: boolean;
    unavailableReasons: string[];
  };
  safety: {
    redacted: true;
    containsRawPrompt: false;
    containsRawTranscript: false;
    containsRawSource: false;
    containsRawSecret: false;
    containsEnvValue: false;
    containsTerminalLog: false;
    containsGitDiff: false;
  };
  syncProjectionEligible: boolean;
};

export type ProofReportSyncMetadata = {
  contract: "avorelo.proofReport.sync.v1";
  reportId: string;
  createdAt: string;
  scope: ProofReportScope;
  sectionCounts: { found: number; protected: number; fixedOrPrepared: number; verified: number; needsAttention: number; next: number };
  evidenceCounts: { tokenCostEvidenceCount: number; measuredCount: number; importedCount: number; estimatedCount: number; inferredCount: number; unavailableCount: number };
  canShowCostSummary: boolean;
  savingsClaimAllowed: boolean;
  savingsRefusalReason: string | null;
  redacted: true;
};

// --- Phase 6 (Token & Cost Evidence) — additive type truth (Layer 4: Proof, Value, Cloud — evidence only) ---
// Proof-grade token/cost evidence substrate. EVIDENCE ONLY: no savings claim, no report, no value ledger, no
// pricing engine, no provider integration. Reuses EvidenceConfidence. unavailable != zero != pass != savings.
// Token/Cost Evidence MUST precede any savings claim (Phase 7); Phase 6 itself can never claim savings.

export type TokenCostSource =
  | "measured_runtime"
  | "imported_provider_usage"
  | "imported_cli_usage"
  | "estimated_context_budget"
  | "inferred_from_metadata"
  | "unavailable";

export type TokenCostScope =
  | "session"
  | "work_contract"
  | "context_packet"
  | "continuity_packet"
  | "manual_import"
  | "unknown";

export type CostSource = "measured" | "imported" | "configured_rate_estimate" | "inferred" | "unavailable";

export type TokenCostEvidence = {
  contract: "avorelo.tokenCostEvidence.v1";
  schemaVersion: 1;
  createdAt: string;
  evidenceId: string;
  source: TokenCostSource;
  confidence: EvidenceConfidence;
  scope: TokenCostScope;
  relatedIds?: {
    sessionId?: string;
    workContractId?: string;
    contextPacketId?: string;
    continuityPacketId?: string;
    receiptId?: string;
  };
  model?: { provider?: string; modelName?: string; sourceConfidence: EvidenceConfidence };
  tokens: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    cacheReadTokens?: number | null;
    cacheWriteTokens?: number | null;
    reasoningTokens?: number | null;
    confidence: EvidenceConfidence;
    unavailableReason?: string;
  };
  cost: {
    amount: number | null;
    currency: string | null;
    confidence: EvidenceConfidence;
    source: CostSource;
    unavailableReason?: string;
  };
  safety: {
    redacted: true;
    containsRawPrompt: false;
    containsRawTranscript: false;
    containsRawSource: false;
    containsRawSecret: false;
    containsEnvValue: false;
    containsTerminalLog: false;
    containsGitDiff: false;
  };
  labels: {
    canUseForSavingsClaim: false; // ALWAYS false in Phase 6
    canUseForCostSummary: boolean;
    canUseForTrend: boolean;
    canUseForExactBilling: boolean;
  };
  notes?: string[];
};

// Local-only sanitized import format. Forbidden fields (prompt/transcript/source/diff/env/secret/logs) are
// rejected by the importer; only the metadata below may cross in.
export type TokenCostEvidenceImport = {
  source?: TokenCostSource;
  provider?: string;
  modelName?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  reasoningTokens?: number | null;
  costAmount?: number | null;
  currency?: string | null;
  confidence?: EvidenceConfidence;
  scope?: TokenCostScope;
  relatedIds?: TokenCostEvidence["relatedIds"];
  createdAt?: string;
  [extra: string]: unknown; // extras are screened; forbidden keys cause rejection
};

// The ONLY sync-safe projection of token/cost evidence: metadata only. No prompt/transcript/source/etc.
export type TokenCostEvidenceSyncMetadata = {
  contract: "avorelo.tokenCostEvidence.sync.v1";
  evidenceId: string;
  source: TokenCostSource;
  confidence: EvidenceConfidence;
  scope: TokenCostScope;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costAmount: number | null;
  currency: string | null;
  costConfidence: EvidenceConfidence;
  unavailableReasonCodes: string[];
  redacted: true;
  createdAt: string;
};

export type TokenCostSummary = {
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalTokens: number | null;
  totalCost: number | null;
  currency: string | null;
  mixedCurrency: boolean;
  confidenceBreakdown: Record<EvidenceConfidence, number>;
  measuredCount: number;
  importedCount: number;
  estimatedCount: number;
  inferredCount: number;
  unavailableCount: number;
  canUseForCostSummary: boolean;
  canUseForSavingsClaim: false; // ALWAYS false in Phase 6
  unavailableReasons: string[];
};

// --- Phase 5 (Next-Run Continuity) — additive type truth (Layer 3 continuation) ---
// A redacted, bounded carry-forward packet. Consumes Phase 4 ContextPacket + Phase 3 WorkContract + Phase 2
// Secret Boundary. Never stores raw prompts/secrets/source/logs/diffs/env/sensitive paths. Continuity never
// overrides the Safety Boundary, never lowers proof/approval, never claims token/cost savings.

export type ContinuityStatus = "prepared" | "applied" | "injected" | "expired" | "blocked";

export type NextRunContinuityPacket = {
  contract: "avorelo.nextRunContinuity.v1";
  schemaVersion: 1;
  createdAt: string; // ISO
  expiresAt: string; // ISO (TTL-based)
  sourceSessionId: string; // or work contract id
  objectiveSummary: string; // redacted task label — never raw secret
  route: Route;
  riskClass: RiskClass;
  proofTier: ProofTier;
  approvalPolicy: ApprovalPolicy;
  status: ContinuityStatus;
  completed: boolean;
  decisionsMade: string[];
  openQuestions: string[];
  proofCaptured: string[];
  proofMissing: string[];
  safeNextActions: string[];
  avoidRepeating: string[];
  contextSummary: string; // compact, redacted — NOT the full selectedRefs
  contextPacketRef: string | null; // workContractId of the source ContextPacket (a reference, not the packet)
  safeReferences: SafeReference[];
  excludedRefs: string[]; // reason codes only — never raw paths/labels/content
  riskFlags: string[];
  redacted: true;
  containsRawSecret: false;
  containsRawPrompt: false;
  containsRawSourceDump: false;
  containsTerminalLog: false;
  containsGitDiff: false;
};

// The ONLY sync-safe projection of a continuity packet: metadata only. No objective/decisions/refs text.
export type ContinuitySyncMetadata = {
  contract: "avorelo.nextRunContinuity.sync.v1";
  sourceSessionId: string;
  status: ContinuityStatus;
  route: Route;
  riskClass: RiskClass;
  proofTier: ProofTier;
  approvalPolicy: ApprovalPolicy;
  completed: boolean;
  decisionsCount: number;
  openQuestionsCount: number;
  proofCapturedCount: number;
  proofMissingCount: number;
  safeNextActionsCount: number;
  safeReferenceCount: number;
  excludedReasonCodes: string[];
  riskFlags: string[];
  redacted: true;
  createdAt: string;
  expiresAt: string;
};

// --- Phase 4 (Context Compiler Lite) — additive type truth (Layer 3) ---
// A bounded, source-aware, secret-safe context packet. Consumes the Phase 3 EnrichedWorkContract + the
// Phase 2 Secret Boundary. NO token/cost savings claims here (that is Phase 6). Context optimization can
// NEVER override the Safety Boundary or lower the proof tier.

export type RefKind = "file" | "directory" | "doc" | "receipt" | "test" | "config" | "unknown";
export type RefAuthority = "source_of_truth" | "supporting" | "historical" | "generated" | "unsafe" | "unknown";
export type RefFreshness = "current" | "stale" | "unknown";
export type RefIncludeMode = "path_only" | "summary" | "excerpt" | "exclude";
export type RefSafety = "safe" | "sensitive" | "secret_reference_only" | "excluded";

export type SelectedRef = {
  kind: RefKind;
  label: string; // a safe path/label — never a sensitive raw path when flagged
  reason: string;
  authority: RefAuthority;
  freshness: RefFreshness;
  includeMode: RefIncludeMode;
  safety: RefSafety;
};

export type ExcludedRef = {
  label: string;
  reason: string;
  safetyReasonCode: string;
  canReconsiderWithApproval: boolean;
};

// Context budget — a SIZE CATEGORY only. This is NOT token/cost evidence (Phase 6); no savings are claimed.
export type ContextTargetSize = "tiny" | "small" | "medium" | "deep";
export type EstimatedContextCost = "low" | "medium" | "high";
export type ContextBudgetV1 = { targetSize: ContextTargetSize; estimatedContextCost: EstimatedContextCost; reason: string };

export type ContextPacket = {
  contract: "avorelo.contextPacket.v1";
  schemaVersion: 1;
  createdAt: string; // ISO
  workContractId: string;
  objective: string; // redacted task label (never raw secret)
  route: Route;
  riskClass: RiskClass;
  proofTier: ProofTier;
  approvalPolicy: ApprovalPolicy;
  selectedRefs: SelectedRef[];
  excludedRefs: ExcludedRef[];
  safeReferences: SafeReference[];
  riskFlags: string[];
  proofNeeded: string[];
  contextBudget: ContextBudgetV1;
  redacted: true;
  containsRawSecret: false;
  containsRawPrompt: false;
  containsRawSourceDump: false;
  // IMPORTANT: the full ContextPacket is LOCAL-ONLY and is NEVER a sync payload (it carries objective +
  // selectedRefs + excludedRefs). `cloudEligible` refers ONLY to whether the sanitized metadata projection
  // (buildContextPacketSyncMetadata) may be synced — never the full packet.
  cloudEligible: boolean;
};

// The ONLY part of a ContextPacket that may ever be synced: counts/status/risk/proof metadata. No objective,
// no ref labels, no paths, no task text, no secrets.
export type ContextPacketSyncMetadata = {
  contract: "avorelo.contextPacket.sync.v1";
  workContractId: string;
  route: Route;
  riskClass: RiskClass;
  proofTier: ProofTier;
  approvalPolicy: ApprovalPolicy;
  selectedCount: number;
  excludedCount: number;
  safeReferenceCount: number;
  riskFlags: string[]; // codes only (SEC_*, instruction-risk, source_trust:*)
  contextBudget: ContextTargetSize;
  redacted: true;
  timestamp: string;
};

export type ContextPackConsumer = "executor" | "reviewer" | "proof_adapter";

export type ContextPackAllowedItem = {
  kind: RefKind;
  label: string;
  includeMode: RefIncludeMode;
  authority: RefAuthority;
  freshness: RefFreshness;
  safety: RefSafety;
};

export type ContextPackForbiddenItem = {
  label: string;
  reasonCode: string;
  canReconsiderWithApproval: boolean;
};

export type ContextPackRedactionPolicy = {
  noRawSecrets: true;
  noRawPromptHistory: true;
  noRawSourcePersistence: true;
  noRawDiffPersistence: true;
  noRawDomPersistence: true;
  summarizedSensitiveContextOnly: true;
};

export type ContextPack = {
  contract: "avorelo.contextPack.v1";
  schemaVersion: 1;
  contextPackId: string;
  createdAt: string;
  workContractId: string;
  consumer: ContextPackConsumer;
  selectedAdapter: string;
  reviewerOfAdapter: string | null;
  taskSummary: string;
  riskClass: RiskClass;
  proofTier: ProofTier;
  approvalPolicy: ApprovalPolicy;
  allowedContext: ContextPackAllowedItem[];
  forbiddenContext: ContextPackForbiddenItem[];
  redactionPolicy: ContextPackRedactionPolicy;
  provenanceTags: string[];
  maxContextBudget: ContextTargetSize;
  contextSizeEstimate: EstimatedContextCost;
  contextBudgetUsed: number;
  contextReasonCodes: string[];
  safeForModel: boolean;
  safeForPersistence: boolean;
  relevantReceipts: string[];
  sanitizedDiffSummary: string | null;
  toolInstructions: string[];
  redacted: true;
  containsRawSecret: false;
  containsRawPrompt: false;
  containsRawSourceDump: false;
};

export type ContextPackSyncMetadata = {
  contract: "avorelo.contextPack.sync.v1";
  contextPackId: string;
  workContractId: string;
  consumer: ContextPackConsumer;
  selectedAdapter: string;
  reviewerOfAdapter: string | null;
  riskClass: RiskClass;
  proofTier: ProofTier;
  approvalPolicy: ApprovalPolicy;
  allowedCount: number;
  forbiddenCount: number;
  provenanceTagCount: number;
  maxContextBudget: ContextTargetSize;
  contextBudgetUsed: number;
  contextReasonCodes: string[];
  safeForModel: boolean;
  safeForPersistence: boolean;
  redacted: true;
  timestamp: string;
};

// --- Phase 3 (Enriched WorkContract + Safe Routing) — additive type truth (Layer 2) ---
// Consumes the Phase 2 Secret Boundary (Layer 1) risk; routing/cost can NEVER override the Safety Boundary
// nor lower the proof tier. Types only; routing logic lives in kernel/work-contract/routing.ts.

export type RiskClass = "low" | "medium" | "high" | "critical";

export type Route =
  | "deterministic_only"
  | "targeted_code_edit"
  | "deep_reasoning_required"
  | "browser_proof_required"
  | "needs_decision"
  | "blocked";

export type ProofTier = "none" | "local" | "tests" | "browser" | "production";
export const PROOF_ORDER: ProofTier[] = ["none", "local", "tests", "browser", "production"];

export type ApprovalPolicy = "none" | "require_confirmation" | "require_manual_review" | "blocked";

// A sanitized summary of the Layer-1 Secret Boundary result — codes/decisions only, never raw values.
export type SafetyBoundarySummary = {
  secretBoundaryDecision: "allow" | "redact" | "block" | "require_approval" | "remediate";
  secretRiskCodes: string[]; // SEC_* codes only
  safeRunDecision: "allow" | "require_approval" | "block";
  sourceTrustRisk: "trusted" | "limited" | "untrusted";
  instructionRisk: string[]; // instruction-risk codes only
};

export type CostPolicy = {
  preferDeterministic: boolean;
  avoidDeepModelUnlessNeeded: boolean;
  tokenOptimizationCannotOverrideProof: true; // invariant — literal true
  routingCannotOverrideSafetyBoundary: true; // invariant — literal true
};

// The enriched WorkContract (Layer 2). Extends the Slice-1 WorkContract additively.
export type EnrichedWorkContract = WorkContract & {
  nonGoals: string[];
  disallowedPaths: string[];
  riskClass: RiskClass;
  route: Route;
  proofTier: ProofTier;
  approvalPolicy: ApprovalPolicy;
  safetyBoundary: SafetyBoundarySummary;
  costPolicy: CostPolicy;
};

// --- Phase 1 (Kernel Evidence + Redaction Foundation) — additive type truth ---
// Foundation for later phases (Secret Boundary, Context Compiler, Continuity, Token/Cost Evidence,
// Proof & Savings Report, Value Ledger, Sanitized Cloud Sync). Types only; logic lives in kernel/shared.

// Evidence confidence labels for the efficiency/value layer. DISTINCT from the existing
// `MeasurementConfidence` (used by context-budget) and `ConfidenceLabel` (used by gate DecisionBasis):
// here "unavailable" (not "unverified") is a first-class label meaning "no evidence" — and per the
// foundation rules `unavailable` is NEVER coerced to 0 or to a pass.
export type EvidenceConfidence = "measured" | "imported" | "estimated" | "inferred" | "unavailable";

// Where an evidence value came from (drives trust + sync eligibility downstream).
export type EvidenceSourceKind =
  | "deterministic_check" // a deterministic local check (highest trust)
  | "tool_output" // derived from a tool's output (must be redacted first)
  | "model_opinion" // a model judgement (never sufficient alone)
  | "user_report" // the user said so (lower confidence)
  | "external_import" // imported from an external measurement (labelled "imported")
  | "unknown";

// What the evidence is about.
export type EvidenceKind = "token_cost" | "time" | "outcome" | "safety" | "context" | "generic";

// Redaction lifecycle state of an evidence value / payload.
export type EvidenceRedactionState = "applied" | "not_required" | "pending";

// Cloud sync eligibility of an artifact (decided by the cloud-sync eligibility policy).
export type SyncEligibility = "eligible" | "ineligible" | "not_evaluated";

// A single foundation evidence entry. Carries NO raw value — only a safe label + a safe reference.
export type EvidenceEntry = {
  evidenceId: string;
  source: EvidenceSourceKind;
  kind: EvidenceKind;
  confidence: EvidenceConfidence;
  redactionState: EvidenceRedactionState;
  syncEligibility: SyncEligibility;
  persistLocally: boolean; // local persistence policy: may this entry be written to a local receipt?
  valueLabel: string | null; // human-safe label (e.g. "estimated: ~5k tokens avoided"); never a raw secret/source
  evidenceRef: string | null; // safe reference (id/ledger/test ref); null when confidence is "unavailable"
  reasonCodes: string[];
};

// Safety self-declaration a receipt/payload makes. Every flag MUST be false for the payload to be
// cloud eligible. These are the canonical "no raw X" invariants for receipts and sync payloads.
export type ReceiptSafetyFlags = {
  containsRawPrompt: boolean;
  containsRawTranscript: boolean;
  containsRawSource: boolean;
  containsRawSecret: boolean;
  containsEnvValue: boolean;
  containsTerminalLog: boolean;
  containsGitDiff: boolean;
  containsSensitiveFilePath: boolean;
};

// Validated receipt metadata envelope — what any new receipt can declare (additive to `Receipt`).
export type ValidatedReceiptMeta = {
  schemaName: string; // contract/schema name
  schemaVersion: string; // schema version
  createdAt: number | null; // epoch ms; null = unknown (legacy receipts)
  redacted: boolean;
  flags: ReceiptSafetyFlags;
  cloudEligible: boolean; // DERIVED, never self-asserted true: redacted && all-flags-false && safe reason codes
  syncPolicy: string; // e.g. "allowlist-only-v1"
  evidenceConfidence: EvidenceConfidence;
};

// A safe reference to sensitive content. The FOUNDATION for the future Secret Boundary — it can never
// carry a raw value, and is never exposed to the model nor persisted as a value.
export type SafeReferenceSourceKind = "env" | "file" | "tool_output" | "handoff" | "unknown";
export type SafeReferenceRiskClass = "credential" | "secret_like" | "sensitive" | "source" | "unknown";

export type SafeReference = {
  kind: "safe_reference";
  id: string;
  sourceKind: SafeReferenceSourceKind;
  label: string; // human-safe label, never the value
  riskClass: SafeReferenceRiskClass;
  valueExposedToModel: false; // literal false — structurally cannot be true
  rawValuePersisted: false; // literal false — structurally cannot be true
  safeReasonCodes: string[];
};

// Result of classifying a payload against the allowlist-first redaction policy.
export type PayloadClassification = {
  safe: boolean;
  violations: string[]; // human-readable codes, e.g. "raw_prompt", "raw_secret:aws_access_key", "git_diff"
};

// --- Loop Control V1 types (additive — no changes to existing types) ---

export type LoopMode = "single_run" | "bounded_loop";

export type LoopReadinessStatus =
  | "safe_to_loop"
  | "safe_with_bounded_loop"
  | "needs_human_gate"
  | "not_suitable"
  | "blocked";

export type LoopStopCategory = "success" | "failure" | "safety" | "budget" | "escalation" | "user";

export type LoopStopReason =
  | "success_all_checks_passed"
  | "success_gate_stop_done"
  | "failure_repeated_failure"
  | "failure_no_progress"
  | "failure_check_unavailable"
  | "failure_agent_error"
  | "safety_blocked_path"
  | "safety_secret_detected"
  | "safety_destructive_command"
  | "budget_max_iterations"
  | "budget_max_runtime"
  | "budget_too_many_files"
  | "escalation_rule_triggered"
  | "user_stopped";

export type LoopProofState =
  | "proved"
  | "partially_proved"
  | "not_proved"
  | "needs_attention"
  | "blocked";

export type LoopDriftType = "scope_drift" | "method_drift" | "proof_drift" | "progress_drift";
export type LoopDriftSeverity = "info" | "warning" | "block";

export type LoopDriftFinding = {
  type: LoopDriftType;
  severity: LoopDriftSeverity;
  description: string;
  evidence: string[];
  recommendation: string;
};

export type LoopDriftResult = {
  drifts: LoopDriftFinding[];
  hasCriticalDrift: boolean;
  hasWarningDrift: boolean;
  reasonCodes: string[];
};

export type LoopCheckResultStatus = "passed" | "failed" | "not_run" | "skipped";

export type LoopCheckResult = {
  checkId: string;
  label: string;
  command: string | null;
  type: "test" | "typecheck" | "lint" | "scope_check" | "drift_check" | "custom";
  required: boolean;
  lastResult: LoopCheckResultStatus;
  lastOutput: string | null;
};

export type LoopEscalationAction = "stop" | "notify";

export type LoopEscalationRule = {
  condition: string;
  action: LoopEscalationAction;
  message: string;
};

export type LoopContractExtension = {
  loopId: string;
  mode: LoopMode;
  maxIterations: number;
  maxRuntimeMinutes: number;
  maxTokenBudget: number | null;
  currentIteration: number;
  startedAt: string;
  allowedCommands: string[];
  blockedCommands: string[];
  requiredChecks: LoopCheckResult[];
  escalationRules: LoopEscalationRule[];
};

export type LoopStopCondition = {
  conditionId: string;
  type: "success" | "failure" | "safety" | "budget" | "human_gate";
  condition: string;
  enabled: boolean;
};

export type LoopPolicy = {
  policyId: string;
  mode: LoopMode;
  maxIterations: number;
  maxRuntimeMinutes: number;
  maxTokenBudget: number | null;
  allowedCommands: string[];
  blockedCommands: string[];
  requiredChecks: LoopCheckResult[];
  stopConditions: LoopStopCondition[];
  escalationRules: LoopEscalationRule[];
  receiptLevel: "compact" | "detailed";
  riskTier: RiskClass;
};

export type LoopIterationSummary = {
  iteration: number;
  startedAt: string;
  durationMs: number;
  filesChanged: string[];
  checksRun: string[];
  checkResults: Record<string, LoopCheckResultStatus>;
  driftDetected: boolean;
  gateDecision: GateDecision;
  reasonCodes: string[];
};

export type LoopMetadata = {
  contract: "avorelo.loopMetadata.v1";
  schemaVersion: 1;
  loopId: string;
  contractId: string;
  kernelReceiptRef: string;
  createdAt: string;
  mode: LoopMode;
  iterationsRun: number;
  maxIterations: number;
  totalRuntimeMs: number;
  stopReason: LoopStopReason;
  stopCategory: LoopStopCategory;
  filesChanged: string[];
  filesChangedInScope: number;
  filesChangedOutOfScope: number;
  proofState: LoopProofState;
  checksRun: { checkId: string; label: string; result: LoopCheckResultStatus }[];
  checksPassed: number;
  checksFailed: number;
  checksNotRun: number;
  driftDetected: boolean;
  driftSummary: LoopDriftFinding[];
  iterations: LoopIterationSummary[];
  safeNextActions: string[];
  openIssues: string[];
  safety: {
    redacted: true;
    containsRawPrompt: false;
    containsRawSource: false;
    containsRawSecret: false;
    containsTerminalLog: false;
    containsGitDiff: false;
  };
};

export type LoopReadinessResult = {
  classification: LoopReadinessStatus;
  riskTier: RiskClass;
  reasonCodes: string[];
  recommendedMode: LoopMode;
  recommendedMaxIterations: number;
  recommendedMaxRuntimeMinutes: number;
  requiredProof: string[];
  humanGateConditions: string[];
};

export type LoopResumeExtension = {
  loopId: string;
  iterationsCompleted: number;
  lastStopReason: LoopStopReason;
  lastProofState: LoopProofState;
  failedChecks: string[];
  doNotRepeat: string[];
  suggestedNextObjective: string | null;
};

// --- Loop Control V1 validators ---

export function validateLoopContractExtension(input: Partial<LoopContractExtension>): LoopContractExtension {
  if (!input.loopId || typeof input.loopId !== "string") throw new Error("LoopContractExtension missing loopId");
  if (!input.mode || (input.mode !== "single_run" && input.mode !== "bounded_loop")) throw new Error("LoopContractExtension invalid mode");
  if (typeof input.maxIterations !== "number" || input.maxIterations < 1) throw new Error("LoopContractExtension maxIterations must be >= 1");
  if (typeof input.maxRuntimeMinutes !== "number" || input.maxRuntimeMinutes < 1) throw new Error("LoopContractExtension maxRuntimeMinutes must be >= 1");
  if (typeof input.currentIteration !== "number" || input.currentIteration < 0) throw new Error("LoopContractExtension currentIteration must be >= 0");
  if (!input.startedAt || typeof input.startedAt !== "string") throw new Error("LoopContractExtension missing startedAt");
  return input as LoopContractExtension;
}

export function validateLoopMetadata(input: Partial<LoopMetadata>): LoopMetadata {
  if (input.contract !== "avorelo.loopMetadata.v1") throw new Error("LoopMetadata invalid contract");
  if (input.schemaVersion !== 1) throw new Error("LoopMetadata invalid schemaVersion");
  if (!input.loopId || typeof input.loopId !== "string") throw new Error("LoopMetadata missing loopId");
  if (!input.contractId || typeof input.contractId !== "string") throw new Error("LoopMetadata missing contractId");
  if (!input.kernelReceiptRef || typeof input.kernelReceiptRef !== "string") throw new Error("LoopMetadata missing kernelReceiptRef");
  if (typeof input.iterationsRun !== "number") throw new Error("LoopMetadata missing iterationsRun");
  const validReasons: LoopStopReason[] = [
    "success_all_checks_passed", "success_gate_stop_done",
    "failure_repeated_failure", "failure_no_progress", "failure_check_unavailable", "failure_agent_error",
    "safety_blocked_path", "safety_secret_detected", "safety_destructive_command",
    "budget_max_iterations", "budget_max_runtime", "budget_too_many_files",
    "escalation_rule_triggered", "user_stopped",
  ];
  if (!input.stopReason || !validReasons.includes(input.stopReason)) throw new Error("LoopMetadata invalid stopReason");
  return input as LoopMetadata;
}

// --- Validators ---

export function validateWorkContract(input: Partial<WorkContract>): WorkContract {
  const required: (keyof WorkContract)[] = [
    "contractId",
    "objective",
    "allowedPaths",
    "requestedOutputs",
    "successCriteria",
    "stopConditions",
    "evidenceRefs",
    "reviewReasons",
    "planTier",
  ];
  for (const k of required) {
    if (input[k] === undefined || input[k] === null) {
      throw new Error(`WorkContract missing required field: ${String(k)}`);
    }
  }
  if (typeof input.objective !== "string" || input.objective.length === 0) {
    throw new Error("WorkContract.objective must be a non-empty string");
  }
  return input as WorkContract;
}
