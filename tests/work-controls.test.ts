import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assessCapabilityHealth,
  buildCapabilityRouteDecision,
  buildWorkControlReceiptSummary,
  detectProposalHints,
  evaluateActionWorthiness,
  normalizeSkillIntake,
  reviewSkillIntake,
} from "../src/avorelo/kernel/work-controls/index.ts";

test("capability route selects controls deterministically without consuming model-routing output", () => {
  const decision = buildCapabilityRouteDecision({
    taskType: "code_generation",
    riskClass: "high",
    proofTier: "tests",
    approvalPolicy: "require_manual_review",
    proposalHints: ["billing_change"],
    paymentTouched: true,
    deepMode: true,
  });

  // `paymentTouched` still detects that the *user's* work touches a payment surface and still
  // raises the risk/approval path. What it no longer does is route into a "payment-readiness"
  // capability: that capability evaluated Avorelo's own discontinued hosted billing (plan
  // free/pro/teams, Lemon Squeezy entitlement read-back) and was removed in F1.
  assert.ok(!decision.selectedCapabilities.includes("payment-readiness"));
  assert.ok(decision.selectedCapabilities.includes("loop-control"));
  assert.ok(!decision.expectedEvidence.includes("billing_readback"));
  assert.ok(decision.requiredApprovals.includes("manual_review"));
  assert.equal(decision.usesModelRoutingOutput, false);
  assert.equal(decision.containsRawPrompt, false);
  assert.ok(!decision.reasonCodes.some((c) => c.includes("ENTITLEMENT_GATE")), "Community Edition: no entitlement gating");
});

test("proposal hints are detected from risky intent text", () => {
  const hints = detectProposalHints("prepare npm publish and production deploy with billing webhook updates");
  assert.ok(hints.includes("npm_publish"));
  assert.ok(hints.includes("production_deploy"));
  assert.ok(hints.includes("billing_change"));
});

test("action worthiness blocks destructive migration", () => {
  const decision = evaluateActionWorthiness({
    objective: "run destructive migration and drop table in production",
    riskClass: "critical",
    approvalPolicy: "none",
  });

  assert.equal(decision.verdict, "block");
  assert.ok(decision.reasonCodes.includes("DESTRUCTIVE_MIGRATION_BLOCKED"));
  assert.ok(decision.saferAlternative);
});

test("action worthiness requires approval for release actions", () => {
  const decision = evaluateActionWorthiness({
    objective: "npm publish and create GitHub release",
    riskClass: "high",
    approvalPolicy: "none",
  });

  assert.equal(decision.verdict, "require_approval");
  assert.ok(decision.requiredApprovals.includes("human_approval"));
  assert.ok(decision.expectedEvidence.includes("package_check"));
});

test("normalize skill intake preserves raw trigger and binding hints while sorting tools", () => {
  const normalized = normalizeSkillIntake({
    intakeId: "skill-1",
    title: " Payment rollout checklist ",
    sourceType: "skill",
    sourceId: "repo/docs",
    version: "v1",
    provenance: "official",
    licenseStatus: "known_allowed",
    owner: "avorelo",
    executionMode: "checklist",
    description: "Checklist for payment rollout.",
    categories: ["payments"],
    rawTrigger: "payment rollout",
    routingTriggers: ["billing", "proof"],
    requiredTools: ["Git", "node"],
    disallowedTools: [],
    privacyReview: "not_needed",
    fixtureExpectations: ["receipt-safe-output"],
    capabilityBindingHint: "payment-readiness",
    evidenceRefs: ["docs/internal/skill-to-capability-operating-layer-spec.md"],
  });

  assert.equal(normalized.rawTrigger, "payment rollout");
  assert.equal(normalized.capabilityBindingHint, "payment-readiness");
  assert.deepEqual(normalized.requiredTools, ["git", "node"]);
});

test("skill intake review blocks unsafe executable promotion", () => {
  const decision = reviewSkillIntake({
    intakeId: "skill-unsafe",
    title: "Unsafe billing tool",
    sourceType: "skill",
    sourceId: "external/repo",
    version: null,
    provenance: "unknown",
    licenseStatus: "unknown",
    owner: null,
    executionMode: "executable",
    description: "Runs billing changes directly.",
    categories: ["billing"],
    rawTrigger: "billing deploy",
    routingTriggers: ["billing", "deploy"],
    requiredTools: ["git", "prod-cli"],
    disallowedTools: ["prod-cli"],
    privacyReview: "required",
    fixtureExpectations: [],
    capabilityBindingHint: "payment-readiness",
    evidenceRefs: [],
  }, { existingBindings: ["payment-readiness"] });

  assert.equal(decision.outcome, "rejected");
  assert.ok(decision.blockers.includes("PRIVACY_REVIEW_REQUIRED_FOR_EXECUTABLE_SKILL"));
  assert.ok(decision.blockers.includes("LICENSE_UNKNOWN_EXECUTABLE_SKILL"));
  assert.ok(decision.blockers.includes("PROVENANCE_UNKNOWN_EXECUTABLE_SKILL"));
  assert.ok(decision.blockers.includes("DISALLOWED_TOOL_CONFLICT"));
  assert.ok(decision.blockers.includes("DUPLICATE_CAPABILITY_BINDING"));
});

test("skill intake review keeps governed checklist as bounded capability input", () => {
  const decision = reviewSkillIntake({
    intakeId: "skill-safe",
    title: "Payment rollout checklist",
    sourceType: "skill",
    sourceId: "repo/docs",
    version: "v1",
    provenance: "official",
    licenseStatus: "known_allowed",
    owner: "avorelo",
    executionMode: "checklist",
    description: "Checklist for payment rollout proof and readback.",
    categories: ["billing"],
    rawTrigger: "payment rollout",
    routingTriggers: ["billing", "proof"],
    requiredTools: ["git"],
    disallowedTools: [],
    privacyReview: "not_needed",
    fixtureExpectations: ["receipt-safe-output"],
    capabilityBindingHint: "payment-readiness",
    evidenceRefs: ["docs/internal/skill-to-capability-operating-layer-spec.md"],
  });

  assert.ok(["kept_as_skill", "bound_to_capability", "archived"].includes(decision.outcome));
  assert.equal(decision.containsRawPrompt, false);
  assert.equal(decision.containsRawSecret, false);
});

test("capability health marks stale controls for review", () => {
  const health = assessCapabilityHealth({
    capabilityKey: "loop-control",
    daysSinceReview: 120,
    falseActivationRate: 0.45,
    proofContribution: 0.2,
  });

  assert.equal(health.state, "stale");
  assert.ok(health.reasonCodes.includes("STALE_OR_HIGH_FALSE_ACTIVATION"));
});

test("receipt summary stays schema-light and safe", () => {
  const route = buildCapabilityRouteDecision({
    taskType: "docs",
    riskClass: "low",
    proofTier: "local",
    approvalPolicy: "none",
    proposalHints: ["docs_only"],
  });
  const action = evaluateActionWorthiness({
    objective: "update docs",
    riskClass: "low",
    approvalPolicy: "none",
    proposalHints: ["docs_only"],
  });
  const summary = buildWorkControlReceiptSummary(route, action);

  assert.equal((summary as any).contract, undefined);
  assert.equal(summary.containsRawPrompt, false);
  assert.equal(summary.containsRawSource, false);
  assert.equal(summary.containsRawSecret, false);
  assert.equal(summary.actionVerdict, "allow_with_bounds");
});
