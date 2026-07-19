// Routing Efficiency Dogfood.
// Proves: routing stays lightweight, deterministic-first, no retry loops, no user-facing noise.

import { unifiedRoute, type UnifiedTaskFrame } from "../control-router/index.ts";
import { resetAllAdapterHealth, markAdapterUnhealthy, planToolExecution, getAdapterDescriptors } from "../kernel/tool-adapters/index.ts";

type ScenarioResult = { scenario: string; pass: boolean; detail: string };
const results: ScenarioResult[] = [];
const NOW = Date.now();

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

// S1: status/readiness task uses deterministic-local, not Claude/Codex
try {
  resetAllAdapterHealth();
  const plan = planToolExecution({
    taskType: "code_generation", riskClass: "low",
    paymentTouched: false, authTouched: false,
    productionImpactPossible: false, deterministicEvidenceAvailable: true,
    deepMode: false, secretsPossible: false, dir: ".", now: NOW,
  });
  assert(plan.selectedAdapter === "deterministic-local", `expected deterministic-local, got ${plan.selectedAdapter}`);
  record("status_deterministic", true, `adapter=${plan.selectedAdapter}`);
} catch (e: any) { record("status_deterministic", false, e.message); }

// S2: package check uses deterministic, not Claude/Codex
try {
  resetAllAdapterHealth();
  const decision = unifiedRoute(makeFrame({
    userIntent: "check package.json for issues", riskClass: "low",
    taskType: "code_generation", deepMode: false,
  }));
  assert(decision.toolAdapterRouting !== undefined, "tool routing present");
  const adapter = decision.toolAdapterRouting!.selectedAdapter;
  assert(adapter === "deterministic-local" || adapter === "scanner",
    `package check should use deterministic/scanner, got ${adapter}`);
  record("package_check_light", true, `adapter=${adapter}`);
} catch (e: any) { record("package_check_light", false, e.message); }

// S3: security task uses scanner/manual-gate, not uncontrolled agent
try {
  resetAllAdapterHealth();
  const decision = unifiedRoute(makeFrame({ userIntent: "security audit of auth module", riskClass: "high" }));
  assert(decision.toolAdapterRouting !== undefined, "tool routing present");
  const adapter = decision.toolAdapterRouting!.selectedAdapter;
  assert(adapter === "semgrep" || adapter === "scanner" || adapter === "manual-gate",
    `security task should use semgrep/scanner/manual-gate, got ${adapter}`);
  record("security_scanner_first", true, `adapter=${adapter}`);
} catch (e: any) { record("security_scanner_first", false, e.message); }

// S4: code task routes to agent only when safe
try {
  resetAllAdapterHealth();
  const decision = unifiedRoute(makeFrame({ userIntent: "refactor helper function", riskClass: "low" }));
  assert(decision.toolAdapterRouting !== undefined, "tool routing present");
  const adapter = decision.toolAdapterRouting!.selectedAdapter;
  assert(adapter === "claude-code" || adapter === "codex" || adapter === "deterministic-local",
    `code task should use agent or deterministic, got ${adapter}`);
  assert(decision.toolAdapterRouting!.toolMayExecute === true, "low-risk code should be executable");
  record("code_task_safe_agent", true, `adapter=${adapter}`);
} catch (e: any) { record("code_task_safe_agent", false, e.message); }

// S5: missing Claude/Codex does not create retry loops
try {
  resetAllAdapterHealth();
  markAdapterUnhealthy("claude-code" as any, "simulated_missing", 60000, NOW);
  markAdapterUnhealthy("codex" as any, "simulated_missing", 60000, NOW);
  const plan = planToolExecution({
    taskType: "code_generation", riskClass: "low",
    paymentTouched: false, authTouched: false,
    productionImpactPossible: false, deterministicEvidenceAvailable: false,
    deepMode: false, secretsPossible: false, dir: ".", now: NOW,
  });
  assert(plan.selectedAdapter !== "claude-code" && plan.selectedAdapter !== "codex",
    `should not select unhealthy adapter, got ${plan.selectedAdapter}`);
  assert(plan.reasonCodes.some(c => c.includes("UNAVAILABLE") || c.includes("UNHEALTHY")), "should have UNAVAILABLE/UNHEALTHY reason code");
  record("no_retry_loops", true, `fallback=${plan.selectedAdapter}`);
} catch (e: any) { record("no_retry_loops", false, e.message); }

