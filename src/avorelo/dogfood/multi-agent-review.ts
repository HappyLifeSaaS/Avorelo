// Dogfood: multi-agent review — selective, proof-backed, bounded review.
// Verifies that multi-agent review is NOT default, triggers on risk, respects ownership contract.

import { planToolExecution, type PlanInput } from "../kernel/tool-adapters/planner.ts";
import { shouldTriggerMultiAgentReview, planMultiAgentReview, executeMultiAgentReview } from "../kernel/tool-adapters/multi-agent-review.ts";
import type { ExecutionContext, AdapterExecutionResult } from "../kernel/tool-adapters/executor.ts";
import { classifyTask } from "../kernel/tool-adapters/policies.ts";

type Gate = { gate: string; pass: boolean; detail: string };
const gates: Gate[] = [];

function check(gate: string, pass: boolean, detail = "") {
  gates.push({ gate, pass, detail });
  if (!pass) console.error(`FAIL: ${gate} — ${detail}`);
}

function makePlanInput(overrides?: Partial<PlanInput>): PlanInput {
  return {
    taskType: "code_generation", riskClass: "low", paymentTouched: false, authTouched: false,
    productionImpactPossible: false, deterministicEvidenceAvailable: false, deepMode: false,
    secretsPossible: false, dir: ".", now: Date.now(),
    ...overrides,
  };
}

// S1: Low-risk deterministic task does NOT trigger multi-agent review
const s1Input = makePlanInput({ deterministicEvidenceAvailable: true });
const s1Plan = planToolExecution(s1Input);
const s1TaskClass = classifyTask(s1Input.taskType, s1Input.riskClass, s1Input);
const s1Trigger = shouldTriggerMultiAgentReview(s1TaskClass, s1Input.riskClass, s1Plan);
check("low_risk_no_review", !s1Trigger.trigger, `trigger=${s1Trigger.trigger}`);

// S2: High-risk security task triggers review with cross-adapter reviewer
const s2Input = makePlanInput({ authTouched: true, riskClass: "high" });
const s2Plan = planToolExecution(s2Input);
s2Plan.selectedAdapter = "claude-code";
const s2TaskClass = classifyTask(s2Input.taskType, s2Input.riskClass, s2Input);
const s2Trigger = shouldTriggerMultiAgentReview(s2TaskClass, s2Input.riskClass, s2Plan);
const s2ReviewPlan = planMultiAgentReview(s2Plan, s2Trigger);
check("high_risk_triggers_review", s2Trigger.trigger, `trigger=${s2Trigger.trigger}`);
check("cross_adapter_reviewer", s2ReviewPlan.reviewerAdapter !== s2ReviewPlan.executorAdapter,
  `executor=${s2ReviewPlan.executorAdapter} reviewer=${s2ReviewPlan.reviewerAdapter}`);

// S3: Ownership contract preserved
check("model_may_not_decide", s2ReviewPlan.modelMayDecide === false, "modelMayDecide must be false");
check("scanner_may_not_decide", s2ReviewPlan.scannerMayDecide === false, "scannerMayDecide must be false");
check("kernel_owns_decision", s2ReviewPlan.finalDecisionOwner === "kernel/stop-continue-gate",
  `owner=${s2ReviewPlan.finalDecisionOwner}`);

// S4: Fake execution produces clean result
const s4ExecResult: AdapterExecutionResult = {
  adapterId: "claude-code", executionMode: "real", status: "executed",
  output: "task completed", durationMs: 100, proofCollected: true,
  receiptId: "tpr_test", reasonCodes: [], failureClass: null, delegatedTask: null,
  containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawOutput: false,
};
const s4Ctx: ExecutionContext = {
  dir: ".", task: "review test", now: Date.now(), approved: true,
  useFakeAdapters: true, contextPack: null,
};
const s4Result = executeMultiAgentReview(s2ReviewPlan, s4ExecResult, s2Plan, s4Ctx);
check("review_attempted", s4Result.attempted, `attempted=${s4Result.attempted}`);
check("no_raw_persistence", s4Result.containsRawModelOutput === false && s4Result.containsRawPrompt === false,
  "no raw content in review result");
check("rounds_recorded", s4Result.roundsCompleted >= 1, `rounds=${s4Result.roundsCompleted}`);
check("duration_recorded", typeof s4Result.totalDurationMs === "number", `duration=${s4Result.totalDurationMs}ms`);

// Summary
const passed = gates.filter((g) => g.pass).length;
const failed = gates.filter((g) => !g.pass);

console.log("\n=== Multi-Agent Review Dogfood ===\n");
for (const g of gates) {
  console.log(`${g.pass ? "✓" : "✗"} ${g.gate}: ${g.detail}`);
}
console.log(`\n${passed} passed, ${failed.length} failed of ${gates.length} gates`);

if (failed.length > 0) process.exit(1);
