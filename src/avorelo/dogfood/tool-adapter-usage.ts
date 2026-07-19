// Tool Adapter Usage-Level Dogfood.
// Proves tool adapter orchestration works through runtime sessions, control-center,
// and unified routing — not only isolated kernel functions.
// Local-only, no network, no API keys.

import { runRuntimeSession, validateRuntimeSession } from "../capabilities/runtime-flow/index.ts";
import { buildControlCenter, renderText as renderControlCenterText } from "../capabilities/control-center/index.ts";
import { resetAllAdapterHealth } from "../kernel/tool-adapters/index.ts";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

type ScenarioResult = {
  scenario: string;
  pass: boolean;
  detail: string;
};

const results: ScenarioResult[] = [];
const NOW = 1718500000000;

function tmpDir(name: string): string {
  const d = join(tmpdir(), `avorelo-tool-usage-${name}-${Date.now()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function cleanDir(d: string) {
  try { rmSync(d, { recursive: true, force: true }); } catch {}
}

function record(scenario: string, pass: boolean, detail: string) {
  results.push({ scenario, pass, detail });
}

function assert(cond: boolean, msg: string) { if (!cond) throw new Error(`ASSERT: ${msg}`); }

// U1: runtime session includes toolExecution with all safety fields
{
  const dir = tmpDir("u1");
  try {
    resetAllAdapterHealth();
    const { record: r } = runRuntimeSession({ task: "add utility function", dir, now: NOW });
    assert(!!r.toolExecution, "toolExecution present");
    assert(r.toolExecution.modelMayDecide === false, "modelMayDecide false");
    assert(r.toolExecution.scannerMayDecide === false, "scannerMayDecide false");
    assert(r.toolExecution.finalDecisionOwner === "kernel/stop-continue-gate", "kernel owns");
    assert(r.toolExecution.containsRawPrompt === false, "no raw prompt");
    assert(r.toolExecution.containsRawSource === false, "no raw source");
    assert(r.toolExecution.containsRawSecret === false, "no raw secret");
    assert(!!r.toolExecution.selectedAdapter, "adapter selected");
    assert(!!r.toolExecution.executionMode, "execution mode set");
    record("runtime_session_tool_execution", true, `adapter=${r.toolExecution.selectedAdapter} mode=${r.toolExecution.executionMode}`);
  } catch (e: any) { record("runtime_session_tool_execution", false, e.message); }
  cleanDir(dir);
}

// U2: runtime session validates with tool execution
{
  const dir = tmpDir("u2");
  try {
    resetAllAdapterHealth();
    const { record: r } = runRuntimeSession({ task: "refactor module", dir, now: NOW });
    const v = validateRuntimeSession(r);
    assert(v.valid, `validation failed: ${v.errors?.join(", ")}`);
    record("runtime_validation_with_tools", true, "runtime session validates with toolExecution");
  } catch (e: any) { record("runtime_validation_with_tools", false, e.message); }
  cleanDir(dir);
}

// U3: control-center shows tool execution section
{
  const dir = tmpDir("u3");
  try {
    resetAllAdapterHealth();
    runRuntimeSession({ task: "lint code", dir, now: NOW });
    const cc = buildControlCenter(dir, { now: NOW });
    const text = renderControlCenterText(cc);
    const te = cc.sections.toolExecution;
    assert(!!te, "toolExecution section exists");
    assert(!text.includes("sk-"), "no API keys in output");
    assert(!text.includes("ANTHROPIC_API_KEY"), "no env vars in output");
    if (te.status === "available") {
      assert(te.modelMayDecide === false, "control-center modelMayDecide false");
      assert(te.finalDecisionOwner === "kernel/stop-continue-gate", "control-center kernel owns");
    }
    record("control_center_tool_section", true, `status=${te.status} adapter=${te.selectedAdapter || "n/a"}`);
  } catch (e: any) { record("control_center_tool_section", false, e.message); }
  cleanDir(dir);
}

// U4: model routing and tool execution coexist without interference
{
  const dir = tmpDir("u4");
  try {
    resetAllAdapterHealth();
    const { record: r } = runRuntimeSession({ task: "write tests", dir, now: NOW });
    assert(!!r.modelRouting, "modelRouting present");
    assert(!!r.toolExecution, "toolExecution present");
    assert(r.modelRouting.modelMayDecide === false, "model routing safe");
    assert(r.toolExecution.modelMayDecide === false, "tool execution safe");
    assert(r.modelRouting.finalDecisionOwner === "kernel/stop-continue-gate", "model routing kernel owns");
    assert(r.toolExecution.finalDecisionOwner === "kernel/stop-continue-gate", "tool execution kernel owns");
    record("model_tool_coexistence", true, "both routing projections present and safe");
  } catch (e: any) { record("model_tool_coexistence", false, e.message); }
  cleanDir(dir);
}

// U5: serialized session contains no raw content
{
  const dir = tmpDir("u5");
  try {
    resetAllAdapterHealth();
    const { record: r } = runRuntimeSession({ task: "update config", dir, now: NOW });
    const json = JSON.stringify(r);
    assert(!json.includes("sk-"), "no API keys");
    assert(!json.includes("ANTHROPIC_API_KEY"), "no env vars");
    assert(r.toolExecution.containsRawPrompt === false, "no raw prompt flag");
    assert(r.toolExecution.containsRawSource === false, "no raw source flag");
    assert(r.toolExecution.containsRawSecret === false, "no raw secret flag");
    record("serialization_safety", true, "no raw content in serialized session");
  } catch (e: any) { record("serialization_safety", false, e.message); }
  cleanDir(dir);
}

// U6: tool execution fallback chain present
{
  const dir = tmpDir("u6");
  try {
    resetAllAdapterHealth();
    const { record: r } = runRuntimeSession({ task: "add feature", dir, now: NOW });
    assert(Array.isArray(r.toolExecution.fallbackAdapters), "fallback chain is array");
    assert(r.toolExecution.reasonCodes.length > 0, "reason codes present");
    record("fallback_chain_present", true, `fallbacks=${r.toolExecution.fallbackAdapters.length} reasons=${r.toolExecution.reasonCodes.length}`);
  } catch (e: any) { record("fallback_chain_present", false, e.message); }
  cleanDir(dir);
}

// Summary
const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;

console.log("\n=== Tool Adapter Usage-Level Dogfood ===\n");
for (const r of results) {
  console.log(`${r.pass ? "✓" : "✗"} ${r.scenario}: ${r.detail}`);
}
console.log(`\n${passed} passed, ${failed} failed of ${results.length} scenarios`);

if (failed > 0) {
  console.error("\nFAILED scenarios:");
  for (const r of results.filter(r => !r.pass)) console.error(`  ✗ ${r.scenario}: ${r.detail}`);
  process.exit(1);
}