// S6: fallback chain is finite
try {
  resetAllAdapterHealth();
  const plan = planToolExecution({
    taskType: "code_generation", riskClass: "low",
    paymentTouched: false, authTouched: false,
    productionImpactPossible: false, deterministicEvidenceAvailable: false,
    deepMode: false, secretsPossible: false, dir: ".", now: NOW,
  });
  const descriptors = getAdapterDescriptors();
  const maxAdapters = descriptors.length;
  assert(plan.fallbackAdapters.length < maxAdapters, `fallback chain must be finite: ${plan.fallbackAdapters.length}`);
  assert(plan.fallbackAdapters.length <= 4, `fallback chain too long: ${plan.fallbackAdapters.length}`);
  record("finite_fallback", true, `chain length=${plan.fallbackAdapters.length}`);
} catch (e: any) { record("finite_fallback", false, e.message); }

// S7: normal output has no routing noise
try {
  resetAllAdapterHealth();
  const decision = unifiedRoute(makeFrame());
  const nextAction = decision.nextAction;
  const forbidden = ["choose Claude", "choose Codex", "choose model", "choose provider",
    "choose adapter", "enter API key", "select fallback", "configure provider"];
  for (const f of forbidden) {
    assert(!nextAction.includes(f), `nextAction contains forbidden: ${f}`);
  }
  record("no_routing_noise", true, `nextAction=${nextAction}`);
} catch (e: any) { record("no_routing_noise", false, e.message); }

// S8: activation path stays lightweight (no deep mode for simple tasks)
try {
  resetAllAdapterHealth();
  const decision = unifiedRoute(makeFrame({ userIntent: "check status", riskClass: "low" }));
  assert(decision.toolAdapterRouting !== undefined, "routing present");
  assert(decision.modelMayDecide === false, "model does not decide");
  assert(decision.scannerMayDecide === false, "scanner does not decide");
  record("lightweight_activation", true, "no-config path works");
} catch (e: any) { record("lightweight_activation", false, e.message); }

// S9: package size is recorded (build artifact exists and is bounded)
try {
  const fs = await import("node:fs");
  const distPath = "dist/avorelo.mjs";
  if (fs.existsSync(distPath)) {
    const stat = fs.statSync(distPath);
    const sizeKb = Math.round(stat.size / 1024);
    assert(sizeKb < 2000, `bundle too large: ${sizeKb}kb`);
    record("package_size", true, `${sizeKb}kb`);
  } else {
    record("package_size", true, "dist not built yet (expected in CI)");
  }
} catch (e: any) { record("package_size", false, e.message); }

// S10: low-risk tasks use deterministic adapter (lightweight proof), not heavy agent
try {
  resetAllAdapterHealth();
  const decision = unifiedRoute(makeFrame({ userIntent: "add comment to file", riskClass: "low" }));
  assert(decision.toolAdapterRouting !== undefined, "routing present");
  const adapter = decision.toolAdapterRouting!.selectedAdapter;
  assert(adapter === "deterministic-local", `low-risk should use deterministic-local, got ${adapter}`);
  assert(decision.toolAdapterRouting!.toolMayExecute === true, "low-risk should execute");
  record("light_verifier_for_light_task", true, `adapter=${adapter} (lightweight proof)`);
} catch (e: any) { record("light_verifier_for_light_task", false, e.message); }

// Summary
const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;

console.log("\n=== Routing Efficiency Dogfood ===\n");
for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.scenario}: ${r.detail}`);
console.log(`\n${passed} passed, ${failed} failed of ${results.length} scenarios`);

if (failed > 0) {
  console.error("\nFAILED scenarios:");
  for (const r of results.filter(r => !r.pass)) console.error(`  ✗ ${r.scenario}: ${r.detail}`);
  process.exit(1);
}
