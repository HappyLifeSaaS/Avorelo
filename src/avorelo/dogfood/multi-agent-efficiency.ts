// Dogfood: multi-agent efficiency — verifies multi-agent review is bounded and not wasteful.

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

// S1: Low-risk tasks never trigger multi-agent (efficiency)
const lowRiskTypes = ["deterministic_check", "low_risk_code"] as const;
for (const tc of lowRiskTypes) {
  const input = makePlanInput({ deterministicEvidenceAvailable: tc === "deterministic_check" });
  const plan = planToolExecution(input);
  const trigger = shouldTriggerMultiAgentReview(tc as any, "low", plan);
  check(`no_review_${tc}`, !trigger.trigger, `trigger=${trigger.trigger}`);
}

// S2: Max rounds bounded
const s2Input = makePlanInput({ authTouched: true, riskClass: "high" });
const s2Plan = planToolExecution(s2Input);
s2Plan.selectedAdapter = "claude-code";
const s2Trigger = shouldTriggerMultiAgentReview("security_review", "high", s2Plan);
const s2ReviewPlan = planMultiAgentReview(s2Plan, s2Trigger);
check("max_rounds_bounded", s2ReviewPlan.maxRounds <= 5, `maxRounds=${s2ReviewPlan.maxRounds}`);

// S3: Fake execution records cost/latency
const s3ExecResult: AdapterExecutionResult = {
  adapterId: "claude-code", executionMode: "real", status: "executed",
  output: "done", durationMs: 100, proofCollected: true,
  receiptId: "tpr_eff", reasonCodes: [], failureClass: null, delegatedTask: null,
  containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsRawOutput: false,
};
const s3Ctx: ExecutionContext = {
  dir: ".", task: "efficiency test", now: Date.now(), approved: true,
  useFakeAdapters: true, contextPack: null,
};
const s3Result = executeMultiAgentReview(s2ReviewPlan, s3ExecResult, s2Plan, s3Ctx);
check("cost_recorded", s3Result.totalDurationMs >= 0, `durationMs=${s3Result.totalDurationMs}`);
check("round_count_recorded", s3Result.reasonCodes.some((r) => r.startsWith("REVIEW_ROUNDS:")),
  `reasonCodes include REVIEW_ROUNDS`);

// S4: Disabled review has zero cost
const s4Plan = planToolExecution(makePlanInput());
const s4Trigger = shouldTriggerMultiAgentReview("deterministic_check", "low", s4Plan);
const s4ReviewPlan = planMultiAgentReview(s4Plan, s4Trigger);
const s4Result = executeMultiAgentReview(s4ReviewPlan, s3ExecResult, s4Plan, s3Ctx);
check("disabled_zero_cost", s4Result.totalDurationMs === 0, `durationMs=${s4Result.totalDurationMs}`);
check("disabled_zero_rounds", s4Result.roundsCompleted === 0, `rounds=${s4Result.roundsCompleted}`);

// Summary
const passed = gates.filter((g) => g.pass).length;
const failed = gates.filter((g) => !g.pass);

console.log("\n=== Multi-Agent Efficiency Dogfood ===\n");
for (const g of gates) {
  console.log(`${g.pass ? "✓" : "✗"} ${g.gate}: ${g.detail}`);
}
console.log(`\n${passed} passed, ${failed.length} failed of ${gates.length} gates`);

if (failed.length > 0) process.exit(1);
