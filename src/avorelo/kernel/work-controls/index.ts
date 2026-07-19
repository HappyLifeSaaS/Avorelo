import { evaluateCandidate, type Candidate, type Decision, type LicenseStatus, type Provenance } from "../../validation/skill-adoption/index.ts";
import type {
  ActionWorthinessDecision,
  CapabilityBinding,
  CapabilityHealth,
  CapabilityRouteDecision,
  NormalizedSkill,
  SkillAdoptionDecision,
  SkillHealth,
  SkillIntakeRecord,
  WorkControlCapability,
  WorkControlReceiptSummary,
} from "../../shared/schemas/index.ts";

export type CapabilityRouteInput = {
  taskType: string;
  riskClass: "low" | "medium" | "high" | "critical";
  proofTier: string;
  approvalPolicy: string;
  proposalHints?: string[];
  touchedLayers?: string[];
  paymentTouched?: boolean;
  authTouched?: boolean;
  dashboardTouched?: boolean;
  publicCopyTouched?: boolean;
  mcpTouched?: boolean;
  deepMode?: boolean;
  browserAvailable?: boolean;
  founderCockpitTouched?: boolean;
  aiTeamTouched?: boolean;
  oldRepoReferenceUsed?: boolean;
  contextBudgetRemaining?: number;
  tokenBudgetRemaining?: number;
};

export type ActionWorthinessInput = {
  objective: string;
  riskClass: "low" | "medium" | "high" | "critical";
  approvalPolicy: string;
  proposalHints?: string[];
  changedFiles?: string[];
};

export type SkillReviewOptions = {
  existingBindings?: string[];
};

export type CapabilityHealthInput = {
  capabilityKey: string;
  daysSinceReview: number;
  falseActivationRate: number;
  proofContribution: number;
  orphaned?: boolean;
  blocked?: boolean;
};

export type SkillHealthInput = CapabilityHealthInput & { skillId: string };

const CAPABILITY_ORDER: WorkControlCapability[] = [
  "context-check",
  "tool-governance",
  "receipt-trace",
  "model-routing",
  "proof-review",
  "context-efficiency",
  "production-confidence",
  "local-dashboard",
  "context-budget",
  "loop-control",
  "drift-guard",
  "company-loop",
  "founder-cockpit",
];

