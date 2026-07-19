import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultTeamPolicy, createStrictTeamPolicy, evaluateTeamPolicy,
  applyTeamPolicyToConstraints, validateTeamPolicy,
} from "../src/avorelo/kernel/tool-adapters/team-policy.ts";
import { defaultPolicyConstraints } from "../src/avorelo/kernel/tool-adapters/policies.ts";

describe("Team Policy v1", () => {

  it("creates default team policy with correct contract", () => {
    const policy = createDefaultTeamPolicy("test-team");
    assert.equal(policy.contract, "avorelo.teamPolicy.v1");
    assert.equal(policy.teamName, "test-team");
    assert.equal(policy.defaultEffect, "allow");
    assert.equal(policy.modelMayDecide, false);
    assert.equal(policy.scannerMayDecide, false);
    assert.equal(policy.finalDecisionOwner, "kernel/stop-continue-gate");
  });

  it("default policy has no-raw-persistence", () => {
    const policy = createDefaultTeamPolicy("t");
    assert.equal(policy.containsRawPrompt, false);
    assert.equal(policy.containsRawSource, false);
    assert.equal(policy.containsRawSecret, false);
    assert.equal(policy.containsRawOutput, false);
  });

  it("strict policy denies cursor and requires sandbox", () => {
    const policy = createStrictTeamPolicy("strict-team");
    assert.ok(policy.deniedAdapters?.includes("cursor"));
    assert.equal(policy.requireSandbox, true);
    assert.equal(policy.requireProofCollection, true);
    assert.equal(policy.requireLocalOnly, true);
    assert.equal(policy.denyDataCollection, true);
    assert.equal(policy.maxRiskCeiling, "medium");
  });

  it("strict policy has training-deny rule", () => {
    const policy = createStrictTeamPolicy("t");
    const trainingRule = policy.rules.find(r => r.ruleId === "strict-deny-training");
    assert.ok(trainingRule);
    assert.equal(trainingRule.effect, "deny");
    assert.ok(trainingRule.conditions.dataPolicies?.includes("training_included"));
  });

  it("evaluates allow for default policy with normal adapter", () => {
    const policy = createDefaultTeamPolicy("t");
    const result = evaluateTeamPolicy(policy, "claude-code", "high", "no_training");
    assert.equal(result.effect, "allow");
    assert.equal(result.containsRawPrompt, false);
    assert.equal(result.containsRawSecret, false);
  });

  it("evaluates deny for denied adapter", () => {
    const policy = createStrictTeamPolicy("t");
    const result = evaluateTeamPolicy(policy, "cursor", "low", "unknown");
    assert.equal(result.effect, "deny");
    assert.ok(result.reasonCodes.includes("TEAM_POLICY_ADAPTER_DENIED"));
  });

  it("evaluates deny for risk ceiling exceeded", () => {
    const policy = createStrictTeamPolicy("t");
    const result = evaluateTeamPolicy(policy, "claude-code", "high", "no_training");
    assert.equal(result.effect, "deny");
    assert.ok(result.reasonCodes.includes("TEAM_POLICY_RISK_CEILING_EXCEEDED"));
  });

  it("evaluates deny for training_included data policy", () => {
    const policy = createStrictTeamPolicy("t");
    const result = evaluateTeamPolicy(policy, "codex", "medium", "training_included");
    assert.equal(result.effect, "deny");
  });

  it("evaluates require_approval for high-risk in strict", () => {
    const policy = createStrictTeamPolicy("t");
    policy.maxRiskCeiling = "high";
    const result = evaluateTeamPolicy(policy, "claude-code", "high", "no_training");
    assert.equal(result.effect, "require_approval");
  });

  it("allowed-adapters list denies unlisted adapter", () => {
    const policy = createDefaultTeamPolicy("t");
    policy.allowedAdapters = ["claude-code", "codex"];
    const result = evaluateTeamPolicy(policy, "gemini-cli", "medium", "no_training");
    assert.equal(result.effect, "deny");
    assert.ok(result.reasonCodes.includes("TEAM_POLICY_ADAPTER_NOT_ALLOWED"));
  });

  it("applyTeamPolicyToConstraints merges correctly", () => {
    const policy = createStrictTeamPolicy("t");
    const base = defaultPolicyConstraints();
    const merged = applyTeamPolicyToConstraints(policy, base);
    assert.equal(merged.localOnly, true);
    assert.equal(merged.requireSandbox, true);
    assert.equal(merged.requireProofCollection, true);
    assert.equal(merged.denyDataCollection, true);
    assert.ok(merged.deniedAdapters?.includes("cursor"));
  });

  it("applyTeamPolicyToConstraints takes stricter risk ceiling", () => {
    const policy = createDefaultTeamPolicy("t");
    policy.maxRiskCeiling = "low";
    const base = defaultPolicyConstraints();
    const merged = applyTeamPolicyToConstraints(policy, base);
    assert.equal(merged.maxRiskCeiling, "low");
  });

  it("validateTeamPolicy passes for valid policy", () => {
    const policy = createDefaultTeamPolicy("t");
    const result = validateTeamPolicy(policy);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("validateTeamPolicy catches invalid ownership", () => {
    const policy = createDefaultTeamPolicy("t") as any;
    policy.modelMayDecide = true;
    const result = validateTeamPolicy(policy);
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("model_may_decide_must_be_false"));
  });

  it("strict policy validates cleanly", () => {
    const policy = createStrictTeamPolicy("t");
    const result = validateTeamPolicy(policy);
    assert.equal(result.valid, true);
  });
});
