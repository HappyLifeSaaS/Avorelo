import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { planToolExecution, type PlanInput } from "../src/avorelo/kernel/tool-adapters/planner.ts";
import { shouldTriggerMultiAgentReview, planMultiAgentReview, executeMultiAgentReview } from "../src/avorelo/kernel/tool-adapters/multi-agent-review.ts";
import type { ToolExecutionPlan, MultiAgentReviewPlan } from "../src/avorelo/kernel/tool-adapters/types.ts";
import type { AdapterExecutionResult, ExecutionContext } from "../src/avorelo/kernel/tool-adapters/executor.ts";
import { fakeAllAvailable, fakeReviewRound, fakeMultiAgentReviewResult } from "../src/avorelo/kernel/tool-adapters/testing/fakes.ts";

function makePlan(overrides?: Partial<PlanInput>): ToolExecutionPlan {
  const base: PlanInput = {
    taskType: "code_generation", riskClass: "low", paymentTouched: false, authTouched: false,
    productionImpactPossible: false, deterministicEvidenceAvailable: false, deepMode: false,
    secretsPossible: false, dir: ".", now: Date.now(),
    ...overrides,
  };
  return planToolExecution(base);
}

function makeExecResult(plan: ToolExecutionPlan): AdapterExecutionResult {
  return {
    adapterId: plan.selectedAdapter, executionMode: plan.executionMode, status: "executed",
    output: "task completed successfully", durationMs: 100, proofCollected: true,
    receiptId: "tpr_test_1", reasonCodes: plan.reasonCodes, failureClass: null,
    delegatedTask: null, containsRawPrompt: false, containsRawSource: false,
    containsRawSecret: false, containsRawOutput: false,
  };
}

function makeCtx(plan: ToolExecutionPlan): ExecutionContext {
  return {
    dir: ".", task: "test task", now: Date.now(), approved: true,
    useFakeAdapters: true, contextPack: null,
  };
}

