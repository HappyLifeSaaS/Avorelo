import {
  assessCapabilityHealth,
  buildCapabilityRouteDecision,
  buildWorkControlReceiptSummary,
  detectProposalHints,
  evaluateActionWorthiness,
  normalizeSkillIntake,
  reviewSkillIntake,
} from "../kernel/work-controls/index.ts";

const proposalHints = detectProposalHints("prepare npm publish and production deploy plan");
const route = buildCapabilityRouteDecision({
  taskType: "code_generation",
  riskClass: "high",
  proofTier: "tests",
  approvalPolicy: "require_manual_review",
  proposalHints,
  paymentTouched: true,
  dashboardTouched: true,
  deepMode: true,
});
const action = evaluateActionWorthiness({
  objective: "prepare npm publish and production deploy plan",
  riskClass: "high",
  approvalPolicy: "require_manual_review",
  proposalHints,
});
const summary = buildWorkControlReceiptSummary(route, action);
const normalizedSkill = normalizeSkillIntake({
  intakeId: "skill-intake-1",
  title: "Payment rollout checklist",
  sourceType: "skill",
  sourceId: "docs/example",
  version: "v1",
  provenance: "official",
  licenseStatus: "known_allowed",
  owner: "avorelo",
  executionMode: "checklist",
  description: "Checklist for payment rollout proof and readback.",
  categories: ["payments"],
  rawTrigger: "payment rollout",
  routingTriggers: ["billing", "proof"],
  requiredTools: ["git"],
  disallowedTools: [],
  privacyReview: "not_needed",
  fixtureExpectations: ["receipt-safe-output"],
  capabilityBindingHint: "proof-review",
  evidenceRefs: ["docs/internal/skill-to-capability-operating-layer-spec.md"],
});
const review = reviewSkillIntake({
  intakeId: "skill-intake-1",
  title: "Payment rollout checklist",
  sourceType: "skill",
  sourceId: "docs/example",
  version: "v1",
  provenance: "official",
  licenseStatus: "known_allowed",
  owner: "avorelo",
  executionMode: "checklist",
  description: "Checklist for payment rollout proof and readback.",
  categories: ["payments"],
  rawTrigger: "payment rollout",
  routingTriggers: ["billing", "proof"],
  requiredTools: ["git"],
  disallowedTools: [],
  privacyReview: "not_needed",
  fixtureExpectations: ["receipt-safe-output"],
  capabilityBindingHint: "proof-review",
  evidenceRefs: ["docs/internal/skill-to-capability-operating-layer-spec.md"],
});
const health = assessCapabilityHealth({
  capabilityKey: "proof-review",
  daysSinceReview: 20,
  falseActivationRate: 0.05,
  proofContribution: 0.8,
});

process.stdout.write(JSON.stringify({
  route,
  action,
  summary,
  normalizedSkill,
  review,
  health,
}, null, 2) + "\n");
