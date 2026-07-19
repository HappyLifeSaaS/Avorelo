// Generic Adapter Orchestration tests.
// Covers: extensible adapter ID, adapter config contract, generic delegated execution,
// fake adapter generalization, command preview, verifier reason codes, control-router
// alignment, skills layer, seamless UX invariants.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  planToolExecution, resetAllAdapterHealth, runToolExecution,
  getAdapterDescriptors, getEffectiveAvailability,
  getDelegatedAdapterConfig, registerDelegatedAdapterConfig,
  sanitizeOutput, classifyTaskSafety, validateCommandSafety,
  type ExecutionContext, type ToolAdapterId, type DelegatedAdapterConfig,
} from "../src/avorelo/kernel/tool-adapters/index.ts";
import { runRuntimeSession, validateRuntimeSession } from "../src/avorelo/capabilities/runtime-flow/index.ts";
import { selectSkill, getSkillRegistry, createSkillReceipt } from "../src/avorelo/kernel/skills/index.ts";
import { unifiedRoute, type UnifiedTaskFrame } from "../src/avorelo/control-router/index.ts";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const NOW = 1718500000000;
function tmpDir(name: string) { const d = join(tmpdir(), `avorelo-gao-${name}-${Date.now()}`); mkdirSync(d, { recursive: true }); return d; }

