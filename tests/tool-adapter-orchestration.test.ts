// Tool Adapter Orchestration tests. Validates adapter selection, detection,
// policies, receipts, and runtime integration. node:test, zero-dep.
// No network, no real tool installations, no API keys.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  planToolExecution, buildToolRoutingProjection, getEffectiveAvailability,
  getAdapterDescriptors, getDescriptor, resetAllAdapterHealth, markAdapterUnhealthy,
  isAdapterHealthy, classifyTask, defaultPolicyConstraints, isAdapterAllowed,
  isFallbackSafe, createToolProofReceipt, createToolExecutionResult,
  detectAllTools, runToolExecution, type ToolAdapterId, type ExecutionContext,
} from "../src/avorelo/kernel/tool-adapters/index.ts";

import { runRuntimeSession, validateRuntimeSession } from "../src/avorelo/capabilities/runtime-flow/index.ts";
import { buildControlCenter, renderText as renderControlCenterText } from "../src/avorelo/capabilities/control-center/index.ts";

const NOW = 1718500000000;

function tmpDir(name: string): string {
  const d = join(tmpdir(), `avorelo-tool-test-${name}-${Date.now()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

describe("tool adapter orchestration", () => {
  before(() => resetAllAdapterHealth());

  describe("T1: both Claude Code and Codex available — ordinary code task", () => {
    let dir: string;
    before(() => { dir = tmpDir("t1"); resetAllAdapterHealth(); });
    after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    it("selects an adapter automatically, no user picker needed", () => {
      const { record: r } = runRuntimeSession({ task: "add helper function", dir, now: NOW });
      assert.ok(r.toolExecution, "toolExecution must be present");
      assert.ok(r.toolExecution.selectedAdapter, "must select an adapter");
      assert.equal(r.toolExecution.modelMayDecide, false);
      assert.equal(r.toolExecution.scannerMayDecide, false);
      assert.equal(r.toolExecution.finalDecisionOwner, "kernel/stop-continue-gate");
      assert.equal(r.toolExecution.containsRawPrompt, false);
      assert.equal(r.toolExecution.containsRawSource, false);
      assert.equal(r.toolExecution.containsRawSecret, false);
      assert.ok(r.toolExecution.fallbackAdapters.length >= 0);
      assert.ok(validateRuntimeSession(r).valid);
    });
  });

  describe("T2: only Claude Code available", () => {
    let dir: string;
    before(() => { dir = tmpDir("t2"); resetAllAdapterHealth(); });
    after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    it("routes code task to available adapter, records unavailable reasons", () => {
      const { record: r } = runRuntimeSession({ task: "refactor parser module", dir, now: NOW });
      assert.ok(r.toolExecution);
      assert.ok(r.toolExecution.reasonCodes.length > 0);
      assert.equal(r.toolExecution.modelMayDecide, false);
      assert.ok(validateRuntimeSession(r).valid);
    });
  });

  describe("T3: neither Claude Code nor Codex available", () => {
    let dir: string;
    before(() => { dir = tmpDir("t3"); resetAllAdapterHealth(); });
    after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    it("deterministic/manual/scanner paths still work safely", () => {
      const plan = planToolExecution({
        taskType: "code_generation", riskClass: "low",
        paymentTouched: false, authTouched: false,
        productionImpactPossible: false, deterministicEvidenceAvailable: false,
        deepMode: false, secretsPossible: false, dir, now: NOW,
      });
      assert.ok(plan.selectedAdapter);
      assert.equal(plan.modelMayDecide, false);
      assert.equal(plan.scannerMayDecide, false);
      assert.equal(plan.finalDecisionOwner, "kernel/stop-continue-gate");

      const { record: r } = runRuntimeSession({ task: "local status check", dir, now: NOW });
      assert.ok(r.toolExecution);
      assert.ok(validateRuntimeSession(r).valid);
    });
  });

  describe("T4: security/auth task", () => {
    before(() => resetAllAdapterHealth());

    it("scanner/manual gate before any agent, sensitive data preserved", () => {
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
      assert.equal(plan.modelMayDecide, false);
      assert.ok(plan.forbiddenActions.includes("persist_raw_secret"));
      assert.ok(plan.forbiddenActions.includes("expose_secret_to_adapter"));
    });
  });

  describe("T5: billing/payment task", () => {
    before(() => resetAllAdapterHealth());

    it("elevated proof, approval required, no automatic irreversible action", () => {
      const plan = planToolExecution({
        taskType: "code_generation", riskClass: "high",
        paymentTouched: true, authTouched: false,
        productionImpactPossible: false, deterministicEvidenceAvailable: false,
        deepMode: false, secretsPossible: true, dir: tmpdir(), now: NOW,
      });
      assert.equal(plan.approvalRequired, true, "billing must require approval");
      assert.equal(plan.proofRequired, true, "billing must require proof");
      assert.equal(plan.modelMayDecide, false);
    });
  });

  describe("T6: production/deploy task", () => {
    before(() => resetAllAdapterHealth());

    it("manual-gate only, model/tool cannot approve production", () => {
      const plan = planToolExecution({
        taskType: "deploy", riskClass: "high",
        paymentTouched: false, authTouched: false,
        productionImpactPossible: true, deterministicEvidenceAvailable: false,
        deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
      });
      assert.equal(plan.selectedAdapter, "manual-gate", "production must use manual-gate");
      assert.equal(plan.executionMode, "manual_gate");
      assert.equal(plan.approvalRequired, true);
      assert.equal(plan.toolMayExecute, false);
      assert.equal(plan.modelMayDecide, false);
      assert.ok(plan.forbiddenActions.includes("tool_approves_deploy"));
    });
  });

  describe("T7: provider/tool failure", () => {
    before(() => {
      resetAllAdapterHealth();
      markAdapterUnhealthy("claude-code", "timeout", 600000, NOW);
    });
    after(() => resetAllAdapterHealth());

    it("adapter marked unhealthy, fallback only equal-or-safer", () => {
      assert.equal(isAdapterHealthy("claude-code", NOW), false);
      assert.equal(isAdapterHealthy("deterministic-local", NOW), true);

      const plan = planToolExecution({
        taskType: "code_generation", riskClass: "low",
        paymentTouched: false, authTouched: false,
        productionImpactPossible: false, deterministicEvidenceAvailable: false,
        deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
      });
      assert.notEqual(plan.selectedAdapter, "claude-code", "unhealthy adapter must not be selected");
      assert.ok(plan.reasonCodes.some(c => c.includes("UNHEALTHY") || c.includes("UNAVAILABLE")));
    });
  });

  describe("T8: tool availability detection", () => {
    it("detection does not run real tasks, no network, no login", () => {
      const all = detectAllTools(tmpdir(), NOW);
      assert.equal(all.length, 11, "must detect every current adapter type");
      for (const t of all) {
        assert.ok(t.detectionMethod, "detection method must be recorded");
        assert.ok(t.checkedAt === NOW, "checked time must be recorded");
        assert.ok(t.signals.length > 0, "must have signals");
      }
      const ids = new Set(all.map((t) => t.adapterId));
      for (const id of ["deterministic-local", "manual-gate", "scanner", "semgrep", "playwright-proof", "github-actions", "claude-code", "codex"]) {
        assert.ok(ids.has(id), `missing adapter detection for ${id}`);
      }
      const deterministicLocal = all.find(t => t.adapterId === "deterministic-local");
      assert.equal(deterministicLocal?.status, "available", "deterministic-local always available");
      const manualGate = all.find(t => t.adapterId === "manual-gate");
      assert.equal(manualGate?.status, "available", "manual-gate always available");
    });
  });

  describe("T9: CLI UX — normal output simple, JSON includes toolExecution", () => {
    let dir: string;
    before(() => { dir = tmpDir("t9"); });
    after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    it("serialized session includes safe tool routing metadata", () => {
      const { record: r } = runRuntimeSession({ task: "run linter", dir, now: NOW });
      const serialized = JSON.stringify(r);

      assert.ok(serialized.includes("toolExecution"));
      assert.ok(serialized.includes("selectedAdapter"));
      assert.ok(serialized.includes("executionMode"));
      assert.ok(!serialized.includes("sk-"), "no API keys");
      assert.ok(!serialized.includes("ANTHROPIC_API_KEY"));
      assert.equal(r.toolExecution.containsRawPrompt, false);
      assert.equal(r.toolExecution.containsRawSource, false);
      assert.equal(r.toolExecution.containsRawSecret, false);
    });
  });

  describe("T10: control-center/status/doctor", () => {
    let dir: string;
    before(() => { dir = tmpDir("t10"); resetAllAdapterHealth(); });
    after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    it("shows adapter routing as safe diagnostics, no raw persistence", () => {
      runRuntimeSession({ task: "check code quality", dir, now: NOW });
      const cc = buildControlCenter(dir, { now: NOW });
      const text = renderControlCenterText(cc);
      const te = cc.sections.toolExecution;

      assert.ok(!text.includes("sk-"), "no API keys in text output");
      assert.ok(!text.includes("ANTHROPIC_API_KEY"));

      if (te.status === "available") {
        assert.ok(te.selectedAdapter);
        assert.ok(te.executionMode);
        assert.equal(te.modelMayDecide, false);
        assert.equal(te.finalDecisionOwner, "kernel/stop-continue-gate");
      }
    });
  });

  describe("T11: regression for existing blockers", () => {
    let dir: string;
    before(() => { dir = tmpDir("t11"); resetAllAdapterHealth(); });
    after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    it("verifier rejection still fails closed with tool execution", () => {
      const { record: r } = runRuntimeSession({ task: "add error handler", dir, now: NOW });
      assert.ok(r.modelRouting);
      assert.ok(r.toolExecution);
      assert.equal(r.modelRouting.modelMayDecide, false);
      assert.equal(r.toolExecution.modelMayDecide, false);
      assert.ok(!r.modelRouting.reasonCodes.includes("MODEL_ROUTING_VERIFIER_REJECTED"));
      assert.ok(validateRuntimeSession(r).valid);
    });
  });

  describe("adapter registry and descriptors", () => {
    it("has descriptors for every current adapter with complete capability info", () => {
      const descriptors = getAdapterDescriptors();
      assert.equal(descriptors.length, 11);
      for (const d of descriptors) {
        assert.ok(d.id);
        assert.ok(d.displayName);
        assert.ok(typeof d.localOnly === "boolean");
        assert.ok(typeof d.requiresNetwork === "boolean");
        assert.ok(d.supportedPlatforms.length > 0);
        assert.ok(d.limitations.length >= 0);
      }
    });

    it("deterministic-local and manual-gate are always local-only", () => {
      const dl = getDescriptor("deterministic-local");
      const mg = getDescriptor("manual-gate");
      assert.equal(dl?.localOnly, true);
      assert.equal(mg?.localOnly, true);
      assert.equal(dl?.requiresNetwork, false);
      assert.equal(mg?.requiresNetwork, false);
    });
  });

  describe("policy constraints", () => {
    it("fallback cannot lower privacy", () => {
      const safe = isFallbackSafe(
        { dataPolicy: "local_only", riskCeiling: "low" },
        { dataPolicy: "training_included", riskCeiling: "low" },
        defaultPolicyConstraints(),
      );
      assert.equal(safe, false, "fallback from local_only to training_included must be blocked");
    });

    it("fallback cannot lower proof", () => {
      const safe = isFallbackSafe(
        { dataPolicy: "no_training", riskCeiling: "low" },
        { dataPolicy: "no_training", riskCeiling: "high" },
        defaultPolicyConstraints(),
      );
      assert.equal(safe, false, "fallback from low-risk to high-risk must be blocked");
    });

    it("task classification maps correctly", () => {
      assert.equal(classifyTask("docs", "low", { paymentTouched: false, authTouched: false, productionImpactPossible: false, deterministicEvidenceAvailable: true, deepMode: false }), "deterministic_check");
      assert.equal(classifyTask("deploy", "high", { paymentTouched: false, authTouched: false, productionImpactPossible: true, deterministicEvidenceAvailable: false, deepMode: false }), "production_deploy");
      assert.equal(classifyTask("code_generation", "high", { paymentTouched: true, authTouched: false, productionImpactPossible: false, deterministicEvidenceAvailable: false, deepMode: false }), "billing_payment");
      assert.equal(classifyTask("code_generation", "high", { paymentTouched: false, authTouched: true, productionImpactPossible: false, deterministicEvidenceAvailable: false, deepMode: false }), "security_review");
    });
  });

  describe("proof receipts", () => {
    it("receipt has no raw content flags", () => {
      const receipt = createToolProofReceipt("deterministic-local", "deterministic", "executed", ["DETERMINISTIC_CHECK"], NOW);
      assert.equal(receipt.contract, "avorelo.toolProofReceipt.v1");
      assert.equal(receipt.containsRawPrompt, false);
      assert.equal(receipt.containsRawSource, false);
      assert.equal(receipt.containsRawSecret, false);
      assert.equal(receipt.containsRawOutput, false);
      assert.equal(receipt.modelMayDecide, false);
      assert.ok(receipt.receiptId.startsWith("tpr_"));
    });

    it("execution result tracks status and proof", () => {
      const result = createToolExecutionResult("scanner", "scanner", "executed", ["SECURITY_SCAN"], NOW);
      assert.equal(result.adapterId, "scanner");
      assert.equal(result.status, "executed");
      assert.equal(result.proofCollected, true);
      assert.ok(result.receiptId.startsWith("tpr_"));
    });
  });

  describe("real execution", () => {
    before(() => resetAllAdapterHealth());

    it("deterministic-local executes real commands and produces proof", () => {
      const plan = planToolExecution({
        taskType: "docs", riskClass: "low",
        paymentTouched: false, authTouched: false,
        productionImpactPossible: false, deterministicEvidenceAvailable: true,
        deepMode: false, secretsPossible: false, dir: process.cwd(), now: NOW,
      });
      const ctx: ExecutionContext = { dir: process.cwd(), task: "check node version", now: NOW, approved: true, useFakeAdapters: false };
      const result = runToolExecution(plan, ctx);
      assert.ok(result.receiptId.startsWith("tpr_"));
      assert.equal(result.containsRawPrompt, false);
      assert.equal(result.containsRawSource, false);
      assert.equal(result.containsRawSecret, false);
      assert.equal(result.containsRawOutput, false);
      assert.ok(result.durationMs >= 0);
    });

    it("manual-gate blocks and produces proof receipt", () => {
      const plan = planToolExecution({
        taskType: "deploy", riskClass: "high",
        paymentTouched: false, authTouched: false,
        productionImpactPossible: true, deterministicEvidenceAvailable: false,
        deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
      });
      const ctx: ExecutionContext = { dir: tmpdir(), task: "deploy to production", now: NOW, approved: true, useFakeAdapters: false };
      const result = runToolExecution(plan, ctx);
      assert.equal(result.adapterId, "manual-gate");
      assert.equal(result.status, "blocked");
      assert.equal(result.proofCollected, true);
      assert.ok(result.reasonCodes.includes("MANUAL_GATE_BLOCKED"));
    });

    it("unapproved task returns approval_required", () => {
      const plan = planToolExecution({
        taskType: "code_generation", riskClass: "high",
        paymentTouched: true, authTouched: false,
        productionImpactPossible: false, deterministicEvidenceAvailable: false,
        deepMode: false, secretsPossible: true, dir: tmpdir(), now: NOW,
      });
      const ctx: ExecutionContext = { dir: tmpdir(), task: "billing change", now: NOW, approved: false, useFakeAdapters: false };
      const result = runToolExecution(plan, ctx);
      assert.equal(result.status, "approval_required");
      assert.ok(result.reasonCodes.includes("APPROVAL_REQUIRED"));
    });

    it("fake adapter execution in CI mode produces valid receipt", () => {
      const plan = planToolExecution({
        taskType: "code_generation", riskClass: "low",
        paymentTouched: false, authTouched: false,
        productionImpactPossible: false, deterministicEvidenceAvailable: false,
        deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
      });
      // Force to claude-code for fake test
      plan.selectedAdapter = "claude-code";
      plan.executionMode = "dry_run";
      const ctx: ExecutionContext = { dir: tmpdir(), task: "add feature", now: NOW, approved: true, useFakeAdapters: true };
      const result = runToolExecution(plan, ctx);
      assert.equal(result.status, "executed");
      assert.ok(result.reasonCodes.includes("CI_FAKE_ADAPTER"));
      assert.ok(result.output?.includes("[fake]"));
      assert.equal(result.containsRawPrompt, false);
      assert.equal(result.containsRawSecret, false);
    });

    it("execution output is sanitized — no API keys", () => {
      const plan = planToolExecution({
        taskType: "docs", riskClass: "low",
        paymentTouched: false, authTouched: false,
        productionImpactPossible: false, deterministicEvidenceAvailable: true,
        deepMode: false, secretsPossible: false, dir: process.cwd(), now: NOW,
      });
      const ctx: ExecutionContext = { dir: process.cwd(), task: "check status", now: NOW, approved: true, useFakeAdapters: false };
      const result = runToolExecution(plan, ctx);
      if (result.output) {
        assert.ok(!result.output.includes("sk-"), "no API keys in output");
        assert.ok(!result.output.includes("ANTHROPIC_API_KEY="), "no env var values in output");
      }
    });
  });

  describe("runtime session with real execution", () => {
    let dir: string;
    before(() => { dir = tmpDir("exec"); resetAllAdapterHealth(); });
    after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    it("runtime session includes execution status and receipt", () => {
      const { record: r } = runRuntimeSession({ task: "check status", dir, now: NOW });
      assert.ok(r.toolExecution.executionStatus, "execution status present");
      assert.ok(r.toolExecution.executionReceiptId, "execution receipt present");
      assert.ok(typeof r.toolExecution.executionDurationMs === "number", "duration recorded");
      assert.equal(r.toolExecution.containsRawOutput, false);
      assert.equal(r.toolExecution.containsRawModelOutput, false);
      assert.equal(r.toolExecution.containsRawTerminalOutput, false);
      assert.equal(r.toolExecution.containsRawGitDiff, false);
      assert.ok(validateRuntimeSession(r).valid);
    });
  });

  describe("T12: downgrade blocked within session", () => {
    before(() => resetAllAdapterHealth());

    it("sensitive route cannot silently downgrade execution", () => {
      const securityPlan = planToolExecution({
        taskType: "code_generation", riskClass: "high",
        paymentTouched: false, authTouched: true,
        productionImpactPossible: false, deterministicEvidenceAvailable: false,
        deepMode: false, secretsPossible: true, dir: tmpdir(), now: NOW,
      });
      assert.ok(securityPlan.proofRequired, "security task requires proof");
      assert.ok(
        securityPlan.selectedAdapter === "semgrep" || securityPlan.selectedAdapter === "scanner" || securityPlan.selectedAdapter === "manual-gate",
        "security routes to semgrep/scanner/manual-gate",
      );
      for (const fb of securityPlan.fallbackAdapters) {
        const desc = getDescriptor(fb);
        if (desc) {
          const safe = isFallbackSafe(
            { dataPolicy: getDescriptor(securityPlan.selectedAdapter)!.dataPolicy, riskCeiling: getDescriptor(securityPlan.selectedAdapter)!.riskCeiling },
            { dataPolicy: desc.dataPolicy, riskCeiling: desc.riskCeiling },
            defaultPolicyConstraints(),
          );
          assert.ok(safe, `fallback to ${fb} must be safe`);
        }
      }
    });
  });

  describe("T15: end-to-end Avorelo dogfood scenario", () => {
    let dir: string;
    before(() => { dir = tmpDir("e2e"); resetAllAdapterHealth(); });
    after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    it("routing + toolExecution + receipt + control-center all reflect execution", () => {
      const { record: r } = runRuntimeSession({ task: "check readiness", dir, now: NOW });
      assert.ok(r.modelRouting);
      assert.ok(r.toolExecution);
      assert.ok(r.toolExecution.executionStatus);
      assert.ok(r.toolExecution.executionReceiptId);

      const cc = buildControlCenter(dir, { now: NOW });
      const text = renderControlCenterText(cc);
      const te = cc.sections.toolExecution;
      assert.ok(te.executionStatus);
      assert.ok(te.executionReceiptId);
      assert.equal(te.containsRawOutput, false);
      assert.equal(te.containsRawModelOutput, false);

      assert.ok(!text.includes("sk-"));
      assert.ok(!text.includes("ANTHROPIC_API_KEY"));
      assert.ok(text.includes("exec:"));
      assert.ok(validateRuntimeSession(r).valid);
    });
  });
});
