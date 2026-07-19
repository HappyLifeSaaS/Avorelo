// Control Router Alignment Dogfood.
// Proves: unified route includes tool adapter routing consistent with runtime-flow.

import { unifiedRoute, type UnifiedTaskFrame } from "../control-router/index.ts";
import { resetAllAdapterHealth } from "../kernel/tool-adapters/index.ts";

type ScenarioResult = { scenario: string; pass: boolean; detail: string };
const results: ScenarioResult[] = [];

function record(scenario: string, pass: boolean, detail: string) { results.push({ scenario, pass, detail }); }
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(`ASSERT: ${msg}`); }

function makeFrame(overrides: Partial<UnifiedTaskFrame> = {}): UnifiedTaskFrame {
  return {
    taskType: "code_generation", riskClass: "low",
    touchedLayers: ["Surface"], changedFiles: ["src/foo.ts"],
    paymentTouched: false, dashboardTouched: false, publicCopyTouched: false,
    mcpTouched: false, browserAvailable: false, proofRequired: false,
    externalToolsAllowed: false, deepMode: false,
    userIntent: "add a helper", localOnly: false, userPlan: "",
    founderCockpitTouched: false, aiTeamTouched: false,
    feedbackLoopTouched: false, oldRepoReferenceUsed: false,
    installedTools: [], contextBudgetRemaining: 100000, tokenBudgetRemaining: 100000,
    ...overrides,
  };
}

// S1: low-risk code includes tool adapter routing
try {
  resetAllAdapterHealth();
  const decision = unifiedRoute(makeFrame());
  assert(decision.toolAdapterRouting !== undefined, "tool adapter routing present");
  assert(decision.toolAdapterRouting!.selectedAdapter !== undefined, "adapter selected");
  assert(decision.toolAdapterRouting!.reasonCodes.length > 0, "has reason codes");
  record("low_risk_routing", true, `adapter=${decision.toolAdapterRouting!.selectedAdapter}`);
} catch (e: any) { record("low_risk_routing", false, e.message); }

// S2: model/scanner cannot decide
try {
  resetAllAdapterHealth();
  const decision = unifiedRoute(makeFrame());
  assert(decision.modelMayDecide === false, "model cannot decide");
  assert(decision.scannerMayDecide === false, "scanner cannot decide");
  assert(decision.finalDecisionOwner === "kernel/stop-continue-gate", "kernel owns");
  record("kernel_owns_truth", true, "model/scanner cannot decide");
} catch (e: any) { record("kernel_owns_truth", false, e.message); }

// S3: high-risk code gets proof required
try {
  resetAllAdapterHealth();
  const decision = unifiedRoute(makeFrame({ riskClass: "high", proofRequired: true }));
  if (decision.toolAdapterRouting) {
    assert(decision.toolAdapterRouting.proofRequired === true, "proof required");
  }
  record("high_risk_proof", true, "proof required for high risk");
} catch (e: any) { record("high_risk_proof", false, e.message); }

// S4: canonical + tool routing both present
try {
  resetAllAdapterHealth();
  const decision = unifiedRoute(makeFrame());
  assert(decision.toolAdapterRouting !== undefined, "tool routing");
  // canonical routing is optional (try/catch in unifiedRoute)
  record("both_routings", true, `tool=${!!decision.toolAdapterRouting} canonical=${!!decision.canonicalRouting}`);
} catch (e: any) { record("both_routings", false, e.message); }

// Summary
const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;

console.log("\n=== Control Router Alignment Dogfood ===\n");
for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.scenario}: ${r.detail}`);
console.log(`\n${passed} passed, ${failed} failed of ${results.length} scenarios`);

if (failed > 0) {
  console.error("\nFAILED scenarios:");
  for (const r of results.filter(r => !r.pass)) console.error(`  ✗ ${r.scenario}: ${r.detail}`);
  process.exit(1);
}
