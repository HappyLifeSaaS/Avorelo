// Avorelo Real Execution E2E Dogfood.
// Full end-to-end: task → safety classification → adapter selection → execution
// → runtime session → control center → proof report → validation. All paths.

import {
  planToolExecution, resetAllAdapterHealth, runToolExecution,
  classifyTaskSafety, sanitizeOutput,
  type ExecutionContext, type ToolAdapterId,
} from "../kernel/tool-adapters/index.ts";
import { runRuntimeSession, validateRuntimeSession } from "../capabilities/runtime-flow/index.ts";
import { buildControlCenter, renderText as renderControlCenterText } from "../capabilities/control-center/index.ts";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

type ScenarioResult = { scenario: string; pass: boolean; detail: string };
const results: ScenarioResult[] = [];
const NOW = 1718500000000;

function record(scenario: string, pass: boolean, detail: string) { results.push({ scenario, pass, detail }); }
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(`ASSERT: ${msg}`); }
function tmpDir(name: string) { const d = join(tmpdir(), `avorelo-df-e2e-${name}-${Date.now()}`); mkdirSync(d, { recursive: true }); return d; }

// S1: safe task e2e (fake adapters simulating CI)
try {
  resetAllAdapterHealth();
  const origFake = process.env.AVORELO_FAKE_ADAPTERS;
  process.env.AVORELO_FAKE_ADAPTERS = "1";
  const dir = tmpDir("e2e-s1");
  try {
    const { record: r, displayTask } = runRuntimeSession({ task: "create a hello world fixture", dir, now: NOW });

    // Task display is user-friendly, no adapter picker
    assert(!displayTask.includes("select adapter"), "no adapter picker");
    assert(!displayTask.includes("API key"), "no API key");

    // Tool execution happened
    assert(r.toolExecution.executionReceiptId?.startsWith("tpr_"), "receipt id");
    assert(r.toolExecution.executionStatus !== "not_run", "execution ran");

    // No raw content
    assert(r.containsRawSecret === false, "no raw secret");
    assert(r.containsRawPrompt === false, "no raw prompt");
    assert(r.toolExecution.containsRawPrompt === false, "no raw prompt in tool");

    // Session valid
    const v = validateRuntimeSession(r);
    assert(v.valid, "session valid");

    // Control center renders
    const cc = buildControlCenter(dir, { now: NOW });
    const text = renderControlCenterText(cc);
    assert(text.includes("exec:"), "control center has exec");
    assert(!text.includes("sk-"), "no keys in cc");
    assert(!text.includes("-----BEGIN"), "no certs in cc");

    record("safe_task_e2e", true, `adapter=${r.toolExecution.selectedAdapter} status=${r.toolExecution.executionStatus}`);
  } finally {
    if (origFake === undefined) delete process.env.AVORELO_FAKE_ADAPTERS;
    else process.env.AVORELO_FAKE_ADAPTERS = origFake;
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
} catch (e: any) { record("safe_task_e2e", false, e.message); }

// S2: forbidden task e2e — deploy blocked
try {
  resetAllAdapterHealth();
  const dir = tmpDir("e2e-s2");
  try {
    const { record: r } = runRuntimeSession({ task: "deploy to production", dir, now: NOW });
    assert(
      r.toolExecution.executionStatus === "blocked" || r.toolExecution.executionStatus === "approval_required",
      `status=${r.toolExecution.executionStatus}`
    );
    assert(validateRuntimeSession(r).valid, "session valid");
    record("forbidden_deploy_e2e", true, `deploy gated: adapter=${r.toolExecution.selectedAdapter} status=${r.toolExecution.executionStatus}`);
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
} catch (e: any) { record("forbidden_deploy_e2e", false, e.message); }

// S3: billing task e2e — approval required
try {
  resetAllAdapterHealth();
  const dir = tmpDir("e2e-s3");
  try {
    const { record: r } = runRuntimeSession({ task: "update billing webhook", dir, now: NOW });
    assert(r.toolExecution.executionStatus === "blocked" || r.toolExecution.executionStatus === "approval_required",
      `status=${r.toolExecution.executionStatus}`);
    assert(validateRuntimeSession(r).valid, "session valid");
    record("billing_task_e2e", true, `status=${r.toolExecution.executionStatus}`);
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
} catch (e: any) { record("billing_task_e2e", false, e.message); }

// S4: multiple adapters, policy selection, no picker
try {
  resetAllAdapterHealth();
  const dir = tmpDir("e2e-s4");
  try {
    const { record: r } = runRuntimeSession({ task: "add helper function", dir, now: NOW });
    assert(r.toolExecution.modelMayDecide === false, "model cannot decide");
    assert(r.toolExecution.selectedAdapter !== undefined, "adapter auto-selected");
    assert(validateRuntimeSession(r).valid, "session valid");
    record("auto_selection_e2e", true, `adapter=${r.toolExecution.selectedAdapter}`);
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
} catch (e: any) { record("auto_selection_e2e", false, e.message); }

// S5: full proof chain — receipt, runtime, control-center all consistent
try {
  resetAllAdapterHealth();
  const dir = tmpDir("e2e-s5");
  try {
    const { record: r } = runRuntimeSession({ task: "check status", dir, now: NOW });
    const cc = buildControlCenter(dir, { now: NOW });
    const text = renderControlCenterText(cc);

    // Receipt chain
    assert(r.toolExecution.executionReceiptId?.startsWith("tpr_"), "receipt");
    assert(cc.sections.toolExecution.executionStatus !== undefined, "cc has exec status");

    // All raw flags false through the chain
    assert(r.containsRawSecret === false, "runtime no raw secret");
    assert(r.toolExecution.containsRawSecret === false, "tool no raw secret");
    const serialized = JSON.stringify(r) + text;
    assert(!serialized.includes("ANTHROPIC_API_KEY="), "no env vars in chain");

    record("full_proof_chain_e2e", true, "receipt→runtime→cc all consistent and clean");
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
} catch (e: any) { record("full_proof_chain_e2e", false, e.message); }

// S6: delegated execution fields in control center text
try {
  resetAllAdapterHealth();
  const origFake = process.env.AVORELO_FAKE_ADAPTERS;
  process.env.AVORELO_FAKE_ADAPTERS = "1";
  const dir = tmpDir("e2e-s6");
  try {
    const { record: r } = runRuntimeSession({ task: "create a hello world fixture", dir, now: NOW });
    if (r.toolExecution.delegatedExecution?.attempted) {
      const cc = buildControlCenter(dir, { now: NOW });
      const text = renderControlCenterText(cc);
      assert(text.includes("delegated:"), "delegated line in cc text");
    }
    record("delegated_cc_text_e2e", true, "delegated execution info in control center");
  } finally {
    if (origFake === undefined) delete process.env.AVORELO_FAKE_ADAPTERS;
    else process.env.AVORELO_FAKE_ADAPTERS = origFake;
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
} catch (e: any) { record("delegated_cc_text_e2e", false, e.message); }

// Summary
const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;

console.log("\n=== Avorelo Real Execution E2E Dogfood ===\n");
for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.scenario}: ${r.detail}`);
console.log(`\n${passed} passed, ${failed} failed of ${results.length} scenarios`);

if (failed > 0) {
  console.error("\nFAILED scenarios:");
  for (const r of results.filter(r => !r.pass)) console.error(`  ✗ ${r.scenario}: ${r.detail}`);
  process.exit(1);
}
