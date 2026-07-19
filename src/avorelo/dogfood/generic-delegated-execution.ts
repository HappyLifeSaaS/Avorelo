// Generic Delegated Execution Dogfood.
// Proves: config-driven execution, fake mode for any adapter, fallback, forbidden blocking.

import {
  planToolExecution, resetAllAdapterHealth, runToolExecution,
  getDelegatedAdapterConfig, registerDelegatedAdapterConfig,
  type ExecutionContext, type ToolAdapterId, type DelegatedAdapterConfig,
} from "../kernel/tool-adapters/index.ts";
import { tmpdir } from "node:os";

type ScenarioResult = { scenario: string; pass: boolean; detail: string };
const results: ScenarioResult[] = [];
const NOW = 1718500000000;

function record(scenario: string, pass: boolean, detail: string) { results.push({ scenario, pass, detail }); }
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(`ASSERT: ${msg}`); }

// S1: config exists for claude-code and codex
try {
  const cc = getDelegatedAdapterConfig("claude-code");
  assert(cc !== null, "claude-code config");
  assert(cc!.binaryName === "claude", "claude binary");
  const cx = getDelegatedAdapterConfig("codex");
  assert(cx !== null, "codex config");
  assert(cx!.binaryName === "codex", "codex binary");
  record("config_exists", true, "both configs present");
} catch (e: any) { record("config_exists", false, e.message); }

// S2: fake execution for claude-code via generic path
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
  const ctx: ExecutionContext = { dir: tmpdir(), task: "create a fixture", now: NOW, approved: true, useFakeAdapters: true };
  const result = runToolExecution(plan, ctx);
  assert(result.status === "executed", `status=${result.status}`);
  assert(result.delegatedTask!.success === true, "success");
  record("fake_claude_code", true, "generic fake execution works");
} catch (e: any) { record("fake_claude_code", false, e.message); }

// S3: fake execution for codex via generic path
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
  const ctx: ExecutionContext = { dir: tmpdir(), task: "create a fixture", now: NOW, approved: true, useFakeAdapters: true };
  const result = runToolExecution(plan, ctx);
  assert(result.status === "executed", `status=${result.status}`);
  record("fake_codex", true, "generic fake execution works");
} catch (e: any) { record("fake_codex", false, e.message); }

// S4: custom adapter registration and fake execution
try {
  registerDelegatedAdapterConfig({
    id: "dogfood-custom-adapter",
    binaryName: "dogfood-tool",
    versionFlag: "--version",
    execArgs: (task) => [task],
    outputFormat: "text",
    authDetectionPatterns: [],
    notInstalledReason: "dogfood_not_installed",
    executionReasonCode: "DOGFOOD_EXECUTION",
    notInstalledReasonCode: "DOGFOOD_NOT_INSTALLED",
    authRequiredReasonCode: "DOGFOOD_AUTH",
    taskFailedReasonCode: "DOGFOOD_FAILED",
    taskExecutedReasonCode: "DOGFOOD_EXECUTED",
  });
  resetAllAdapterHealth();
  const plan = planToolExecution({
    taskType: "code_generation", riskClass: "low",
    paymentTouched: false, authTouched: false,
    productionImpactPossible: false, deterministicEvidenceAvailable: false,
    deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
  });
  plan.selectedAdapter = "dogfood-custom-adapter";
  plan.executionMode = "real";
  const ctx: ExecutionContext = { dir: tmpdir(), task: "create a fixture", now: NOW, approved: true, useFakeAdapters: true };
  const result = runToolExecution(plan, ctx);
  assert(result.status === "executed", `status=${result.status}`);
  assert(result.adapterId === "dogfood-custom-adapter", "correct adapter");
  record("custom_adapter", true, "custom adapter works in fake mode");
} catch (e: any) { record("custom_adapter", false, e.message); }

// S5: forbidden task still blocked via generic path
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
  assert(result.status === "blocked", `status=${result.status}`);
  record("forbidden_blocked", true, "forbidden task blocked via generic path");
} catch (e: any) { record("forbidden_blocked", false, e.message); }

// S6: non-delegated adapters have no config
try {
  assert(getDelegatedAdapterConfig("deterministic-local") === null, "deterministic-local no config");
  assert(getDelegatedAdapterConfig("manual-gate") === null, "manual-gate no config");
  assert(getDelegatedAdapterConfig("scanner") === null, "scanner no config");
  record("non_delegated_no_config", true, "built-in adapters have no delegated config");
} catch (e: any) { record("non_delegated_no_config", false, e.message); }

// Summary
const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;

console.log("\n=== Generic Delegated Execution Dogfood ===\n");
for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.scenario}: ${r.detail}`);
console.log(`\n${passed} passed, ${failed} failed of ${results.length} scenarios`);

if (failed > 0) {
  console.error("\nFAILED scenarios:");
  for (const r of results.filter(r => !r.pass)) console.error(`  ✗ ${r.scenario}: ${r.detail}`);
  process.exit(1);
}