describe("generic adapter orchestration", () => {

  // --- Extensible ToolAdapterId ---

  it("T2: custom adapter ID compiles and works in plan", () => {
    resetAllAdapterHealth();
    const customId: ToolAdapterId = "gemini-cli";
    assert.equal(typeof customId, "string");
    // Well-known IDs still work
    const wellKnown: ToolAdapterId = "claude-code";
    assert.equal(wellKnown, "claude-code");
  });

  // --- Adapter config contract ---

  it("T3: delegated adapter configs exist for claude-code and codex", () => {
    const ccConfig = getDelegatedAdapterConfig("claude-code");
    assert.ok(ccConfig, "claude-code config exists");
    assert.equal(ccConfig!.binaryName, "claude");
    assert.equal(ccConfig!.outputFormat, "json");

    const cxConfig = getDelegatedAdapterConfig("codex");
    assert.ok(cxConfig, "codex config exists");
    assert.equal(cxConfig!.binaryName, "codex");
    assert.equal(cxConfig!.outputFormat, "text");
  });

  it("T3: registering a custom adapter config works", () => {
    const customConfig: DelegatedAdapterConfig = {
      id: "test-adapter",
      binaryName: "test-tool",
      versionFlag: "--version",
      execArgs: (task) => ["--run", task],
      outputFormat: "text",
      authDetectionPatterns: ["not authenticated"],
      notInstalledReason: "test_adapter_not_installed",
      executionReasonCode: "TEST_ADAPTER_EXECUTION",
      notInstalledReasonCode: "TEST_ADAPTER_NOT_INSTALLED",
      authRequiredReasonCode: "TEST_ADAPTER_AUTH_REQUIRED",
      taskFailedReasonCode: "TEST_ADAPTER_TASK_FAILED",
      taskExecutedReasonCode: "TEST_ADAPTER_TASK_EXECUTED",
    };
    registerDelegatedAdapterConfig(customConfig);
    const retrieved = getDelegatedAdapterConfig("test-adapter");
    assert.ok(retrieved);
    assert.equal(retrieved!.binaryName, "test-tool");
  });

  it("T3: no config for non-delegated adapters", () => {
    assert.equal(getDelegatedAdapterConfig("deterministic-local"), null);
    assert.equal(getDelegatedAdapterConfig("manual-gate"), null);
    assert.equal(getDelegatedAdapterConfig("scanner"), null);
  });

  // --- Generic delegated execution ---

  it("T1: fake execution works for both claude-code and codex via generic path", () => {
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
      assert.equal(result.status, "executed", `${adapter} executed`);
      assert.ok(result.delegatedTask, `${adapter} has delegated task`);
      assert.equal(result.delegatedTask!.success, true, `${adapter} success`);
      assert.equal(result.containsRawSecret, false);
    }
  });

  it("T4: fake adapter works for any adapter ID with a config", () => {
    resetAllAdapterHealth();
    registerDelegatedAdapterConfig({
      id: "fake-test-adapter",
      binaryName: "fake-tool",
      versionFlag: "--version",
      execArgs: (task) => [task],
      outputFormat: "text",
      authDetectionPatterns: [],
      notInstalledReason: "fake_not_installed",
      executionReasonCode: "FAKE_TEST_EXECUTION",
      notInstalledReasonCode: "FAKE_TEST_NOT_INSTALLED",
      authRequiredReasonCode: "FAKE_TEST_AUTH",
      taskFailedReasonCode: "FAKE_TEST_FAILED",
      taskExecutedReasonCode: "FAKE_TEST_EXECUTED",
    });

    const plan = planToolExecution({
      taskType: "code_generation", riskClass: "low",
      paymentTouched: false, authTouched: false,
      productionImpactPossible: false, deterministicEvidenceAvailable: false,
      deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
    });
    plan.selectedAdapter = "fake-test-adapter";
    plan.executionMode = "real";
    const ctx: ExecutionContext = { dir: tmpdir(), task: "create a fixture", now: NOW, approved: true, useFakeAdapters: true };
    const result = runToolExecution(plan, ctx);
    assert.equal(result.status, "executed");
    assert.equal(result.adapterId, "fake-test-adapter");
    assert.ok(result.delegatedTask);
    assert.ok(result.reasonCodes.some(r => r.includes("FAKE")));
  });

  it("T1: forbidden task blocked even for generic adapter", () => {
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
    assert.equal(result.status, "blocked");
  });

  // --- Command preview ---

  it("T5: command preview uses adapter config binary name", () => {
    resetAllAdapterHealth();
    const plan = planToolExecution({
      taskType: "code_generation", riskClass: "low",
      paymentTouched: false, authTouched: false,
      productionImpactPossible: false, deterministicEvidenceAvailable: false,
      deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
    });
    if (plan.commandPreview) {
      const config = getDelegatedAdapterConfig(plan.selectedAdapter);
      if (config) {
        assert.equal(plan.commandPreview.command, config.binaryName);
      }
    }
  });

  // --- Verifier reason codes ---

  it("T6: runtime session contains execution verification reason code", () => {
    resetAllAdapterHealth();
    const dir = tmpDir("t6");
    try {
      const { record: r } = runRuntimeSession({ task: "check status", dir, now: NOW });
      const v = validateRuntimeSession(r);
      assert.ok(v.valid, "session valid");
      assert.ok(v.reasons.some(r => r.startsWith("EXECUTION_VERIF")), `has verification code: ${v.reasons.join(",")}`);
    } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
  });

  it("T6: blocked session gets EXECUTION_VERIFIED_GATED", () => {
    resetAllAdapterHealth();
    const dir = tmpDir("t6b");
    try {
      const { record: r } = runRuntimeSession({ task: "deploy to production", dir, now: NOW });
      const v = validateRuntimeSession(r);
      assert.ok(v.valid, "session valid");
      const hasGated = v.reasons.some(r => r === "EXECUTION_VERIFIED_GATED");
      const hasVerified = v.reasons.some(r => r.startsWith("EXECUTION_VERIFIED"));
      assert.ok(hasGated || hasVerified, `has verification code: ${v.reasons.join(",")}`);
    } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
  });

  // --- Control-router alignment ---

  it("T7: unifiedRoute includes tool adapter routing", () => {
    const frame: UnifiedTaskFrame = {
      taskType: "code_generation", riskClass: "low",
      touchedLayers: ["Surface"], changedFiles: ["src/foo.ts"],
      paymentTouched: false, dashboardTouched: false, publicCopyTouched: false,
      mcpTouched: false, browserAvailable: false, proofRequired: false,
      externalToolsAllowed: false, deepMode: false,
      userIntent: "add a helper", localOnly: false, userPlan: "",
      founderCockpitTouched: false, aiTeamTouched: false,
      feedbackLoopTouched: false, oldRepoReferenceUsed: false,
      installedTools: [], contextBudgetRemaining: 100000, tokenBudgetRemaining: 100000,
    };
    const decision = unifiedRoute(frame);
    assert.ok(decision.toolAdapterRouting, "tool adapter routing present");
    assert.ok(decision.toolAdapterRouting!.selectedAdapter, "adapter selected");
    assert.ok(decision.toolAdapterRouting!.reasonCodes.length > 0, "has reason codes");
    assert.equal(decision.modelMayDecide, false);
    assert.equal(decision.scannerMayDecide, false);
  });

  // --- Skills layer ---

  it("T9: skill selection matches task intent", () => {
    const format = selectSkill("format the code");
    assert.ok(format.matched);
    assert.equal(format.matched!.id, "skill-format");

    const lint = selectSkill("run lint check");
    assert.ok(lint.matched);
    assert.equal(lint.matched!.id, "skill-lint");

    const test = selectSkill("run test suite");
    assert.ok(test.matched);
    assert.equal(test.matched!.id, "skill-test");

    const scaffold = selectSkill("scaffold a new file");
    assert.ok(scaffold.matched);
    assert.equal(scaffold.matched!.id, "skill-scaffold");

    const status = selectSkill("check status");
    assert.ok(status.matched);
    assert.equal(status.matched!.id, "skill-status");
  });

  it("T9: unmatched intent returns null", () => {
    const result = selectSkill("deploy to production");
    assert.equal(result.matched, null);
    assert.ok(result.reasonCodes.includes("NO_SKILL_MATCHED"));
  });

  it("T9: all skills are hidden by default", () => {
    const registry = getSkillRegistry();
    assert.ok(registry.length >= 5);
    for (const skill of registry) {
      assert.equal(skill.hidden, true, `${skill.id} is hidden`);
    }
  });

  it("T10: skill receipt has correct contract", () => {
    const skill = getSkillRegistry()[0]!;
    const receipt = createSkillReceipt(skill, "deterministic-local", true, ["SKILL_EXECUTED"], NOW);
    assert.equal(receipt.contract, "avorelo.skillReceipt.v1");
    assert.ok(receipt.receiptId.startsWith("skr_"));
    assert.equal(receipt.containsRawPrompt, false);
    assert.equal(receipt.containsRawSecret, false);
  });

  // --- Seamless UX invariants ---

  describe("T8: seamless UX contract", () => {
    it("user never chooses adapter", () => {
      resetAllAdapterHealth();
      const plan = planToolExecution({
        taskType: "code_generation", riskClass: "low",
        paymentTouched: false, authTouched: false,
        productionImpactPossible: false, deterministicEvidenceAvailable: false,
        deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
      });
      assert.equal(plan.modelMayDecide, false, "model cannot decide");
      assert.equal(plan.scannerMayDecide, false, "scanner cannot decide");
      assert.ok(plan.selectedAdapter, "adapter auto-selected");
    });

    it("user never sees routing internals in display task", () => {
      resetAllAdapterHealth();
      const dir = tmpDir("ux1");
      try {
        const { displayTask } = runRuntimeSession({ task: "add a helper", dir, now: NOW });
        assert.ok(!displayTask.includes("select adapter"), "no adapter picker");
        assert.ok(!displayTask.includes("API key"), "no API key prompt");
        assert.ok(!displayTask.includes("fallback"), "no fallback info");
        assert.ok(!displayTask.includes("routing profile"), "no routing profile");
      } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
    });

    it("user never manages proof tier", () => {
      resetAllAdapterHealth();
      const plan = planToolExecution({
        taskType: "code_generation", riskClass: "high",
        paymentTouched: false, authTouched: true,
        productionImpactPossible: false, deterministicEvidenceAvailable: false,
        deepMode: false, secretsPossible: true, dir: tmpdir(), now: NOW,
      });
      assert.equal(plan.proofRequired, true, "proof auto-required for high risk");
    });

    it("user never configures fallback chain", () => {
      resetAllAdapterHealth();
      const plan = planToolExecution({
        taskType: "code_generation", riskClass: "low",
        paymentTouched: false, authTouched: false,
        productionImpactPossible: false, deterministicEvidenceAvailable: false,
        deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
      });
      assert.ok(Array.isArray(plan.fallbackAdapters), "fallback chain auto-built");
      assert.equal(plan.finalDecisionOwner, "kernel/stop-continue-gate");
    });

    it("skills are hidden from user", () => {
      const registry = getSkillRegistry();
      for (const skill of registry) {
        assert.equal(skill.hidden, true);
      }
    });

    it("no raw content in any execution path", () => {
      resetAllAdapterHealth();
      const origFake = process.env.AVORELO_FAKE_ADAPTERS;
      process.env.AVORELO_FAKE_ADAPTERS = "1";
      const dir = tmpDir("ux-raw");
      try {
        const { record: r } = runRuntimeSession({ task: "create a hello world fixture", dir, now: NOW });
        assert.equal(r.containsRawSecret, false);
        assert.equal(r.containsRawPrompt, false);
        assert.equal(r.toolExecution.containsRawPrompt, false);
        assert.equal(r.toolExecution.containsRawSecret, false);
        const v = validateRuntimeSession(r);
        assert.ok(v.valid, `valid: ${v.reasons.join(",")}`);
      } finally {
        if (origFake === undefined) delete process.env.AVORELO_FAKE_ADAPTERS;
        else process.env.AVORELO_FAKE_ADAPTERS = origFake;
        try { rmSync(dir, { recursive: true, force: true }); } catch {}
      }
    });

    it("details only in --json/verbose/diagnostics, not user-facing", () => {
      resetAllAdapterHealth();
      const dir = tmpDir("ux-details");
      try {
        const { record: r, displayTask } = runRuntimeSession({ task: "check status", dir, now: NOW });
        // User-facing: simple
        assert.ok(!displayTask.includes("deterministic-local"), "no adapter ID in display");
        assert.ok(!displayTask.includes("TASK_CLASS:"), "no reason code in display");
        // Machine-readable: detailed
        assert.ok(r.toolExecution.reasonCodes.length > 0, "reason codes in record");
        assert.ok(r.toolExecution.selectedAdapter, "adapter in record");
      } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
    });
  });

  // --- Backward compatibility ---

  it("T11: proof adapters are registered alongside the original adapter set", () => {
    const descs = getAdapterDescriptors();
    assert.ok(descs.length >= 5);
    const ids = descs.map(d => d.id);
    assert.ok(ids.includes("deterministic-local"));
    assert.ok(ids.includes("manual-gate"));
    assert.ok(ids.includes("scanner"));
    assert.ok(ids.includes("semgrep"));
    assert.ok(ids.includes("playwright-proof"));
    assert.ok(ids.includes("github-actions"));
    assert.ok(ids.includes("claude-code"));
    assert.ok(ids.includes("codex"));
  });

  it("T12: sandbox safety works for generic adapters", () => {
    assert.equal(classifyTaskSafety("create a hello world fixture"), "sandbox_safe");
    assert.equal(classifyTaskSafety("npm publish package"), "forbidden");
    assert.equal(classifyTaskSafety("refactor the module"), "needs_approval");
  });

  it("T15: output sanitization works for generic adapters", () => {
    const sanitized = sanitizeOutput("key sk-abc123def token ghp_abc123 jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U");
    assert.ok(!sanitized.includes("sk-abc123def"));
    assert.ok(!sanitized.includes("ghp_abc123"));
    assert.ok(sanitized.includes("[REDACTED_KEY]"));
    assert.ok(sanitized.includes("[REDACTED_GH_TOKEN]"));
  });

  // --- P1 regression: shell/command injection (Codex review) ---

  describe("P1: argv-safe execution / shell injection prevention", () => {
    it("P1-R1: shell metacharacters in task are blocked by validateCommandSafety", () => {
      const injections = [
        "; touch /tmp/avorelo-pwned",
        "&& rm -rf /",
        "| cat /etc/passwd",
        "$(whoami)",
        "`id`",
        "foo > /tmp/leak",
        "foo\nmalicious",
      ];
      for (const payload of injections) {
        const result = validateCommandSafety("claude", ["-p", payload]);
        assert.equal(result.safe, false, `must block: ${payload.slice(0, 30)}`);
        assert.ok(result.reasonCode.includes("UNSAFE"), `reason for: ${payload.slice(0, 30)}`);
      }
    });

    it("P1-R2: clean task passes validateCommandSafety", () => {
      const result = validateCommandSafety("claude", ["-p", "add a helper function", "--output-format", "json"]);
      assert.equal(result.safe, true);
      assert.equal(result.reasonCode, "ARGV_SAFE_EXECUTION");
    });

    it("P1-R3: malicious binary name is blocked", () => {
      const result = validateCommandSafety("claude; rm -rf /", ["-p", "task"]);
      assert.equal(result.safe, false);
      assert.equal(result.reasonCode, "UNSAFE_COMMAND_BLOCKED");
    });

    it("P1-R4: delegated adapter execArgs produce clean argv (no shell quotes)", () => {
      const ccConfig = getDelegatedAdapterConfig("claude-code");
      assert.ok(ccConfig);
      const args = ccConfig.execArgs("add helper");
      for (const arg of args) {
        assert.ok(!arg.startsWith('"'), `no shell double-quote start in: ${arg}`);
        assert.ok(!arg.endsWith('"'), `no shell double-quote end in: ${arg}`);
      }
      const cxConfig = getDelegatedAdapterConfig("codex");
      assert.ok(cxConfig);
      const cxArgs = cxConfig.execArgs("add helper");
      for (const arg of cxArgs) {
        assert.ok(!arg.startsWith('"'), `no shell double-quote start in: ${arg}`);
        assert.ok(!arg.endsWith('"'), `no shell double-quote end in: ${arg}`);
      }
    });

    it("P1-R5: fake adapter execution still works after argv fix", () => {
      resetAllAdapterHealth();
      const plan = planToolExecution({
        taskType: "code_generation", riskClass: "low",
        paymentTouched: false, authTouched: false,
        productionImpactPossible: false, deterministicEvidenceAvailable: false,
        deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
      });
      const ctx: ExecutionContext = { dir: tmpdir(), task: "create hello world", now: NOW, approved: false, useFakeAdapters: true };
      const result = runToolExecution(plan, ctx);
      assert.ok(["executed", "blocked", "skipped"].includes(result.status), `status=${result.status}`);
    });

    it("P1-R6: deterministic-local commands still work after argv fix", () => {
      resetAllAdapterHealth();
      const plan = planToolExecution({
        taskType: "code_generation", riskClass: "low",
        paymentTouched: false, authTouched: false,
        productionImpactPossible: false, deterministicEvidenceAvailable: true,
        deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
      });
      if (plan.selectedAdapter === "deterministic-local") {
        const ctx: ExecutionContext = { dir: tmpdir(), task: "check status", now: NOW, approved: false, useFakeAdapters: false };
        const result = runToolExecution(plan, ctx);
        assert.ok(["executed", "failed"].includes(result.status));
      }
    });
  });

  // --- P2 regression: production/risk gate consistency (Codex review) ---

  describe("P2: routing/gate consistency for risky tasks", () => {
    function makeFrame(overrides: Partial<UnifiedTaskFrame> = {}): UnifiedTaskFrame {
      return {
        taskType: "code_generation", riskClass: "low",
        touchedLayers: ["Surface"], changedFiles: ["src/foo.ts"],
        paymentTouched: false, dashboardTouched: false, publicCopyTouched: false,
        mcpTouched: false, browserAvailable: false, proofRequired: false,
        externalToolsAllowed: false, deepMode: false,
        userIntent: "add a helper", localOnly: false, userPlan: "",
        founderCockpitTouched: false, aiTeamTouched: false,
        feedbackLoopTouched: false, oldRepoReferenceUsed: false,
        installedTools: [], contextBudgetRemaining: 100000, tokenBudgetRemaining: 100000,
        ...overrides,
      };
    }

    it("P2-R1: deploy task — toolMayExecute=false, approvalRequired or blocked", () => {
      resetAllAdapterHealth();
      const decision = unifiedRoute(makeFrame({ userIntent: "deploy to production", riskClass: "critical", proofRequired: true }));
      assert.ok(decision.toolAdapterRouting, "tool routing present");
      assert.equal(decision.toolAdapterRouting!.toolMayExecute, false, "toolMayExecute must be false for deploy");
      assert.ok(
        decision.toolAdapterRouting!.approvalRequired || decision.toolAdapterRouting!.selectedAdapter === "manual-gate",
        "must require approval or manual-gate"
      );
    });

    it("P2-R2: npm publish — toolMayExecute=false", () => {
      resetAllAdapterHealth();
      const decision = unifiedRoute(makeFrame({ userIntent: "npm publish the package", riskClass: "high", proofRequired: true }));
      assert.ok(decision.toolAdapterRouting);
      assert.equal(decision.toolAdapterRouting!.toolMayExecute, false);
    });

    it("P2-R3: release/tag — toolMayExecute=false", () => {
      resetAllAdapterHealth();
      const decision = unifiedRoute(makeFrame({ userIntent: "release v2.0 and tag it", riskClass: "high" }));
      assert.ok(decision.toolAdapterRouting);
      assert.equal(decision.toolAdapterRouting!.toolMayExecute, false);
    });

    it("P2-R4: billing webhook — approval required, elevated proof", () => {
      resetAllAdapterHealth();
      const decision = unifiedRoute(makeFrame({ userIntent: "change billing webhook endpoint", paymentTouched: true, riskClass: "high" }));
      assert.ok(decision.toolAdapterRouting);
      assert.ok(decision.toolAdapterRouting!.proofRequired, "proof required for billing");
      assert.ok(
        decision.toolAdapterRouting!.approvalRequired || decision.toolAdapterRouting!.selectedAdapter === "manual-gate",
        "billing needs approval or manual-gate"
      );
    });

    it("P2-R5: auth/security task — proof-first, proof required, no direct code execution", () => {
      resetAllAdapterHealth();
      const decision = unifiedRoute(makeFrame({ userIntent: "update auth session handling", riskClass: "high" }));
      assert.ok(decision.toolAdapterRouting);
      assert.ok(decision.toolAdapterRouting!.proofRequired, "auth task requires proof collection");
      const adapter = decision.toolAdapterRouting!.selectedAdapter;
      assert.ok(
        adapter === "semgrep" || adapter === "scanner" || adapter === "manual-gate",
        `auth task must route to semgrep/scanner/manual-gate, got: ${adapter}`
      );
    });

    it("P2-R6: control-router and runtime-flow produce compatible tool routing for same low-risk task", () => {
      resetAllAdapterHealth();
      const dir = tmpDir("p2-compat");
      try {
        const decision = unifiedRoute(makeFrame({ userIntent: "add a helper function", riskClass: "low" }));
        const { record: r } = runRuntimeSession({ task: "add a helper function", dir, now: NOW });
        assert.ok(decision.toolAdapterRouting);
        assert.equal(decision.modelMayDecide, false);
        assert.equal(r.toolExecution.modelMayDecide, false);
        assert.equal(decision.toolAdapterRouting!.toolMayExecute, r.toolExecution.toolMayExecute);
      } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
    });

    it("P2-R7: control-router preserves production impact flags for risky intents", () => {
      resetAllAdapterHealth();
      const decision = unifiedRoute(makeFrame({ userIntent: "deploy to production", riskClass: "critical", proofRequired: true }));
      assert.ok(decision.toolAdapterRouting);
      const codes = decision.toolAdapterRouting!.reasonCodes;
      assert.ok(
        codes.some(c => c.includes("MANUAL_GATE") || c.includes("production_deploy") || c.includes("BLOCKED")),
        `risky task should have gate/block codes, got: ${codes.join(",")}`
      );
    });

    it("P2-R8: secret-bearing task — proof required, secretsPossible preserved", () => {
      resetAllAdapterHealth();
      const decision = unifiedRoute(makeFrame({ userIntent: "rotate API credential for login service", riskClass: "high" }));
      assert.ok(decision.toolAdapterRouting);
      assert.ok(decision.toolAdapterRouting!.proofRequired, "secret-bearing task requires proof");
      const adapter = decision.toolAdapterRouting!.selectedAdapter;
      assert.ok(
        adapter === "semgrep" || adapter === "scanner" || adapter === "manual-gate",
        `secret-bearing task must not use uncontrolled agent, got: ${adapter}`
      );
    });
  });
});
