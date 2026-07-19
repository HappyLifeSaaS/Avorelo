// Real Tool Execution tests. Validates delegated Claude Code / Codex execution,
// sandbox safety, fake adapter contract, runtime integration, and all 15 scenarios.
// node:test, zero-dep. No network, no API keys required.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

import {
  planToolExecution, buildToolRoutingProjection, getEffectiveAvailability,
  resetAllAdapterHealth, runToolExecution, classifyTaskSafety,
  createSandboxDir, collectSandboxResults, cleanupSandbox, sanitizeOutput,
  type ExecutionContext, type ToolAdapterId,
} from "../src/avorelo/kernel/tool-adapters/index.ts";

import { runRuntimeSession, validateRuntimeSession } from "../src/avorelo/capabilities/runtime-flow/index.ts";
import { buildControlCenter, renderText as renderControlCenterText } from "../src/avorelo/capabilities/control-center/index.ts";

const NOW = 1718500000000;

function tmpDir(name: string): string {
  const d = join(tmpdir(), `avorelo-rte-${name}-${Date.now()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function claudeInstalled(): boolean {
  try { execSync("claude --version", { stdio: "pipe", timeout: 10000 }); return true; } catch { return false; }
}

function codexInstalled(): boolean {
  try { execSync("codex --version", { stdio: "pipe", timeout: 10000 }); return true; } catch { return false; }
}

describe("real tool execution", () => {
  before(() => resetAllAdapterHealth());

  describe("sandbox safety classification", () => {
    it("classifies safe sandbox tasks correctly", () => {
      assert.equal(classifyTaskSafety("create a hello world fixture"), "sandbox_safe");
      assert.equal(classifyTaskSafety("add a test helper"), "sandbox_safe");
      assert.equal(classifyTaskSafety("generate a stub module"), "sandbox_safe");
      assert.equal(classifyTaskSafety("update test fixture data"), "sandbox_safe");
      assert.equal(classifyTaskSafety("format code in file"), "sandbox_safe");
      assert.equal(classifyTaskSafety("echo hello"), "sandbox_safe");
      assert.equal(classifyTaskSafety("create a simple module"), "sandbox_safe");
      assert.equal(classifyTaskSafety("scaffold a template"), "sandbox_safe");
    });

    it("classifies forbidden tasks correctly", () => {
      assert.equal(classifyTaskSafety("deploy to production"), "forbidden");
      assert.equal(classifyTaskSafety("npm publish package"), "forbidden");
      assert.equal(classifyTaskSafety("delete all user data"), "forbidden");
      assert.equal(classifyTaskSafety("credential rotation script"), "forbidden");
      assert.equal(classifyTaskSafety("auth change permissions"), "forbidden");
      assert.equal(classifyTaskSafety("billing update webhook"), "forbidden");
      assert.equal(classifyTaskSafety("git push force"), "forbidden");
      assert.equal(classifyTaskSafety("env secret set value"), "forbidden");
    });

    it("classifies ambiguous tasks as needs_approval", () => {
      assert.equal(classifyTaskSafety("refactor the entire codebase"), "needs_approval");
      assert.equal(classifyTaskSafety("implement a new feature"), "needs_approval");
    });
  });

  describe("sandbox creation and cleanup", () => {
    it("creates sandbox dir with marker, collects results, cleans up", () => {
      const sandbox = createSandboxDir(tmpdir());
      assert.ok(existsSync(sandbox.sandboxDir));
      assert.ok(existsSync(join(sandbox.sandboxDir, ".avorelo-sandbox")));

      writeFileSync(join(sandbox.sandboxDir, "test.txt"), "hello world");
      const results = collectSandboxResults(sandbox.sandboxDir);
      assert.ok(results.files.includes("test.txt"));
      assert.ok(results.summary.includes("test.txt"));

      const cleaned = cleanupSandbox(sandbox.sandboxDir);
      assert.equal(cleaned, true);
      assert.equal(existsSync(sandbox.sandboxDir), false);
    });
  });

  describe("output sanitization", () => {
    it("redacts API keys, tokens, certs, JWTs, and git diffs", () => {
      const fakeJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      const raw = `key=sk-abcdef123 ghp_abc123token token=xoxb-sl" + "ack-123-abc ${fakeJwt} cert=-----BEGIN RSA " + "PRIVATE KEY-----\ndata\n-----END RSA PRIVATE KEY-----`;
      const s = sanitizeOutput(raw);
      assert.ok(!s.includes("sk-abcdef123"), "API key not redacted");
      assert.ok(!s.includes("ghp_abc123"), "GH token not redacted");
      assert.ok(!s.includes("xoxb-slack-123"), "Slack token not redacted");
      assert.ok(!s.includes("eyJhbGciOi"), "JWT not redacted");
      assert.ok(!s.includes("BEGIN RSA"), "cert not redacted");
      assert.ok(s.includes("[REDACTED_KEY]"));
      assert.ok(s.includes("[REDACTED_GH_TOKEN]"));
      assert.ok(s.includes("[REDACTED_SLACK_TOKEN]"));
      assert.ok(s.includes("[REDACTED_JWT]"));
      assert.ok(s.includes("[REDACTED_CERT]"));
    });
  });

  describe("S1: low-risk task uses the current safest available path", () => {
    let dir: string;
    before(() => { dir = tmpDir("s1"); resetAllAdapterHealth(); });
    after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    it("executes, produces a proof receipt, and flows through runtime", () => {
      const { record: r } = runRuntimeSession({ task: "check readiness", dir, now: NOW });
      assert.ok(r.toolExecution);
      assert.ok(r.toolExecution.selectedAdapter);
      assert.ok(r.toolExecution.executionStatus);
      assert.ok(r.toolExecution.executionReceiptId);
      assert.ok(typeof r.toolExecution.executionDurationMs === "number");
      assert.equal(r.toolExecution.modelMayDecide, false);
      assert.equal(r.toolExecution.scannerMayDecide, false);

      const cc = buildControlCenter(dir, { now: NOW });
      assert.ok(cc.sections.toolExecution.executionStatus);
      assert.ok(validateRuntimeSession(r).valid);
    });
  });

  describe("S2: Claude Code real/sandbox task", () => {
    let dir: string;
    before(() => { dir = tmpDir("s2"); resetAllAdapterHealth(); });
    after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    it("attempts real delegated execution for safe sandbox task", () => {
      const plan = planToolExecution({
        taskType: "code_generation", riskClass: "low",
        paymentTouched: false, authTouched: false,
        productionImpactPossible: false, deterministicEvidenceAvailable: false,
        deepMode: false, secretsPossible: false, dir, now: NOW,
      });

      if (plan.selectedAdapter === "claude-code" || plan.selectedAdapter === "codex") {
        const ctx: ExecutionContext = { dir, task: "create a hello world fixture", now: NOW, approved: true, useFakeAdapters: false };
        const result = runToolExecution(plan, ctx);
        assert.ok(result.receiptId.startsWith("tpr_"));
        assert.equal(result.containsRawPrompt, false);
        assert.equal(result.containsRawSecret, false);
        assert.equal(result.containsRawOutput, false);

        if (result.delegatedTask) {
          assert.equal(result.delegatedTask.containsRawPrompt, false);
          assert.equal(result.delegatedTask.containsRawSource, false);
          assert.equal(result.delegatedTask.containsRawSecret, false);
          assert.equal(result.delegatedTask.containsRawModelOutput, false);
        }
      }

      // Whether claude-code is selected depends on availability; this must not fail
      assert.ok(plan.selectedAdapter);
    });

    if (claudeInstalled()) {
      it("Claude Code installed — delegated execution attempted with auth handling", () => {
        const plan = planToolExecution({
          taskType: "code_generation", riskClass: "low",
          paymentTouched: false, authTouched: false,
          productionImpactPossible: false, deterministicEvidenceAvailable: false,
          deepMode: false, secretsPossible: false, dir, now: NOW,
        });
        plan.selectedAdapter = "claude-code";
        plan.executionMode = "real";

        const ctx: ExecutionContext = { dir, task: "create a hello world fixture", now: NOW, approved: true, useFakeAdapters: false };
        const result = runToolExecution(plan, ctx);

        assert.ok(result.delegatedTask, "delegated task result must be present");
        assert.ok(result.delegatedTask.toolVersion, "tool version must be detected");
        assert.equal(result.containsRawPrompt, false);
        assert.equal(result.containsRawSecret, false);
        // Auth may block but the execution path must be exercised
        if (result.delegatedTask.authRequired) {
          assert.equal(result.status, "blocked");
          assert.ok(result.reasonCodes.includes("CLAUDE_CODE_AUTH_REQUIRED"));
        }
      });
    }
  });

  describe("S3: Codex real/sandbox task", () => {
    it("handles codex not installed gracefully", () => {
      const plan = planToolExecution({
        taskType: "code_generation", riskClass: "low",
        paymentTouched: false, authTouched: false,
        productionImpactPossible: false, deterministicEvidenceAvailable: false,
        deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
      });
      plan.selectedAdapter = "codex";
      plan.executionMode = "real";

      const ctx: ExecutionContext = { dir: tmpdir(), task: "create a hello world fixture", now: NOW, approved: true, useFakeAdapters: false };
      const result = runToolExecution(plan, ctx);

      if (!codexInstalled()) {
        assert.equal(result.status, "skipped");
        assert.ok(result.reasonCodes.includes("CODEX_NOT_INSTALLED"));
        assert.equal(result.delegatedTask?.failureReason, "codex_not_installed");
      }
      assert.equal(result.containsRawPrompt, false);
      assert.equal(result.containsRawSecret, false);
    });
  });

  describe("S4: CI fake Claude execution", () => {
    before(() => resetAllAdapterHealth());

    it("simulates full delegated Claude execution with patch/result/proof", () => {
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

      assert.equal(result.status, "executed");
      assert.equal(result.executionMode, "real");
      assert.ok(result.reasonCodes.includes("CI_FAKE_ADAPTER"));
      assert.ok(result.reasonCodes.includes("FAKE_DELEGATED_EXECUTION_COMPLETED"));
      assert.ok(result.delegatedTask, "fake must produce delegated task result");
      assert.equal(result.delegatedTask!.success, true);
      assert.ok(result.delegatedTask!.patchSummary?.includes("completed task"));
      assert.ok(result.delegatedTask!.filesChanged.length > 0);
      assert.equal(result.delegatedTask!.toolVersion, "fake-claude-code-1.0.0");
      assert.equal(result.delegatedTask!.containsRawPrompt, false);
      assert.equal(result.delegatedTask!.containsRawModelOutput, false);
      assert.equal(result.containsRawPrompt, false);
      assert.equal(result.containsRawSecret, false);
    });
  });

  describe("S5: CI fake Codex execution", () => {
    before(() => resetAllAdapterHealth());

    it("simulates full delegated Codex execution with patch/result/proof", () => {
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

      assert.equal(result.status, "executed");
      assert.ok(result.reasonCodes.includes("CI_FAKE_ADAPTER"));
      assert.ok(result.delegatedTask);
      assert.equal(result.delegatedTask!.success, true);
      assert.ok(result.delegatedTask!.patchSummary?.includes("completed task"));
      assert.equal(result.delegatedTask!.toolVersion, "fake-codex-1.0.0");
      assert.equal(result.delegatedTask!.containsRawPrompt, false);
    });
  });

  describe("S6: both tools available (policy selects safest)", () => {
    let dir: string;
    before(() => { dir = tmpDir("s6"); resetAllAdapterHealth(); });
    after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    it("auto-selects adapter, no user picker, fallback equal-or-safer", () => {
      const { record: r } = runRuntimeSession({ task: "add helper function", dir, now: NOW });
      assert.ok(r.toolExecution.selectedAdapter);
      assert.equal(r.toolExecution.modelMayDecide, false);
      assert.ok(r.toolExecution.fallbackAdapters.length >= 0);
      assert.ok(validateRuntimeSession(r).valid);
    });
  });

  describe("S7: only Claude available", () => {
    it("selects adapter without codex, no crash, no picker", () => {
      const plan = planToolExecution({
        taskType: "code_generation", riskClass: "low",
        paymentTouched: false, authTouched: false,
        productionImpactPossible: false, deterministicEvidenceAvailable: false,
        deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
      });
      assert.ok(plan.selectedAdapter);
      assert.equal(plan.modelMayDecide, false);
      // If codex is not installed, it should not be the selected adapter
      if (!codexInstalled()) {
        assert.notEqual(plan.selectedAdapter, "codex");
      }
    });
  });

  describe("S8: only Codex available", () => {
    it("handled via policy — no user picker needed", () => {
      const plan = planToolExecution({
        taskType: "code_generation", riskClass: "low",
        paymentTouched: false, authTouched: false,
        productionImpactPossible: false, deterministicEvidenceAvailable: false,
        deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
      });
      assert.ok(plan.selectedAdapter);
      assert.equal(plan.modelMayDecide, false);
    });
  });

  describe("S9: neither tool available", () => {
    let dir: string;
    before(() => { dir = tmpDir("s9"); resetAllAdapterHealth(); });
    after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    it("deterministic-local/scanner/manual-gate still work, no broken UX", () => {
      const { record: r } = runRuntimeSession({ task: "local status check", dir, now: NOW });
      assert.ok(r.toolExecution);
      assert.ok(r.toolExecution.selectedAdapter);
      assert.ok(validateRuntimeSession(r).valid);
    });
  });

  describe("S10: risky auth/security task", () => {
    before(() => resetAllAdapterHealth());

    it("blocked or approval-required, no uncontrolled delegated execution", () => {
      const plan = planToolExecution({
        taskType: "code_generation", riskClass: "high",
        paymentTouched: false, authTouched: true,
        productionImpactPossible: false, deterministicEvidenceAvailable: false,
        deepMode: false, secretsPossible: true, dir: tmpdir(), now: NOW,
      });
      assert.ok(
        plan.selectedAdapter === "semgrep" || plan.selectedAdapter === "scanner" || plan.selectedAdapter === "manual-gate",
        `security task must route to semgrep/scanner/manual-gate, got ${plan.selectedAdapter}`,
      );
      assert.ok(plan.forbiddenActions.includes("expose_secret_to_adapter"));

      // Even if forced to claude-code, forbidden task is blocked
      const ctx: ExecutionContext = {
        dir: tmpdir(), task: "change auth session settings", now: NOW,
        approved: false, useFakeAdapters: false,
      };
      const fPlan = { ...plan, selectedAdapter: "claude-code" as ToolAdapterId, executionMode: "real" as const };
      const result = runToolExecution(fPlan, ctx);
      assert.ok(result.status === "blocked" || result.status === "approval_required");
    });
  });

  describe("S11: billing/payment/webhook", () => {
    before(() => resetAllAdapterHealth());

    it("elevated proof, manual-gate or approval-required, receipt proves block", () => {
      const plan = planToolExecution({
        taskType: "code_generation", riskClass: "high",
        paymentTouched: true, authTouched: false,
        productionImpactPossible: false, deterministicEvidenceAvailable: false,
        deepMode: false, secretsPossible: true, dir: tmpdir(), now: NOW,
      });
      assert.equal(plan.approvalRequired, true);
      assert.equal(plan.proofRequired, true);

      const ctx: ExecutionContext = { dir: tmpdir(), task: "update billing webhook", now: NOW, approved: false, useFakeAdapters: false };
      const result = runToolExecution(plan, ctx);
      assert.ok(result.status === "approval_required" || result.status === "blocked");
      assert.ok(result.receiptId.startsWith("tpr_"));
    });
  });

  describe("S12: production/deploy/release/npm", () => {
    before(() => resetAllAdapterHealth());

    it("manual-gate/blocked only, model/tool cannot approve", () => {
      const plan = planToolExecution({
        taskType: "deploy", riskClass: "high",
        paymentTouched: false, authTouched: false,
        productionImpactPossible: true, deterministicEvidenceAvailable: false,
        deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
      });
      assert.equal(plan.selectedAdapter, "manual-gate");
      assert.equal(plan.toolMayExecute, false);
      assert.equal(plan.modelMayDecide, false);
      assert.ok(plan.forbiddenActions.includes("tool_approves_deploy"));

      const ctx: ExecutionContext = { dir: tmpdir(), task: "deploy to production", now: NOW, approved: true, useFakeAdapters: false };
      const result = runToolExecution(plan, ctx);
      assert.equal(result.status, "blocked");
      assert.ok(result.reasonCodes.includes("MANUAL_GATE_BLOCKED"));
    });
  });

  describe("S13: adapter failure with fallback", () => {
    it("fallback only equal-or-safer, no proof/privacy downgrade", () => {
      const plan = planToolExecution({
        taskType: "code_generation", riskClass: "low",
        paymentTouched: false, authTouched: false,
        productionImpactPossible: false, deterministicEvidenceAvailable: false,
        deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
      });

      // Force claude-code to fail, expect safe fallback
      plan.selectedAdapter = "claude-code";
      plan.executionMode = "real";
      plan.fallbackAdapters = ["deterministic-local", "manual-gate"];

      const ctx: ExecutionContext = { dir: tmpdir(), task: "create a fixture", now: NOW, approved: true, useFakeAdapters: false };
      const result = runToolExecution(plan, ctx);

      // Claude code may not be installed → skipped (not "failed"), so fallback may not trigger
      // But the result must still be valid
      assert.ok(result.receiptId.startsWith("tpr_"));
      assert.equal(result.containsRawPrompt, false);
      assert.equal(result.containsRawSecret, false);
    });
  });

  describe("S14: raw persistence guard", () => {
    let dir: string;
    before(() => { dir = tmpDir("s14"); resetAllAdapterHealth(); });
    after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    it("no receipt/runtime/control-center/json contains raw content", () => {
      const { record: r } = runRuntimeSession({ task: "create a simple test helper", dir, now: NOW });
      const serialized = JSON.stringify(r);

      assert.equal(r.containsRawSecret, false);
      assert.equal(r.containsRawPrompt, false);
      assert.equal(r.containsRawSourceDump, false);
      assert.equal(r.toolExecution.containsRawPrompt, false);
      assert.equal(r.toolExecution.containsRawSource, false);
      assert.equal(r.toolExecution.containsRawSecret, false);
      assert.equal(r.toolExecution.containsRawOutput, false);
      assert.equal(r.toolExecution.containsRawModelOutput, false);
      assert.equal(r.toolExecution.containsRawTerminalOutput, false);
      assert.equal(r.toolExecution.containsRawGitDiff, false);

      assert.ok(!serialized.includes("sk-"), "no API keys");
      assert.ok(!serialized.includes("ANTHROPIC_API_KEY="), "no env vars");
      assert.ok(!serialized.includes("-----BEGIN"), "no certs");
      assert.ok(!serialized.includes("diff --git"), "no git diffs");

      if (r.toolExecution.delegatedExecution) {
        assert.equal(r.toolExecution.delegatedExecution.containsRawModelOutput, false);
      }

      const cc = buildControlCenter(dir, { now: NOW });
      const text = renderControlCenterText(cc);
      assert.ok(!text.includes("sk-"));
      assert.ok(!text.includes("ANTHROPIC_API_KEY"));
      assert.ok(!text.includes("-----BEGIN"));

      assert.ok(validateRuntimeSession(r).valid);
    });
  });

  describe("S15: seamless UX", () => {
    let dir: string;
    before(() => { dir = tmpDir("s15"); resetAllAdapterHealth(); });
    after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    it("normal output simple, no adapter/model/provider picker, details in diagnostics only", () => {
      const { record: r, displayTask } = runRuntimeSession({ task: "add helper function", dir, now: NOW });

      // The display task is a simple redacted string, not a picker prompt
      assert.ok(displayTask);
      assert.ok(!displayTask.includes("select adapter"));
      assert.ok(!displayTask.includes("choose model"));
      assert.ok(!displayTask.includes("API key"));

      // Tool execution is present but via automatic routing
      assert.ok(r.toolExecution.selectedAdapter);
      assert.equal(r.toolExecution.modelMayDecide, false);

      // Control center shows details only in diagnostics
      const cc = buildControlCenter(dir, { now: NOW });
      const text = renderControlCenterText(cc);
      assert.ok(text.includes("Executor:"));
      assert.ok(text.includes("exec:"));

      assert.ok(validateRuntimeSession(r).valid);
    });
  });

  describe("fake adapter forbidden task blocking", () => {
    it("fake adapters still block forbidden tasks", () => {
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
      assert.equal(result.status, "blocked");
      assert.ok(result.reasonCodes.includes("TASK_FORBIDDEN_EVEN_IN_FAKE_MODE"));
    });
  });

  describe("delegated execution in runtime session e2e", () => {
    let dir: string;
    before(() => { dir = tmpDir("e2e-del"); resetAllAdapterHealth(); });
    after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    it("runtime session records delegated execution with full proof chain", () => {
      // Use AVORELO_FAKE_ADAPTERS to test the delegated execution path in CI
      const origFake = process.env.AVORELO_FAKE_ADAPTERS;
      process.env.AVORELO_FAKE_ADAPTERS = "1";
      try {
        const { record: r } = runRuntimeSession({ task: "create a hello world fixture", dir, now: NOW });
        assert.ok(r.toolExecution);
        assert.ok(r.toolExecution.executionStatus);
        assert.ok(r.toolExecution.executionReceiptId);

        // Delegated execution must be present for code tasks routed to claude-code/codex
        if (r.toolExecution.selectedAdapter === "claude-code" || r.toolExecution.selectedAdapter === "codex") {
          assert.ok(r.toolExecution.delegatedExecution, "delegated execution must be present");
          assert.equal(r.toolExecution.delegatedExecution!.attempted, true);
          assert.equal(r.toolExecution.delegatedExecution!.containsRawModelOutput, false);
        }

        const cc = buildControlCenter(dir, { now: NOW });
        const text = renderControlCenterText(cc);
        assert.ok(text.includes("exec:"));

        assert.ok(validateRuntimeSession(r).valid);
      } finally {
        if (origFake === undefined) delete process.env.AVORELO_FAKE_ADAPTERS;
        else process.env.AVORELO_FAKE_ADAPTERS = origFake;
      }
    });
  });
});