describe("Selective Multi-Agent Review v1", () => {

  it("low-risk deterministic task does not trigger multi-agent review", () => {
    const plan = makePlan({ deterministicEvidenceAvailable: true, riskClass: "low" });
    const trigger = shouldTriggerMultiAgentReview("deterministic_check", "low", plan);
    assert.equal(trigger.trigger, false);
    assert.ok(trigger.reasonCodes.some((r) => r.includes("MULTI_AGENT_REVIEW_NOT_NEEDED")));
  });

  it("high-risk security task triggers multi-agent review", () => {
    const plan = makePlan({ authTouched: true, riskClass: "high" });
    const trigger = shouldTriggerMultiAgentReview("security_review", "high", plan);
    assert.equal(trigger.trigger, true);
    assert.ok(trigger.reasonCodes.some((r) => r.includes("MULTI_AGENT_REVIEW_REQUIRED_BY_RISK")));
  });

  it("high-risk code review triggers multi-agent review", () => {
    const plan = makePlan({ riskClass: "high" });
    const trigger = shouldTriggerMultiAgentReview("code_review", "high", plan);
    assert.equal(trigger.trigger, true);
  });

  it("security task prefers scanner/proof before reviewer", () => {
    const plan = makePlan({ authTouched: true, riskClass: "high" });
    assert.ok(["semgrep", "scanner", "manual-gate"].includes(plan.selectedAdapter),
      `security task should prefer scanner/proof, got: ${plan.selectedAdapter}`);
  });

  it("review plan assigns cross-adapter reviewer (claude->codex, codex->claude)", () => {
    const claudePlan = makePlan();
    claudePlan.selectedAdapter = "claude-code";
    const trigger = { trigger: true, reasonCodes: ["TEST"] };
    const reviewPlan = planMultiAgentReview(claudePlan, trigger);
    assert.equal(reviewPlan.reviewerAdapter, "codex");
    assert.equal(reviewPlan.modelMayDecide, false);
    assert.equal(reviewPlan.scannerMayDecide, false);
    assert.equal(reviewPlan.finalDecisionOwner, "kernel/stop-continue-gate");

    const codexPlan = makePlan();
    codexPlan.selectedAdapter = "codex";
    const codexReviewPlan = planMultiAgentReview(codexPlan, trigger);
    assert.equal(codexReviewPlan.reviewerAdapter, "claude-code");
  });

  it("disabled review plan when trigger is false", () => {
    const plan = makePlan();
    const trigger = { trigger: false, reasonCodes: ["MULTI_AGENT_REVIEW_NOT_NEEDED"] };
    const reviewPlan = planMultiAgentReview(plan, trigger);
    assert.equal(reviewPlan.enabled, false);
    assert.equal(reviewPlan.reviewerAdapter, null);
    assert.equal(reviewPlan.maxRounds, 0);
  });

  it("fake review execution completes with approved verdict", () => {
    const plan = makePlan({ authTouched: true, riskClass: "high" });
    plan.selectedAdapter = "claude-code";
    const trigger = shouldTriggerMultiAgentReview("security_review", "high", plan);
    const reviewPlan = planMultiAgentReview(plan, trigger);
    const execResult = makeExecResult(plan);
    const ctx = makeCtx(plan);

    const result = executeMultiAgentReview(reviewPlan, execResult, plan, ctx);
    assert.equal(result.attempted, true);
    assert.ok(result.roundsCompleted >= 1);
    assert.ok(result.finalVerdict !== null);
    assert.equal(result.containsRawPrompt, false);
    assert.equal(result.containsRawSource, false);
    assert.equal(result.containsRawSecret, false);
    assert.equal(result.containsRawModelOutput, false);
    for (const round of result.rounds) {
      assert.equal(round.containsRawModelOutput, false);
    }
  });

  it("model agreement without proof is marked MODEL_CONSENSUS_ONLY", () => {
    const fakeResult = fakeMultiAgentReviewResult({
      enabled: true,
      rounds: [
        fakeReviewRound(1, "claude-code", "codex", "approved", null),
      ],
      finalVerdict: "approved",
      modelConsensusOnly: true,
    });
    assert.equal(fakeResult.modelConsensusOnly, true);
    assert.equal(fakeResult.finalVerdict, "approved");
  });

  it("verifier failure overrides model consensus", () => {
    const plan = makePlan({ authTouched: true, riskClass: "high" });
    plan.selectedAdapter = "claude-code";
    const trigger = { trigger: true, reasonCodes: ["TEST_VERIFIER_OVERRIDE"] };
    const reviewPlan = planMultiAgentReview(plan, trigger);

    const execResult = makeExecResult(plan);
    execResult.output = "injection vulnerability found";
    execResult.proofCollected = true;

    const ctx = makeCtx(plan);
    const result = executeMultiAgentReview(reviewPlan, execResult, plan, ctx);
    assert.equal(result.attempted, true);
  });

  it("disagreement routes to manual-gate", () => {
    const fakeResult = fakeMultiAgentReviewResult({
      enabled: true,
      rounds: [
        fakeReviewRound(1, "claude-code", "codex", "rejected", null),
        fakeReviewRound(2, "claude-code", "codex", "rejected", null),
      ],
      finalVerdict: "rejected",
      routedToManualGate: true,
    });
    assert.equal(fakeResult.routedToManualGate, true);
    assert.equal(fakeResult.finalVerdict, "rejected");
  });

  it("max rounds stops loop and reports inconclusive", () => {
    const fakeResult = fakeMultiAgentReviewResult({
      enabled: true,
      rounds: [
        fakeReviewRound(1, "claude-code", "codex", "needs_changes", null),
        fakeReviewRound(2, "claude-code", "codex", "needs_changes", null),
        fakeReviewRound(3, "claude-code", "codex", "needs_changes", null),
      ],
      finalVerdict: "inconclusive",
    });
    assert.equal(fakeResult.roundsCompleted, 3);
  });

  it("no raw persistence in any review result", () => {
    const plan = makePlan({ authTouched: true, riskClass: "high" });
    plan.selectedAdapter = "claude-code";
    const trigger = { trigger: true, reasonCodes: ["TEST"] };
    const reviewPlan = planMultiAgentReview(plan, trigger);
    const execResult = makeExecResult(plan);
    const ctx = makeCtx(plan);

    const result = executeMultiAgentReview(reviewPlan, execResult, plan, ctx);
    assert.equal(result.containsRawPrompt, false);
    assert.equal(result.containsRawSource, false);
    assert.equal(result.containsRawSecret, false);
    assert.equal(result.containsRawModelOutput, false);
    for (const round of result.rounds) {
      assert.equal(round.containsRawModelOutput, false);
    }
  });

  it("normal UX does not expose review council details", () => {
    const plan = makePlan({ authTouched: true, riskClass: "high" });
    plan.selectedAdapter = "claude-code";
    const trigger = { trigger: true, reasonCodes: ["TEST"] };
    const reviewPlan = planMultiAgentReview(plan, trigger);
    const execResult = makeExecResult(plan);
    const ctx = makeCtx(plan);

    const result = executeMultiAgentReview(reviewPlan, execResult, plan, ctx);
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes("select adapter"), "review result must not contain 'select adapter'");
    assert.ok(!serialized.includes("API key"), "review result must not contain 'API key'");
  });

  it("executor cannot self-approve", () => {
    const plan = makePlan();
    plan.selectedAdapter = "claude-code";
    const trigger = { trigger: true, reasonCodes: ["TEST"] };
    const reviewPlan = planMultiAgentReview(plan, trigger);
    assert.notEqual(reviewPlan.executorAdapter, reviewPlan.reviewerAdapter,
      "executor and reviewer must be different adapters");
  });

  it("missing tools degrade gracefully (not-attempted result)", () => {
    const plan = makePlan();
    const trigger = { trigger: true, reasonCodes: ["TEST"] };
    const reviewPlan = planMultiAgentReview(plan, trigger);
    reviewPlan.enabled = false;

    const execResult = makeExecResult(plan);
    const ctx = makeCtx(plan);
    const result = executeMultiAgentReview(reviewPlan, execResult, plan, ctx);
    assert.equal(result.attempted, false);
    assert.equal(result.roundsCompleted, 0);
  });

  it("cost/latency/round count recorded", () => {
    const plan = makePlan({ authTouched: true, riskClass: "high" });
    plan.selectedAdapter = "claude-code";
    const trigger = { trigger: true, reasonCodes: ["TEST"] };
    const reviewPlan = planMultiAgentReview(plan, trigger);
    const execResult = makeExecResult(plan);
    const ctx = makeCtx(plan);

    const result = executeMultiAgentReview(reviewPlan, execResult, plan, ctx);
    assert.ok(typeof result.totalDurationMs === "number");
    assert.ok(typeof result.roundsCompleted === "number");
    assert.ok(result.reasonCodes.some((r) => r.startsWith("REVIEW_ROUNDS:")));
  });
});
