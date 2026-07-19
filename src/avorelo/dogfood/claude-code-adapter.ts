// Claude Code Adapter Dogfood.
// Proves Claude Code adapter detection, task delegation, auth handling,
// sandbox safety, and graceful degradation.

import {
  planToolExecution, resetAllAdapterHealth, runToolExecution,
  getEffectiveAvailability, detectAllTools, classifyTaskSafety,
  type ExecutionContext,
} from "../kernel/tool-adapters/index.ts";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

type ScenarioResult = { scenario: string; pass: boolean; detail: string };
const results: ScenarioResult[] = [];
const NOW = 1718500000000;

function record(scenario: string, pass: boolean, detail: string) { results.push({ scenario, pass, detail }); }
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(`ASSERT: ${msg}`); }

function claudeInstalled(): boolean {
  try { execSync("claude --version", { stdio: "pipe", timeout: 10000 }); return true; } catch { return false; }
}

const installed = claudeInstalled();

// S1: detection
try {
  resetAllAdapterHealth();
  const all = detectAllTools(tmpdir(), NOW);
  const cc = all.find(t => t.adapterId === "claude-code");
  assert(cc !== undefined, "claude-code in detection list");
  if (installed) {
    assert(cc!.status === "available", "claude-code available");
  } else {
    assert(cc!.status === "unavailable", "claude-code unavailable when not installed");
  }
  record("claude_code_detection", true, `installed=${installed} status=${cc!.status} version=${cc!.version}`);
} catch (e: any) { record("claude_code_detection", false, e.message); }

// S2: safe task delegation (fake mode)
try {
  resetAllAdapterHealth();
  const plan = planToolExecution({
    taskType: "code_generation", riskClass: "low",
    paymentTouched: false, authTouched: false,
    productionImpactPossible: false, deterministicEvidenceAvailable: false,
    deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
  });
  plan.selectedAdapter = "claude-code";
  plan.executionMode = "real";
  const ctx: ExecutionContext = { dir: tmpdir(), task: "create a fixture file", now: NOW, approved: true, useFakeAdapters: true };
  const result = runToolExecution(plan, ctx);
  assert(result.status === "executed", `status=${result.status}`);
  assert(result.delegatedTask!.success === true, "fake delegated success");
  assert(result.containsRawSecret === false, "no raw secret");
  record("claude_safe_delegation_fake", true, `patchSummary=${result.delegatedTask!.patchSummary}`);
} catch (e: any) { record("claude_safe_delegation_fake", false, e.message); }

// S3: forbidden task blocked
try {
  resetAllAdapterHealth();
  const plan = planToolExecution({
    taskType: "code_generation", riskClass: "low",
    paymentTouched: false, authTouched: false,
    productionImpactPossible: false, deterministicEvidenceAvailable: false,
    deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
  });
  plan.selectedAdapter = "claude-code";
  plan.executionMode = "real";
  const ctx: ExecutionContext = { dir: tmpdir(), task: "npm publish package", now: NOW, approved: true, useFakeAdapters: true };
  const result = runToolExecution(plan, ctx);
  assert(result.status === "blocked", "forbidden blocked");
  record("claude_forbidden_blocked", true, "npm publish blocked even in fake mode");
} catch (e: any) { record("claude_forbidden_blocked", false, e.message); }

// S4: real execution (if installed)
if (installed) {
  try {
    resetAllAdapterHealth();
    const plan = planToolExecution({
      taskType: "code_generation", riskClass: "low",
      paymentTouched: false, authTouched: false,
      productionImpactPossible: false, deterministicEvidenceAvailable: false,
      deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
    });
    plan.selectedAdapter = "claude-code";
    plan.executionMode = "real";
    const ctx: ExecutionContext = { dir: tmpdir(), task: "create a hello world fixture", now: NOW, approved: true, useFakeAdapters: false };
    const result = runToolExecution(plan, ctx);
    assert(result.delegatedTask !== null, "delegated task present");
    assert(result.delegatedTask!.toolVersion !== null, "tool version detected");
    assert(result.containsRawPrompt === false, "no raw prompt");
    if (result.delegatedTask!.authRequired) {
      assert(result.status === "blocked" || result.status === "skipped", "auth blocks or skips");
    }
    record("claude_real_execution", true, `status=${result.status} authRequired=${result.delegatedTask!.authRequired}`);
  } catch (e: any) { record("claude_real_execution", false, e.message); }
} else {
  record("claude_real_execution", true, "skipped — claude not installed");
}

// S5: unapproved task requires approval
try {
  resetAllAdapterHealth();
  const plan = planToolExecution({
    taskType: "code_generation", riskClass: "low",
    paymentTouched: false, authTouched: false,
    productionImpactPossible: false, deterministicEvidenceAvailable: false,
    deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
  });
  plan.selectedAdapter = "claude-code";
  plan.executionMode = "real";
  plan.approvalRequired = true;
  const ctx: ExecutionContext = { dir: tmpdir(), task: "create a fixture", now: NOW, approved: false, useFakeAdapters: false };
  const result = runToolExecution(plan, ctx);
  assert(result.status === "approval_required", `status=${result.status}`);
  record("claude_approval_required", true, "unapproved task blocked");
} catch (e: any) { record("claude_approval_required", false, e.message); }

// Summary
const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;

console.log("\n=== Claude Code Adapter Dogfood ===\n");
for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.scenario}: ${r.detail}`);
console.log(`\n${passed} passed, ${failed} failed of ${results.length} scenarios`);

if (failed > 0) {
  console.error("\nFAILED scenarios:");
  for (const r of results.filter(r => !r.pass)) console.error(`  ✗ ${r.scenario}: ${r.detail}`);
  process.exit(1);
}
