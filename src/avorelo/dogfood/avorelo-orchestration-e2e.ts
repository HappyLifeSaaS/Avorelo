// Avorelo Orchestration End-to-End Dogfood.
// Proves the full pipeline: routing → planning → execution → receipt → control-center.
// Validates real adapter execution behavior, not just metadata.
// Local-only, no network, no API keys.

import { runRuntimeSession, validateRuntimeSession } from "../capabilities/runtime-flow/index.ts";
import { buildControlCenter, renderText as renderControlCenterText } from "../capabilities/control-center/index.ts";
import { resetAllAdapterHealth, runToolExecution, planToolExecution, type ExecutionContext } from "../kernel/tool-adapters/index.ts";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

type ScenarioResult = { scenario: string; pass: boolean; detail: string };
const results: ScenarioResult[] = [];
const NOW = 1718500000000;

function tmpDir(name: string): string {
  const d = join(tmpdir(), `avorelo-e2e-${name}-${Date.now()}`);
  mkdirSync(d, { recursive: true });
  return d;
}
function cleanDir(d: string) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
function record(scenario: string, pass: boolean, detail: string) { results.push({ scenario, pass, detail }); }
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(`ASSERT: ${msg}`); }

// E1: simple local task — deterministic execution with real proof
{
  const dir = tmpDir("e1");
  try {
    resetAllAdapterHealth();
    const { record: r } = runRuntimeSession({ task: "check node version", dir, now: NOW });
    assert(!!r.toolExecution, "toolExecution present");
    assert(!!r.toolExecution.executionStatus, "execution status present");
    assert(!!r.toolExecution.executionReceiptId, "receipt id present");
    assert(typeof r.toolExecution.executionDurationMs === "number", "duration recorded");
    assert(r.toolExecution.containsRawOutput === false, "no raw output");
    assert(r.toolExecution.containsRawModelOutput === false, "no raw model output");
    assert(r.toolExecution.containsRawTerminalOutput === false, "no raw terminal output");
    assert(r.toolExecution.containsRawGitDiff === false, "no raw git diff");
    assert(validateRuntimeSession(r).valid, "session validates");
    record("e2e_deterministic_execution", true, `status=${r.toolExecution.executionStatus} receipt=${r.toolExecution.executionReceiptId}`);
  } catch (e: any) { record("e2e_deterministic_execution", false, e.message); }
  cleanDir(dir);
}

// E2: production deploy — blocked with proof
{
  const dir = tmpDir("e2");
  try {
    resetAllAdapterHealth();
    const { record: r } = runRuntimeSession({ task: "deploy to production", dir, now: NOW });
    assert(!!r.toolExecution, "toolExecution present");
    assert(r.toolExecution.selectedAdapter === "manual-gate", `expected manual-gate, got ${r.toolExecution.selectedAdapter}`);
    assert(!!r.toolExecution.executionReceiptId, "receipt present");
    assert(validateRuntimeSession(r).valid, "session validates");
    record("e2e_production_blocked", true, `adapter=${r.toolExecution.selectedAdapter} status=${r.toolExecution.executionStatus}`);
  } catch (e: any) { record("e2e_production_blocked", false, e.message); }
  cleanDir(dir);
}

// E3: control-center shows execution results
{
  const dir = tmpDir("e3");
  try {
    resetAllAdapterHealth();
    runRuntimeSession({ task: "check readiness", dir, now: NOW });
    const cc = buildControlCenter(dir, { now: NOW });
    const text = renderControlCenterText(cc);
    const te = cc.sections.toolExecution;
    assert(!!te.executionStatus, "execution status in control center");
    assert(!!te.executionReceiptId, "receipt in control center");
    assert(te.containsRawOutput === false, "no raw output in control center");
    assert(text.includes("exec:"), "exec line in text output");
    assert(!text.includes("sk-"), "no API keys");
    record("e2e_control_center_execution", true, `status=${te.executionStatus}`);
  } catch (e: any) { record("e2e_control_center_execution", false, e.message); }
  cleanDir(dir);
}

// E4: fake adapter execution in CI
{
  try {
    resetAllAdapterHealth();
    const plan = planToolExecution({
      taskType: "code_generation", riskClass: "low",
      paymentTouched: false, authTouched: false,
      productionImpactPossible: false, deterministicEvidenceAvailable: false,
      deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
    });
    plan.selectedAdapter = "claude-code";
    plan.executionMode = "dry_run";
    const ctx: ExecutionContext = { dir: tmpdir(), task: "add feature", now: NOW, approved: true, useFakeAdapters: true };
    const result = runToolExecution(plan, ctx);
    assert(result.status === "executed", `expected executed, got ${result.status}`);
    assert(result.reasonCodes.includes("CI_FAKE_ADAPTER"), "CI fake marker present");
    assert(!!result.output?.includes("[fake]"), "fake output present");
    assert(result.containsRawPrompt === false, "no raw prompt");
    record("e2e_ci_fake_adapter", true, `output=${result.output?.slice(0, 60)}`);
  } catch (e: any) { record("e2e_ci_fake_adapter", false, e.message); }
}

// E5: billing task — approval required before execution
{
  try {
    resetAllAdapterHealth();
    const plan = planToolExecution({
      taskType: "code_generation", riskClass: "high",
      paymentTouched: true, authTouched: false,
      productionImpactPossible: false, deterministicEvidenceAvailable: false,
      deepMode: false, secretsPossible: true, dir: tmpdir(), now: NOW,
    });
    const ctx: ExecutionContext = { dir: tmpdir(), task: "update billing", now: NOW, approved: false, useFakeAdapters: false };
    const result = runToolExecution(plan, ctx);
    assert(result.status === "approval_required", `expected approval_required, got ${result.status}`);
    assert(result.reasonCodes.includes("APPROVAL_REQUIRED"), "approval reason present");
    record("e2e_billing_approval_gate", true, `status=${result.status}`);
  } catch (e: any) { record("e2e_billing_approval_gate", false, e.message); }
}

// E6: JSON output contains execution fields, no raw data
{
  const dir = tmpDir("e6");
  try {
    resetAllAdapterHealth();
    const { record: r } = runRuntimeSession({ task: "run linter", dir, now: NOW });
    const json = JSON.stringify(r);
    assert(json.includes("executionStatus"), "executionStatus in JSON");
    assert(json.includes("executionReceiptId"), "executionReceiptId in JSON");
    assert(json.includes("containsRawOutput"), "containsRawOutput in JSON");
    assert(!json.includes("sk-"), "no API keys");
    assert(r.toolExecution.containsRawOutput === false, "no raw output");
    record("e2e_json_execution_fields", true, "all execution fields present, no raw data");
  } catch (e: any) { record("e2e_json_execution_fields", false, e.message); }
  cleanDir(dir);
}

// Summary
const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;

console.log("\n=== Avorelo Orchestration E2E Dogfood ===\n");
for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.scenario}: ${r.detail}`);
console.log(`\n${passed} passed, ${failed} failed of ${results.length} scenarios`);

if (failed > 0) {
  console.error("\nFAILED:");
  for (const r of results.filter(r => !r.pass)) console.error(`  ✗ ${r.scenario}: ${r.detail}`);
  process.exit(1);
}
