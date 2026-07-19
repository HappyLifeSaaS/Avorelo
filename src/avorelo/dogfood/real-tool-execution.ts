// Real Tool Execution Dogfood.
// Validates delegated Claude Code / Codex task execution, sandbox safety,
// fake adapter contract, and runtime integration end-to-end.

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
function tmpDir(name: string) { const d = join(tmpdir(), `avorelo-df-rte-${name}-${Date.now()}`); mkdirSync(d, { recursive: true }); return d; }

// S1: task safety classification
try {
  assert(classifyTaskSafety("create a hello world fixture") === "sandbox_safe", "hello world safe");
  assert(classifyTaskSafety("deploy to production") === "forbidden", "deploy forbidden");
  assert(classifyTaskSafety("refactor entire codebase") === "needs_approval", "refactor needs approval");
  record("task_safety_classification", true, "safe/forbidden/needs_approval all correct");
} catch (e: any) { record("task_safety_classification", false, e.message); }

// S2: output sanitization
try {
  const raw = "key=sk-test123 ghp_abc123token xoxb-sl" + "ack-123-abc cert=-----BEGIN RSA " + "PRIVATE KEY-----\ndata\n-----END RSA PRIVATE KEY-----";
  const s = sanitizeOutput(raw);
  assert(!s.includes("sk-test123"), "API key redacted");
  assert(!s.includes("ghp_abc123"), "GH token redacted");
  assert(!s.includes("xoxb-slack"), "Slack token redacted");
  assert(!s.includes("BEGIN RSA"), "cert redacted");
  assert(s.includes("[REDACTED_KEY]"), "key placeholder present");
  record("output_sanitization", true, "all secret patterns redacted");
} catch (e: any) { record("output_sanitization", false, e.message); }

// S3: fake Claude Code delegated execution
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
  assert(result.delegatedTask !== null, "delegated task present");
  assert(result.delegatedTask!.success === true, "delegated success");
  assert(result.delegatedTask!.toolVersion === "fake-claude-code-1.0.0", "fake version");
  assert(result.delegatedTask!.containsRawPrompt === false, "no raw prompt");
  assert(result.containsRawPrompt === false, "no raw prompt on result");
  record("fake_claude_delegated", true, `executed with patchSummary=${result.delegatedTask!.patchSummary}`);
} catch (e: any) { record("fake_claude_delegated", false, e.message); }

// S4: fake Codex delegated execution
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
  assert(result.delegatedTask!.toolVersion === "fake-codex-1.0.0", "fake codex version");
  record("fake_codex_delegated", true, "codex fake execution complete");
} catch (e: any) { record("fake_codex_delegated", false, e.message); }

// S5: forbidden task blocked even in fake mode
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
  const ctx: ExecutionContext = { dir: tmpdir(), task: "deploy to production", now: NOW, approved: true, useFakeAdapters: true };
  const result = runToolExecution(plan, ctx);
  assert(result.status === "blocked", "forbidden task blocked");
  assert(result.reasonCodes.includes("TASK_FORBIDDEN_EVEN_IN_FAKE_MODE"), "reason present");
  record("forbidden_blocked_fake", true, "deploy blocked even in fake mode");
} catch (e: any) { record("forbidden_blocked_fake", false, e.message); }

// S6: runtime session e2e with delegated execution
try {
  resetAllAdapterHealth();
  const origFake = process.env.AVORELO_FAKE_ADAPTERS;
  process.env.AVORELO_FAKE_ADAPTERS = "1";
  const dir = tmpDir("df-e2e");
  try {
    const { record: r } = runRuntimeSession({ task: "create a hello world fixture", dir, now: NOW });
    assert(r.toolExecution.executionReceiptId?.startsWith("tpr_"), "receipt id present");
    assert(r.containsRawSecret === false, "no raw secret");
    assert(r.containsRawPrompt === false, "no raw prompt");
    const v = validateRuntimeSession(r);
    assert(v.valid, "session valid");

    const cc = buildControlCenter(dir, { now: NOW });
    const text = renderControlCenterText(cc);
    assert(text.includes("exec:"), "control center shows exec");
    assert(!text.includes("sk-"), "no API keys in control center");
    record("runtime_e2e_delegated", true, `adapter=${r.toolExecution.selectedAdapter} status=${r.toolExecution.executionStatus}`);
  } finally {
    if (origFake === undefined) delete process.env.AVORELO_FAKE_ADAPTERS;
    else process.env.AVORELO_FAKE_ADAPTERS = origFake;
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
} catch (e: any) { record("runtime_e2e_delegated", false, e.message); }

// S7: no raw content persisted
try {
  resetAllAdapterHealth();
  const dir = tmpDir("df-raw");
  try {
    const { record: r } = runRuntimeSession({ task: "check status", dir, now: NOW });
    const serialized = JSON.stringify(r);
    assert(!serialized.includes("sk-"), "no API keys");
    assert(!serialized.includes("ANTHROPIC_API_KEY="), "no env vars");
    assert(!serialized.includes("-----BEGIN"), "no certs");
    assert(r.containsRawSecret === false, "raw secret flag false");
    assert(r.containsRawPrompt === false, "raw prompt flag false");
    assert(r.toolExecution.containsRawPrompt === false, "tool raw prompt false");
    record("no_raw_content", true, "all raw flags false, no leaked secrets");
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
} catch (e: any) { record("no_raw_content", false, e.message); }

// Summary
const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;

console.log("\n=== Real Tool Execution Dogfood ===\n");
for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.scenario}: ${r.detail}`);
console.log(`\n${passed} passed, ${failed} failed of ${results.length} scenarios`);

if (failed > 0) {
  console.error("\nFAILED scenarios:");
  for (const r of results.filter(r => !r.pass)) console.error(`  ✗ ${r.scenario}: ${r.detail}`);
  process.exit(1);
}
