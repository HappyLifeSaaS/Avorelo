// Tool Adapters Local Dogfood.
// Validates all adapter paths work locally: deterministic-local, manual-gate,
// scanner, and delegated adapters (via fake mode). No network.

import {
  planToolExecution, resetAllAdapterHealth, runToolExecution,
  getAdapterDescriptors, detectAllTools,
  type ExecutionContext, type ToolAdapterId,
} from "../kernel/tool-adapters/index.ts";
import { runRuntimeSession, validateRuntimeSession } from "../capabilities/runtime-flow/index.ts";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

type ScenarioResult = { scenario: string; pass: boolean; detail: string };
const results: ScenarioResult[] = [];
const NOW = 1718500000000;

function record(scenario: string, pass: boolean, detail: string) { results.push({ scenario, pass, detail }); }
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(`ASSERT: ${msg}`); }
function tmpDir(name: string) { const d = join(tmpdir(), `avorelo-df-tal-${name}-${Date.now()}`); mkdirSync(d, { recursive: true }); return d; }

// S1: deterministic-local executes and produces receipt
try {
  resetAllAdapterHealth();
  const dir = process.cwd();
  const plan = planToolExecution({
    taskType: "docs", riskClass: "low",
    paymentTouched: false, authTouched: false,
    productionImpactPossible: false, deterministicEvidenceAvailable: true,
    deepMode: false, secretsPossible: false, dir, now: NOW,
  });
  assert(plan.selectedAdapter === "deterministic-local", `adapter=${plan.selectedAdapter}`);
  const ctx: ExecutionContext = { dir, task: "list the current workspace status", now: NOW, approved: true, useFakeAdapters: false };
  const result = runToolExecution(plan, ctx);
  assert(result.status === "executed", `status=${result.status}`);
  assert(result.receiptId?.startsWith("tpr_"), "receipt");
  record("deterministic_local", true, `status=${result.status}`);
} catch (e: any) { record("deterministic_local", false, e.message); }

// S2: manual-gate blocks production deploy
try {
  resetAllAdapterHealth();
  const plan = planToolExecution({
    taskType: "deploy", riskClass: "high",
    paymentTouched: false, authTouched: false,
    productionImpactPossible: true, deterministicEvidenceAvailable: false,
    deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
  });
  assert(plan.selectedAdapter === "manual-gate", `adapter=${plan.selectedAdapter}`);
  const ctx: ExecutionContext = { dir: tmpdir(), task: "deploy", now: NOW, approved: true, useFakeAdapters: false };
  const result = runToolExecution(plan, ctx);
  assert(result.status === "blocked", `status=${result.status}`);
  record("manual_gate_deploy", true, "production deploy blocked");
} catch (e: any) { record("manual_gate_deploy", false, e.message); }

// S3: scanner for security review
try {
  resetAllAdapterHealth();
  const plan = planToolExecution({
    taskType: "code_generation", riskClass: "high",
    paymentTouched: false, authTouched: true,
    productionImpactPossible: false, deterministicEvidenceAvailable: false,
    deepMode: false, secretsPossible: true, dir: tmpdir(), now: NOW,
  });
  assert(plan.selectedAdapter === "semgrep" || plan.selectedAdapter === "scanner" || plan.selectedAdapter === "manual-gate", `adapter=${plan.selectedAdapter}`);
  assert(plan.proofRequired === true, "proof required for high-risk");
  record("scanner_security", true, `selected=${plan.selectedAdapter}`);
} catch (e: any) { record("scanner_security", false, e.message); }

// S4: all adapter descriptors valid
try {
  const descs = getAdapterDescriptors();
  assert(descs.length === 11, `${descs.length} adapters`);
  const ids = descs.map(d => d.id).sort();
  assert(ids.includes("claude-code"), "claude-code registered");
  assert(ids.includes("codex"), "codex registered");
  assert(ids.includes("deterministic-local"), "deterministic-local registered");
  assert(ids.includes("manual-gate"), "manual-gate registered");
  assert(ids.includes("scanner"), "scanner registered");
  assert(ids.includes("semgrep"), "semgrep registered");
  assert(ids.includes("playwright-proof"), "playwright-proof registered");
  assert(ids.includes("github-actions"), "github-actions registered");
  record("all_descriptors", true, `${descs.length} adapters registered`);
} catch (e: any) { record("all_descriptors", false, e.message); }

// S5: fake adapters for both claude-code and codex
try {
  resetAllAdapterHealth();
  for (const adapter of ["claude-code", "codex"] as ToolAdapterId[]) {
    const plan = planToolExecution({
      taskType: "code_generation", riskClass: "low",
      paymentTouched: false, authTouched: false,
      productionImpactPossible: false, deterministicEvidenceAvailable: false,
      deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
    });
    plan.selectedAdapter = adapter;
    plan.executionMode = "real";
    const ctx: ExecutionContext = { dir: tmpdir(), task: "create a fixture", now: NOW, approved: true, useFakeAdapters: true };
    const result = runToolExecution(plan, ctx);
    assert(result.status === "executed", `${adapter} status=${result.status}`);
    assert(result.delegatedTask!.success === true, `${adapter} delegated success`);
  }
  record("fake_adapters_both", true, "both claude-code and codex fake execution work");
} catch (e: any) { record("fake_adapters_both", false, e.message); }

// S6: runtime session with all adapters produces valid session
try {
  resetAllAdapterHealth();
  const dir = tmpDir("s6");
  try {
    const { record: r } = runRuntimeSession({ task: "add helper function", dir, now: NOW });
    assert(r.toolExecution.selectedAdapter !== undefined, "adapter selected");
    assert(validateRuntimeSession(r).valid, "session valid");
    assert(r.containsRawSecret === false, "no raw secret");
    record("runtime_all_adapters", true, `adapter=${r.toolExecution.selectedAdapter}`);
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
} catch (e: any) { record("runtime_all_adapters", false, e.message); }

// Summary
const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;

console.log("\n=== Tool Adapters Local Dogfood ===\n");
for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.scenario}: ${r.detail}`);
console.log(`\n${passed} passed, ${failed} failed of ${results.length} scenarios`);

if (failed > 0) {
  console.error("\nFAILED scenarios:");
  for (const r of results.filter(r => !r.pass)) console.error(`  ✗ ${r.scenario}: ${r.detail}`);
  process.exit(1);
}
