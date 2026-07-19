// Codex Adapter Dogfood.
// Proves Codex adapter detection, fake task delegation, graceful not-installed handling.

import {
  planToolExecution, resetAllAdapterHealth, runToolExecution,
  detectAllTools,
  type ExecutionContext,
} from "../kernel/tool-adapters/index.ts";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

type ScenarioResult = { scenario: string; pass: boolean; detail: string };
const results: ScenarioResult[] = [];
const NOW = 1718500000000;

function record(scenario: string, pass: boolean, detail: string) { results.push({ scenario, pass, detail }); }
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(`ASSERT: ${msg}`); }

function codexInstalled(): boolean {
  try { execSync("codex --version", { stdio: "pipe", timeout: 10000 }); return true; } catch { return false; }
}

const installed = codexInstalled();

// S1: detection
try {
  resetAllAdapterHealth();
  const all = detectAllTools(tmpdir(), NOW);
  const cx = all.find(t => t.adapterId === "codex");
  assert(cx !== undefined, "codex in detection list");
  if (!installed) {
    assert(cx!.status === "unavailable", "codex unavailable when not installed");
    assert(cx!.failureClass === "not_installed" || cx!.failureClass === "not_detected", "failure class correct");
  }
  record("codex_detection", true, `installed=${installed} status=${cx!.status}`);
} catch (e: any) { record("codex_detection", false, e.message); }

// S2: graceful not-installed handling (real mode)
if (!installed) {
  try {
    resetAllAdapterHealth();
    const plan = planToolExecution({
      taskType: "code_generation", riskClass: "low",
      paymentTouched: false, authTouched: false,
      productionImpactPossible: false, deterministicEvidenceAvailable: false,
      deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
    });
    plan.selectedAdapter = "codex";
    plan.executionMode = "real";
    const ctx: ExecutionContext = { dir: tmpdir(), task: "create a fixture", now: NOW, approved: true, useFakeAdapters: false };
    const result = runToolExecution(plan, ctx);
    assert(result.status === "skipped", `status=${result.status}`);
    assert(result.reasonCodes.includes("CODEX_NOT_INSTALLED"), "reason code present");
    assert(result.delegatedTask?.failureReason === "codex_not_installed", "failure reason");
    record("codex_not_installed_graceful", true, "graceful skip with correct reason");
  } catch (e: any) { record("codex_not_installed_graceful", false, e.message); }
} else {
  record("codex_not_installed_graceful", true, "skipped — codex is installed");
}

// S3: fake codex delegation
try {
  resetAllAdapterHealth();
  const plan = planToolExecution({
    taskType: "code_generation", riskClass: "low",
    paymentTouched: false, authTouched: false,
    productionImpactPossible: false, deterministicEvidenceAvailable: false,
    deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
  });
  plan.selectedAdapter = "codex";
  plan.executionMode = "real";
  const ctx: ExecutionContext = { dir: tmpdir(), task: "add test helper", now: NOW, approved: true, useFakeAdapters: true };
  const result = runToolExecution(plan, ctx);
  assert(result.status === "executed", `status=${result.status}`);
  assert(result.delegatedTask!.success === true, "fake delegated success");
  assert(result.delegatedTask!.toolVersion === "fake-codex-1.0.0", "fake version");
  assert(result.delegatedTask!.patchSummary?.includes("completed task"), "patch summary");
  assert(result.delegatedTask!.filesChanged.length > 0, "files changed");
  record("codex_fake_delegation", true, "fake codex execution complete with patch/proof");
} catch (e: any) { record("codex_fake_delegation", false, e.message); }

// S4: forbidden task blocked in fake mode
try {
  resetAllAdapterHealth();
  const plan = planToolExecution({
    taskType: "code_generation", riskClass: "low",
    paymentTouched: false, authTouched: false,
    productionImpactPossible: false, deterministicEvidenceAvailable: false,
    deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
  });
  plan.selectedAdapter = "codex";
  plan.executionMode = "real";
  const ctx: ExecutionContext = { dir: tmpdir(), task: "delete all user data", now: NOW, approved: true, useFakeAdapters: true };
  const result = runToolExecution(plan, ctx);
  assert(result.status === "blocked", "forbidden blocked");
  record("codex_forbidden_blocked", true, "delete blocked in fake mode");
} catch (e: any) { record("codex_forbidden_blocked", false, e.message); }

// Summary
const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;

console.log("\n=== Codex Adapter Dogfood ===\n");
for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.scenario}: ${r.detail}`);
console.log(`\n${passed} passed, ${failed} failed of ${results.length} scenarios`);

if (failed > 0) {
  console.error("\nFAILED scenarios:");
  for (const r of results.filter(r => !r.pass)) console.error(`  ✗ ${r.scenario}: ${r.detail}`);
  process.exit(1);
}