const CAPABILITY_TO_LEGACY_FEATURE: Partial<Record<WorkControlCapability, string>> = {
  "production-confidence": "visual-proof",
  "local-dashboard": "local-dashboard",
  "context-budget": "autonomous-iteration",
  "loop-control": "autonomous-iteration",
  "company-loop": "team-governance",
};

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function sortCapabilities(values: string[]): string[] {
  return [...values].sort((a, b) => {
    const ia = CAPABILITY_ORDER.indexOf(a as WorkControlCapability);
    const ib = CAPABILITY_ORDER.indexOf(b as WorkControlCapability);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

function pushCapability(
  capabilities: string[],
  evidence: string[],
  reasons: string[],
  capability: WorkControlCapability,
  capabilityReason: string,
  expectedEvidence: string[] = [],
): void {
  capabilities.push(capability);
  reasons.push(capabilityReason);
  evidence.push(...expectedEvidence);
}

export function detectProposalHints(objective: string, changedFiles: string[] = []): string[] {
  const text = `${objective} ${changedFiles.join(" ")}`.toLowerCase();
  const hints: string[] = [];

  if (/\bnpm\s+publish\b/.test(text)) hints.push("npm_publish");
  if (/\bdeploy|production deploy|ship to prod|go live\b/.test(text)) hints.push("production_deploy");
  if (/\bgithub release|create release|release v\d|release candidate\b/.test(text)) hints.push("github_release");
  if (/\bgit tag|create tag|tag release\b/.test(text)) hints.push("git_tag");
  if (/\bbilling|payment|invoice|subscription|webhook\b/.test(text)) hints.push("billing_change");
  if (/\bauth|login|session|security|permission\b/.test(text)) hints.push("auth_security_change");
  if (/\bcredential|secret|token|api key|rotate key|rotate secret\b/.test(text)) hints.push("credential_action");
  if (/\bcustomer|tenant|workspace|user-facing|user facing|live users\b/.test(text)) hints.push("customer_impacting");
  if (/\bmigration|drop table|destructive|delete production data\b/.test(text)) hints.push("destructive_migration");
  if (/\bdocs?|readme|changelog|markdown\b/.test(text)) hints.push("docs_only");
  if (/\bstatus|doctor|health|read-only|read only|explain\b/.test(text)) hints.push("read_only_status");

  return unique(hints);
}

export function buildCapabilityRouteDecision(input: CapabilityRouteInput): CapabilityRouteDecision {
  const selected: string[] = [];
  const suppressed: CapabilityRouteDecision["suppressedCapabilities"] = [];
  const entitlementChecks: CapabilityRouteDecision["entitlementChecks"] = [];
  const requiredApprovals: string[] = [];
  const expectedEvidence: string[] = [];
  const reasonCodes: string[] = [];
  const proposalHints = unique(input.proposalHints ?? []);

  pushCapability(selected, expectedEvidence, reasonCodes, "context-check", "CONTEXT_CHECK_REUSED", ["context_check_result"]);
  pushCapability(selected, expectedEvidence, reasonCodes, "tool-governance", "TOOL_GOVERNANCE_REUSED", ["tool_routing_projection"]);
  pushCapability(selected, expectedEvidence, reasonCodes, "receipt-trace", "KERNEL_RECEIPTS_REUSED", ["kernel_receipt_ref"]);
  pushCapability(selected, expectedEvidence, reasonCodes, "model-routing", "MODEL_ROUTING_SUBORDINATE", ["model_routing_projection"]);

  if (input.proofTier !== "none" && input.proofTier !== "local") {
    pushCapability(selected, expectedEvidence, reasonCodes, "proof-review", "PROOF_REVIEW_REQUIRED", ["proof_report"]);
    pushCapability(selected, expectedEvidence, reasonCodes, "production-confidence", "PRODUCTION_CONFIDENCE_EXPECTED", ["post_action_evidence"]);
  }

  if (input.dashboardTouched) {
    pushCapability(selected, expectedEvidence, reasonCodes, "local-dashboard", "LOCAL_CONTROL_CENTER_RELEVANT", ["local_control_projection"]);
  }

  if (input.deepMode) {
    pushCapability(selected, expectedEvidence, reasonCodes, "loop-control", "BOUNDED_LOOP_REUSED", ["loop_metadata"]);
    pushCapability(selected, expectedEvidence, reasonCodes, "drift-guard", "DRIFT_GUARD_REUSED", ["drift_signal"]);
  }

  if (input.authTouched || input.paymentTouched || input.riskClass === "high" || input.riskClass === "critical") {
    pushCapability(selected, expectedEvidence, reasonCodes, "drift-guard", "HIGH_RISK_DRIFT_GUARD", ["risk_review"]);
  }

  if ((input.contextBudgetRemaining ?? 100) < 25 || input.deepMode || input.publicCopyTouched) {
    pushCapability(selected, expectedEvidence, reasonCodes, "context-budget", "CONTEXT_BUDGET_RELEVANT", ["context_budget_summary"]);
  }

  if ((input.contextBudgetRemaining ?? 100) < 60 || input.deepMode || input.publicCopyTouched) {
    pushCapability(selected, expectedEvidence, reasonCodes, "context-efficiency", "CONTEXT_EFFICIENCY_BRIEF_RECOMMENDED", ["context_efficiency_brief"]);
  }

  if (input.aiTeamTouched) {
    pushCapability(selected, expectedEvidence, reasonCodes, "company-loop", "TEAM_COORDINATION_SIGNAL", ["team_review_summary"]);
  }

  if (input.founderCockpitTouched) {
    pushCapability(selected, expectedEvidence, reasonCodes, "founder-cockpit", "FOUNDER_SURFACE_SIGNAL", ["founder_surface_projection"]);
  }

  if (input.oldRepoReferenceUsed) {
    suppressed.push({
      capability: "proof-review",
      reasonCode: "OLD_REPO_REFERENCE_NOT_RUNTIME_PROOF",
      requiredEntitlement: null,
    });
    reasonCodes.push("OLD_REPO_REFERENCE_NOT_RUNTIME_PROOF");
  }

  if ((input.tokenBudgetRemaining ?? 100000) < 5000) {
    suppressed.push({
      capability: "loop-control",
      reasonCode: "TOKEN_BUDGET_TOO_LOW_FOR_LOOP",
      requiredEntitlement: CAPABILITY_TO_LEGACY_FEATURE["loop-control"] ?? null,
    });
    reasonCodes.push("LOOP_CONTROL_SUPPRESSED_LOW_TOKEN_BUDGET");
  }

  for (const capability of sortCapabilities(unique(selected))) {
    const requiredLegacyFeature = CAPABILITY_TO_LEGACY_FEATURE[capability as WorkControlCapability];
    if (!requiredLegacyFeature) continue;
    // Community Edition: no entitlement gating — every supported capability is available.
    entitlementChecks.push({
      capability,
      requiredLegacyFeature,
      allowed: true,
      reasonCode: "ENTITLEMENT_AVAILABLE",
    });
  }

  if (input.approvalPolicy === "require_manual_review" || input.approvalPolicy === "blocked") {
    requiredApprovals.push("manual_review");
  }

  return {
    selectedCapabilities: sortCapabilities(unique(selected)),
    suppressedCapabilities: suppressed,
    entitlementChecks,
    requiredApprovals: unique(requiredApprovals),
    expectedEvidence: unique(expectedEvidence),
    reasonCodes: unique(reasonCodes),
    proposalHints,
    finalDecisionOwner: "kernel/stop-continue-gate",
    usesModelRoutingOutput: false,
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
  };
}

export function evaluateActionWorthiness(input: ActionWorthinessInput): ActionWorthinessDecision {
  const proposalHints = unique(input.proposalHints ?? detectProposalHints(input.objective, input.changedFiles));
  const requiredApprovals: string[] = [];
  const expectedEvidence: string[] = [];
  const reasonCodes: string[] = [];
  const bounds = ["local_only", "sanitized_receipts_only"];
  let verdict: ActionWorthinessDecision["verdict"] = "allow";
  let saferAlternative: string | null = null;

  if (proposalHints.includes("destructive_migration")) {
    verdict = "block";
    saferAlternative = "prepare a migration plan, backup plan, and readback proof before any destructive step";
    reasonCodes.push("DESTRUCTIVE_MIGRATION_BLOCKED");
    expectedEvidence.push("migration_plan", "backup_confirmation", "readback_plan");
  }

  const approvalHints = [
    "npm_publish",
    "production_deploy",
    "github_release",
    "git_tag",
    "billing_change",
    "credential_action",
    "customer_impacting",
  ];
  if (verdict !== "block" && proposalHints.some((hint) => approvalHints.includes(hint))) {
    verdict = "require_approval";
    requiredApprovals.push("human_approval");
    reasonCodes.push("RISKY_ACTION_REQUIRES_APPROVAL");
  }

  if (verdict === "allow" && proposalHints.includes("auth_security_change")) {
    verdict = "allow_with_bounds";
    reasonCodes.push("AUTH_SECURITY_BOUNDED");
    bounds.push("proof_required");
    expectedEvidence.push("security_review", "secret_scan");
  }

  if (verdict === "allow" && proposalHints.includes("docs_only")) {
    verdict = "allow_with_bounds";
    reasonCodes.push("DOCS_ONLY_SAFE_PATH");
    bounds.push("docs_only_scope");
    expectedEvidence.push("diff_review");
  }

  if (verdict === "allow" && proposalHints.includes("read_only_status")) {
    verdict = "allow_with_bounds";
    reasonCodes.push("READ_ONLY_STATUS_SAFE");
    bounds.push("read_only_execution");
    expectedEvidence.push("read_only_output");
  }

  if (
    verdict === "require_approval" &&
    (proposalHints.includes("production_deploy") || proposalHints.includes("npm_publish") || proposalHints.includes("github_release"))
  ) {
    saferAlternative = "prepare proof, package checks, and a manual release checklist instead of performing the live action";
    expectedEvidence.push("package_check", "release_readiness");
  }

  if (input.approvalPolicy === "blocked") {
    verdict = "block";
    saferAlternative ??= "resolve the existing policy block before execution";
    reasonCodes.push("WORK_CONTRACT_ALREADY_BLOCKED");
  } else if (
    verdict === "allow" &&
    (input.approvalPolicy === "require_manual_review" || input.approvalPolicy === "require_confirmation")
  ) {
    verdict = "suggest_safer_action";
    saferAlternative ??= "keep the change local and gather proof before asking for approval";
    requiredApprovals.push("manual_review");
    reasonCodes.push("WORK_CONTRACT_APPROVAL_ESCALATION");
  }

  if (proposalHints.includes("billing_change")) expectedEvidence.push("billing_readback", "webhook_verification");
  if (proposalHints.includes("credential_action")) expectedEvidence.push("secret_rotation_plan", "secret_scan");
  if (proposalHints.includes("customer_impacting")) expectedEvidence.push("customer_impact_review");

  if (reasonCodes.length === 0) reasonCodes.push("ACTION_SAFE_LOCAL_ONLY");

  return {
    verdict,
    proposalHints,
    requiredApprovals: unique(requiredApprovals),
    saferAlternative,
    bounds: unique(bounds),
    expectedEvidence: unique(expectedEvidence),
    reasonCodes: unique(reasonCodes),
    finalDecisionOwner: "kernel/stop-continue-gate",
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
  };
}

export function normalizeSkillIntake(record: SkillIntakeRecord): NormalizedSkill {
  const title = record.title.trim();
  const skillId = `${record.sourceId}:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "skill"}`;
  const normalizedTriggers = unique(
    [...record.routingTriggers, record.rawTrigger]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  ).sort();

  return {
    skillId,
    title,
    sourceId: record.sourceId,
    executionMode: record.executionMode,
    provenance: record.provenance,
    licenseStatus: record.licenseStatus,
    owner: record.owner,
    normalizedTriggers,
    rawTrigger: record.rawTrigger,
    requiredTools: unique(record.requiredTools.map((value) => value.trim().toLowerCase())).sort(),
    disallowedTools: unique(record.disallowedTools.map((value) => value.trim().toLowerCase())).sort(),
    privacyReview: record.privacyReview,
    fixtureExpectations: unique(record.fixtureExpectations.map((value) => value.trim())).sort(),
    capabilityBindingHint: record.capabilityBindingHint?.trim() || null,
    evidenceRefs: unique(record.evidenceRefs.map((value) => value.trim())).sort(),
  };
}

function toCandidate(record: SkillIntakeRecord): Candidate {
  const licenseStatus = record.licenseStatus === "known_allowed"
    ? "known_ok"
    : record.licenseStatus === "known_restricted"
    ? "incompatible"
    : "unknown";
  const provenance = (record.provenance === "official" ||
      record.provenance === "community" ||
      record.provenance === "user_found" ||
      record.provenance === "old_repo" ||
      record.provenance === "prior_conversation")
    ? record.provenance
    : "unknown";

  return {
    id: record.intakeId,
    name: record.title,
    sourceType: "skill",
    sourceUrl: record.sourceId,
    licenseStatus: licenseStatus as LicenseStatus,
    provenance: provenance as Provenance,
    category: "skill_routing",
    targetUseCase: record.description,
    applicableLayers: ["Validation"],
    expectedValue: record.description,
    expectedRisk: record.executionMode === "executable" ? "can_execute_tools" : "limited",
    contextCost: record.executionMode === "reference" ? "low" : "medium",
    sideEffectLevel: record.executionMode === "executable" ? "local_write" : "read_only",
    conflictsWith: [],
    overlapsWith: record.capabilityBindingHint ? [record.capabilityBindingHint] : [],
    decision: record.executionMode === "reference" ? "ADOPT_AS_REFERENCE" : "ADOPT_CHECKLIST_NOW",
    rationale: "skill intake normalization",
    owner: record.owner ?? "unknown",
    status: "evaluated",
  };
}

function mapCandidateDecision(decision: Decision): SkillAdoptionDecision["outcome"] {
  switch (decision) {
    case "ADOPT_AS_REFERENCE":
      return "archived";
    case "ADOPT_CHECKLIST_NOW":
      return "kept_as_skill";
    case "ADOPT_EXECUTABLE_NOW":
    case "ADOPT_AS_AVORELO_NATIVE_REWRITE":
      return "promotion_candidate";
    case "MERGE_INTO_EXISTING_SKILL":
      return "bound_to_capability";
    default:
      return "rejected";
  }
}

export function reviewSkillIntake(record: SkillIntakeRecord, options: SkillReviewOptions = {}): SkillAdoptionDecision {
  const normalized = normalizeSkillIntake(record);
  const candidate = toCandidate(record);
  const candidateEval = evaluateCandidate(candidate);
  const blockers: string[] = [];
  const reasonCodes = [...candidateEval.findings];
  const verifiedClaims: string[] = [];
  const unverifiedClaims: string[] = [];
  const capabilityBindings: CapabilityBinding[] = [];

  if (normalized.executionMode === "executable" && normalized.privacyReview !== "approved") {
    blockers.push("PRIVACY_REVIEW_REQUIRED_FOR_EXECUTABLE_SKILL");
  }
  if (normalized.licenseStatus === "unknown" && normalized.executionMode === "executable") {
    blockers.push("LICENSE_UNKNOWN_EXECUTABLE_SKILL");
  }
  if (normalized.provenance === "unknown" && normalized.executionMode === "executable") {
    blockers.push("PROVENANCE_UNKNOWN_EXECUTABLE_SKILL");
  }
  if (normalized.requiredTools.some((tool) => normalized.disallowedTools.includes(tool))) {
    blockers.push("DISALLOWED_TOOL_CONFLICT");
  }
  if (
    normalized.capabilityBindingHint &&
    (options.existingBindings ?? []).includes(normalized.capabilityBindingHint)
  ) {
    blockers.push("DUPLICATE_CAPABILITY_BINDING");
  }
  if (normalized.executionMode === "executable" && normalized.fixtureExpectations.length === 0) {
    blockers.push("FIXTURE_EXPECTATIONS_REQUIRED");
  }

  if (normalized.capabilityBindingHint) {
    const requiredLegacyFeature =
      CAPABILITY_TO_LEGACY_FEATURE[normalized.capabilityBindingHint as WorkControlCapability] ?? null;
    capabilityBindings.push({
      capabilityKey: normalized.capabilityBindingHint,
      bindingMode: blockers.length > 0 ? "informational" : "guarded_skill",
      requiredLegacyFeature,
      reasonCodes: blockers.length > 0 ? ["BINDING_BLOCKED"] : ["BINDING_CANDIDATE"],
    });
  }

  if (candidateEval.finalDecision === "ADOPT_AS_REFERENCE") verifiedClaims.push("reference_only_skill_retained_as_evidence");
  if (normalized.executionMode === "executable") unverifiedClaims.push("runtime_truth_remains_with_kernel");
  if (capabilityBindings.length > 0) unverifiedClaims.push("binding_requires_runtime_capability_enforcement");

  const outcome = blockers.length > 0 ? "rejected" : mapCandidateDecision(candidateEval.finalDecision);

  return {
    outcome,
    capabilityBindings,
    reasonCodes: unique(reasonCodes),
    blockers: unique(blockers),
    verifiedClaims: unique(verifiedClaims),
    unverifiedClaims: unique(unverifiedClaims),
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
  };
}

function assessHealthCore(input: CapabilityHealthInput): Omit<CapabilityHealth, "capabilityKey"> {
  const reasonCodes: string[] = [];
  let state: CapabilityHealth["state"] = "healthy";
  let recommendedAction = "keep under routine review";

  if (input.blocked) {
    state = "blocked";
    reasonCodes.push("CAPABILITY_BLOCKED");
    recommendedAction = "resolve blocking issue before promotion";
  } else if (input.orphaned) {
    state = "orphaned";
    reasonCodes.push("ORPHANED_BINDING");
    recommendedAction = "merge or deprecate the orphaned control";
  } else if (input.daysSinceReview > 90 || input.falseActivationRate >= 0.4) {
    state = "stale";
    reasonCodes.push("STALE_OR_HIGH_FALSE_ACTIVATION");
    recommendedAction = "refresh triggers and review proof contribution";
  } else if (input.daysSinceReview > 45 || input.falseActivationRate >= 0.2 || input.proofContribution < 0.3) {
    state = "watch";
    reasonCodes.push("WATCHLIST_THRESHOLD");
    recommendedAction = "tighten routing hints and gather fresh proof";
  }

  return {
    state,
    falseActivationRate: input.falseActivationRate,
    proofContribution: input.proofContribution,
    daysSinceReview: input.daysSinceReview,
    reasonCodes,
    recommendedAction,
  };
}

export function assessCapabilityHealth(input: CapabilityHealthInput): CapabilityHealth {
  return {
    capabilityKey: input.capabilityKey,
    ...assessHealthCore(input),
  };
}

export function assessSkillHealth(input: SkillHealthInput): SkillHealth {
  return {
    skillId: input.skillId,
    ...assessHealthCore(input),
  };
}

export function buildWorkControlReceiptSummary(
  routeDecision: CapabilityRouteDecision,
  actionDecision: ActionWorthinessDecision,
): WorkControlReceiptSummary {
  const entitlementRequired = routeDecision.entitlementChecks
    .filter((check) => !check.allowed)
    .map((check) => check.requiredLegacyFeature);

  return {
    selectedCapabilities: routeDecision.selectedCapabilities,
    suppressedCapabilities: routeDecision.suppressedCapabilities.map((item) => item.capability),
    entitlementRequired: unique(entitlementRequired),
    requiredApprovals: unique([...routeDecision.requiredApprovals, ...actionDecision.requiredApprovals]),
    expectedEvidence: unique([...routeDecision.expectedEvidence, ...actionDecision.expectedEvidence]),
    actionVerdict: actionDecision.verdict,
    reasonCodes: unique([...routeDecision.reasonCodes, ...actionDecision.reasonCodes]),
    verifiedClaims: ["capability_route_built_without_model_truth", "kernel_receipt_lineage_reused"],
    unverifiedClaims: routeDecision.entitlementChecks.some((check) => !check.allowed)
      ? ["entitlement_locked_capabilities_remain_supplemental_until_runtime_gate_allows"]
      : [],
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
  };
}
