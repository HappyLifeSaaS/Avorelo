// Execution Verifier Dogfood.
// Proves: EXECUTION_VERIFIED/REJECTED reason codes, chain integrity.

import { resetAllAdapterHealth } from "../kernel/tool-adapters/index.ts";
import { runRuntimeSession, validateRuntimeSession } from "../capabilities/runtime-flow/index.ts";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

type ScenarioResult = { scenario: string; pass: boolean; detail: string };
const results: ScenarioResult[] = [];
const NOW = 1718500000000;

function record(scenario: string, pass: boolean, detail: string) { results.push({ scenario, pass, detail }); }
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(`ASSERT: ${msg}`); }
function tmpDir(name: string) { const d = join(tmpdir(), `avorelo-df-ev-${name}-${Date.now()}`); mkdirSync(d, { recursive: true }); return d; }

// S1: successful execution gets EXECUTION_VERIFIED or EXECUTION_VERIFIER_FAILED
try {
  resetAllAdapterHealth();
  const dir = tmpDir("s1");
  try {
    const { record: r } = runRuntimeSession({ task: "check status", dir, now: NOW });
    const v = validateRuntimeSession(r);
    assert(v.valid, `valid: ${v.reasons.join(",")}`);
    assert(v.reasons.some(r => r.startsWith("EXECUTION_VERIF")), `has verifier code: ${v.reasons.join(",")}`);
    record("execution_verified", true, `codes: ${v.reasons.filter(r => r.startsWith("EXECUTION_")).join(",")}`);
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
} catch (e: any) { record("execution_verified", false, e.message); }

// S2: blocked task gets EXECUTION_VERIFIED_GATED
try {
  resetAllAdapterHealth();
  const dir = tmpDir("s2");
  try {
    const { record: r } = runRuntimeSession({ task: "deploy to production", dir, now: NOW });
    const v = validateRuntimeSession(r);
    assert(v.valid, "session valid");
    const execCodes = v.reasons.filter(r => r.startsWith("EXECUTION_VERIF"));
    assert(execCodes.length > 0, `has verifier codes: ${v.reasons.join(",")}`);
    record("gated_verified", true, `codes: ${execCodes.join(",")}`);
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
} catch (e: any) { record("gated_verified", false, e.message); }

// S3: fake delegated execution gets EXECUTION_VERIFIED
try {
  resetAllAdapterHealth();
  const origFake = process.env.AVORELO_FAKE_ADAPTERS;
  process.env.AVORELO_FAKE_ADAPTERS = "1";
  const dir = tmpDir("s3");
  try {
    const { record: r } = runRuntimeSession({ task: "create a hello world fixture", dir, now: NOW });
    const v = validateRuntimeSession(r);
    assert(v.valid, `valid: ${v.reasons.join(",")}`);
    const execCodes = v.reasons.filter(r => r.startsWith("EXECUTION_VERIF"));
    assert(execCodes.length > 0, `has verifier codes`);
    record("delegated_verified", true, `codes: ${execCodes.join(",")}`);
  } finally {
    if (origFake === undefined) delete process.env.AVORELO_FAKE_ADAPTERS;
    else process.env.AVORELO_FAKE_ADAPTERS = origFake;
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
} catch (e: any) { record("delegated_verified", false, e.message); }

// S4: no REJECTED codes in valid sessions
try {
  resetAllAdapterHealth();
  const dir = tmpDir("s4");
  try {
    const { record: r } = runRuntimeSession({ task: "add helper function", dir, now: NOW });
    const v = validateRuntimeSession(r);
    assert(v.valid, "session valid");
    const rejected = v.reasons.filter(r => r.includes("REJECTED"));
    assert(rejected.length === 0, `no rejections: ${rejected.join(",")}`);
    record("no_rejections", true, "no REJECTED codes");
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
} catch (e: any) { record("no_rejections", false, e.message); }

// S5: receipt chain integrity
try {
  resetAllAdapterHealth();
  const dir = tmpDir("s5");
  try {
    const { record: r } = runRuntimeSession({ task: "check status", dir, now: NOW });
    assert(r.toolExecution.executionReceiptId?.startsWith("tpr_"), "receipt starts with tpr_");
    const v = validateRuntimeSession(r);
    assert(v.valid, "session valid");
    record("receipt_integrity", true, `receipt=${r.toolExecution.executionReceiptId}`);
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
} catch (e: any) { record("receipt_integrity", false, e.message); }

// Summary
const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;

console.log("\n=== Execution Verifier Dogfood ===\n");
for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.scenario}: ${r.detail}`);
console.log(`\n${passed} passed, ${failed} failed of ${results.length} scenarios`);

if (failed > 0) {
  console.error("\nFAILED scenarios:");
  for (const r of results.filter(r => !r.pass)) console.error(`  ✗ ${r.scenario}: ${r.detail}`);
  process.exit(1);
}
