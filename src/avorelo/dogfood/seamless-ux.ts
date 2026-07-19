// Seamless UX Contract Dogfood.
// Proves: user never chooses adapter, model, provider, routing profile,
// fallback chain, proof tier, scanner, API keys, or gateway.

import {
  planToolExecution, resetAllAdapterHealth,
  type ExecutionContext,
} from "../kernel/tool-adapters/index.ts";
import { runRuntimeSession, validateRuntimeSession } from "../capabilities/runtime-flow/index.ts";
import { getSkillRegistry } from "../kernel/skills/index.ts";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

type ScenarioResult = { scenario: string; pass: boolean; detail: string };
const results: ScenarioResult[] = [];
const NOW = 1718500000000;

function record(scenario: string, pass: boolean, detail: string) { results.push({ scenario, pass, detail }); }
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(`ASSERT: ${msg}`); }
function tmpDir(name: string) { const d = join(tmpdir(), `avorelo-df-sux-${name}-${Date.now()}`); mkdirSync(d, { recursive: true }); return d; }

// S1: adapter auto-selected, model cannot decide
try {
  resetAllAdapterHealth();
  const plan = planToolExecution({
    taskType: "code_generation", riskClass: "low",
    paymentTouched: false, authTouched: false,
    productionImpactPossible: false, deterministicEvidenceAvailable: false,
    deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
  });
  assert(plan.modelMayDecide === false, "model cannot decide");
  assert(plan.scannerMayDecide === false, "scanner cannot decide");
  assert(plan.selectedAdapter !== undefined, "adapter selected");
  assert(plan.finalDecisionOwner === "kernel/stop-continue-gate", "kernel owns decision");
  record("auto_adapter_selection", true, `adapter=${plan.selectedAdapter}`);
} catch (e: any) { record("auto_adapter_selection", false, e.message); }

// S2: no routing internals in display task
try {
  resetAllAdapterHealth();
  const dir = tmpDir("s2");
  try {
    const { displayTask } = runRuntimeSession({ task: "add a helper function", dir, now: NOW });
    assert(!displayTask.includes("select adapter"), "no adapter picker");
    assert(!displayTask.includes("API key"), "no API key");
    assert(!displayTask.includes("routing profile"), "no routing profile");
    assert(!displayTask.includes("fallback"), "no fallback");
    assert(!displayTask.includes("proof tier"), "no proof tier");
    record("no_internals_in_display", true, "display is clean");
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
} catch (e: any) { record("no_internals_in_display", false, e.message); }

// S3: proof auto-required for high risk
try {
  resetAllAdapterHealth();
  const plan = planToolExecution({
    taskType: "code_generation", riskClass: "high",
    paymentTouched: false, authTouched: true,
    productionImpactPossible: false, deterministicEvidenceAvailable: false,
    deepMode: false, secretsPossible: true, dir: tmpdir(), now: NOW,
  });
  assert(plan.proofRequired === true, "proof auto-required");
  record("auto_proof_tier", true, "proof auto-required for high risk");
} catch (e: any) { record("auto_proof_tier", false, e.message); }

// S4: fallback chain auto-built
try {
  resetAllAdapterHealth();
  const plan = planToolExecution({
    taskType: "code_generation", riskClass: "low",
    paymentTouched: false, authTouched: false,
    productionImpactPossible: false, deterministicEvidenceAvailable: false,
    deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
  });
  assert(Array.isArray(plan.fallbackAdapters), "fallback chain exists");
  record("auto_fallback_chain", true, `fallbacks=${plan.fallbackAdapters.length}`);
} catch (e: any) { record("auto_fallback_chain", false, e.message); }

// S5: skills hidden from user
try {
  const registry = getSkillRegistry();
  assert(registry.length >= 5, "at least 5 skills");
  for (const skill of registry) {
    assert(skill.hidden === true, `${skill.id} hidden`);
  }
  record("skills_hidden", true, `${registry.length} skills all hidden`);
} catch (e: any) { record("skills_hidden", false, e.message); }

// S6: no raw content leaks in e2e
try {
  resetAllAdapterHealth();
  const origFake = process.env.AVORELO_FAKE_ADAPTERS;
  process.env.AVORELO_FAKE_ADAPTERS = "1";
  const dir = tmpDir("s6");
  try {
    const { record: r } = runRuntimeSession({ task: "create a hello world fixture", dir, now: NOW });
    assert(r.containsRawSecret === false, "no raw secret");
    assert(r.containsRawPrompt === false, "no raw prompt");
    const v = validateRuntimeSession(r);
    assert(v.valid, `valid: ${v.reasons.filter(r => !r.startsWith("EXECUTION_VERIF")).join(",")}`);
    record("no_raw_content", true, "no raw content in e2e");
  } finally {
    if (origFake === undefined) delete process.env.AVORELO_FAKE_ADAPTERS;
    else process.env.AVORELO_FAKE_ADAPTERS = origFake;
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
} catch (e: any) { record("no_raw_content", false, e.message); }

// S7: details only in machine-readable output
try {
  resetAllAdapterHealth();
  const dir = tmpDir("s7");
  try {
    const { record: r, displayTask } = runRuntimeSession({ task: "check status", dir, now: NOW });
    assert(!displayTask.includes("deterministic-local"), "no adapter ID in display");
    assert(!displayTask.includes("TASK_CLASS:"), "no reason code in display");
    assert(r.toolExecution.reasonCodes.length > 0, "reason codes in record");
    record("details_in_machine_output", true, "details only in record");
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
} catch (e: any) { record("details_in_machine_output", false, e.message); }

// Summary
const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;

console.log("\n=== Seamless UX Contract Dogfood ===\n");
for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.scenario}: ${r.detail}`);
console.log(`\n${passed} passed, ${failed} failed of ${results.length} scenarios`);

if (failed > 0) {
  console.error("\nFAILED scenarios:");
  for (const r of results.filter(r => !r.pass)) console.error(`  ✗ ${r.scenario}: ${r.detail}`);
  process.exit(1);
}
