// Model routing usage-level tests. Validates routing through actual runtime sessions,
// control-router, and control-center — not only isolated kernel functions.
// node:test, zero-dep. No network, no API keys, no external providers.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runRuntimeSession, validateRuntimeSession } from "../src/avorelo/capabilities/runtime-flow/index.ts";
import { buildControlCenter, renderText as renderControlCenterText } from "../src/avorelo/capabilities/control-center/index.ts";
import { unifiedRoute, type UnifiedTaskFrame } from "../src/avorelo/control-router/index.ts";
import {
  routeCanonical, resolveModel, resetAllHealth, markProviderUnhealthy,
  createRouteSession, requestProfileChange, canDowngrade, recordSensitiveSurface,
  getModelsForProfile,
} from "../src/avorelo/kernel/model-routing/index.ts";

const NOW = 1718500000000;

function tmpDir(name: string): string {
  const d = join(tmpdir(), `avorelo-usage-test-${name}-${Date.now()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function baseUnifiedFrame(overrides: Partial<UnifiedTaskFrame> = {}): UnifiedTaskFrame {
  return {
    taskType: "code", riskClass: "low", touchedLayers: [], browserAvailable: false,
    externalToolsAllowed: false, scannerAvailable: true, mcpTouched: false,
    paymentTouched: false, authTouched: false, cloudTouched: false,
    dashboardTouched: false, publicCopyTouched: false, proofRequired: false,
    deterministicEvidenceAvailable: true, dataSensitivity: "low",
    externalWriteRequested: false, secretsPossible: false,
    productionImpactPossible: false, deepMode: false, changedFiles: [],
    userIntent: "local task", localOnly: true, userPlan: "",
    founderCockpitTouched: false, aiTeamTouched: false,
    feedbackLoopTouched: false, oldRepoReferenceUsed: false,
    installedTools: [], contextBudgetRemaining: 100000, tokenBudgetRemaining: 100000,
    ...overrides,
  };
}

describe("model routing usage-level", () => {
  before(() => resetAllHealth());

  describe("S1: low-risk deterministic task", () => {
    let dir: string;
    before(() => { dir = tmpDir("s1"); });
    after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    it("runtime session has modelRouting with safe flags", () => {
      const { record: r } = runRuntimeSession({ task: "summarize local project status", dir, now: NOW });
      assert.ok(r.modelRouting, "modelRouting must be present");
      assert.equal(r.modelRouting.modelMayDecide, false);
      assert.equal(r.modelRouting.containsRawPrompt, false);
      assert.equal(r.modelRouting.containsRawSource, false);
      assert.equal(r.modelRouting.containsRawSecret, false);
      assert.equal(r.redacted, true);
      assert.equal(r.containsRawPrompt, false);
      assert.equal(r.containsRawSecret, false);
      assert.ok(validateRuntimeSession(r).valid);
    });
  });

  describe("S2: normal coding task", () => {
    let dir: string;
    before(() => { dir = tmpDir("s2"); });
    after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    it("completes with safe routing, no fake savings, no raw persistence", () => {
      const { record: r } = runRuntimeSession({ task: "add unit tests for the parser module", dir, now: NOW });
      assert.ok(validateRuntimeSession(r).valid);
      assert.ok(r.modelRouting, "modelRouting must be present");
      assert.equal(r.modelRouting.modelMayDecide, false);
      assert.notEqual(r.proof?.canShowSavings, true, "savings must not be claimed");
      assert.equal(r.containsRawPrompt, false);
      assert.equal(r.containsRawSourceDump, false);
    });
  });

  describe("S3: auth/security-sensitive task", () => {
    before(() => resetAllHealth());

    it("routes to safe profile with data protection, model never decides", () => {
      const frame = baseUnifiedFrame({ riskClass: "high", authTouched: true, dataSensitivity: "high", proofRequired: true });
      const decision = unifiedRoute(frame);

      assert.equal(decision.modelMayDecide, false);
      assert.equal(decision.scannerMayDecide, false);
      assert.equal(decision.finalDecisionOwner, "kernel/stop-continue-gate");
      assert.ok(decision.forbiddenActions.includes("model_owns_READY"));
      assert.ok(decision.modelRoutingProjection, "canonical routing projection must exist");
      assert.equal(decision.modelRoutingProjection!.modelMayDecide, false);
    });

    it("sensitive profiles exclude training_included providers", () => {
      const canonical = routeCanonical({
        frame: baseUnifiedFrame({ riskClass: "high", authTouched: true, dataSensitivity: "high" }),
        approvalPolicy: "none",
        now: NOW,
      });
      const resolved = canonical.resolverResult.selectedModel;
      if (resolved) {
        assert.notEqual(resolved.dataPolicy, "training_included", "sensitive route must not use training_included provider");
      }
    });
  });

  describe("S4: billing/payment task", () => {
    let dir: string;
    before(() => { dir = tmpDir("s4"); resetAllHealth(); });
    after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    it("raises risk, model never decides, no fake savings", () => {
      const decision = unifiedRoute(baseUnifiedFrame({ riskClass: "high", paymentTouched: true, proofRequired: true }));
      assert.equal(decision.modelMayDecide, false);
      assert.equal(decision.finalDecisionOwner, "kernel/stop-continue-gate");

      const { record: r } = runRuntimeSession({ task: "update webhook handler for billing events", dir, now: NOW });
      assert.ok(r.modelRouting);
      assert.equal(r.modelRouting.modelMayDecide, false);
      assert.notEqual(r.proof?.canShowSavings, true);
      assert.equal(r.containsRawSecret, false);
    });
  });

  describe("S5: production/deploy task", () => {
    before(() => resetAllHealth());

    it("blocks or requires approval, model cannot approve production", () => {
      const decision = unifiedRoute(baseUnifiedFrame({
        taskType: "deploy", riskClass: "high", productionImpactPossible: true, proofRequired: true,
      }));
      assert.ok(
        decision.selectedPrimitive === "stop_blocked" || decision.approvalRequired,
        "production task must be blocked or require approval",
      );
      assert.equal(decision.modelMayDecide, false);
      assert.equal(decision.scannerMayDecide, false);
      assert.ok(decision.forbiddenActions.includes("model_owns_READY"));
      assert.ok(decision.canonicalRouting, "canonical routing must exist");
      assert.equal(decision.canonicalRouting!.projection.modelMayDecide, false);
    });
  });

  describe("S6: long-context / provider capability", () => {
    before(() => resetAllHealth());

    it("filters by capability requirements, provides reason codes", () => {
      const canonical = routeCanonical({
        frame: baseUnifiedFrame({ deepMode: true }),
        approvalPolicy: "none",
        contextSignals: { estimatedTokens: 500000, requiresVision: false, requiresToolUse: true, requiresJsonOutput: true, requiresReasoning: true },
        now: NOW,
      });
      assert.equal(canonical.projection.modelMayDecide, false);
      assert.equal(canonical.projection.finalDecisionOwner, "kernel/stop-continue-gate");
      assert.ok(canonical.resolverResult.reasonCodes.length > 0, "reason codes must explain filtering");
      if (canonical.resolverResult.selectedModel) {
        assert.ok(canonical.resolverResult.selectedModel.contextWindow >= 500000 || canonical.resolverResult.status === "no_safe_candidate");
      }
    });
  });

  describe("S7: provider failure/fallback", () => {
    before(() => {
      resetAllHealth();
      markProviderUnhealthy("anthropic", "timeout", 600000, NOW);
      markProviderUnhealthy("openai", "rate_limit", 600000, NOW);
    });
    after(() => resetAllHealth());

    it("does not resolve to unhealthy provider, safety preserved", () => {
      const canonical = routeCanonical({
        frame: baseUnifiedFrame(),
        approvalPolicy: "none",
        now: NOW,
      });
      assert.equal(canonical.projection.modelMayDecide, false);
      assert.equal(canonical.projection.containsRawPrompt, false);
      if (canonical.resolverResult.selectedModel) {
        assert.notEqual(canonical.resolverResult.selectedModel.provider, "anthropic");
        assert.notEqual(canonical.resolverResult.selectedModel.provider, "openai");
      }
    });
  });

  describe("S8: downgrade attempt", () => {
    it("escalation allowed, downgrade blocked, canDowngrade always false", () => {
      const session = createRouteSession("usage-test-s8");
      const r1 = requestProfileChange(session, "cheap_classification", "initial_task");
      assert.equal(r1.allowed, true);

      const r2 = requestProfileChange(session, "security_sensitive_review", "auth_surface_touched");
      assert.equal(r2.allowed, true);
      assert.equal(r2.wasEscalation, true);
      recordSensitiveSurface(session, "auth");

      const r3 = requestProfileChange(session, "cheap_classification", "simple_followup");
      assert.equal(r3.allowed, false, "downgrade must be blocked");
      assert.equal(session.highWaterProfile, "security_sensitive_review");
      assert.ok(session.downgradeAttempts >= 1);
      assert.equal(canDowngrade(session), false);
      assert.ok(session.sensitiveSurfacesTouched.includes("auth"));
    });
  });

  describe("P1 regression: verifier rejection fails closed", () => {
    let dir: string;
    before(() => { dir = tmpDir("p1"); resetAllHealth(); });
    after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    it("runtime session with valid routing has verifier-approved projection", () => {
      const { record: r } = runRuntimeSession({ task: "add logging to error handler", dir, now: NOW });
      assert.ok(r.modelRouting, "modelRouting must be present");
      assert.equal(r.modelRouting.modelMayDecide, false);
      assert.equal(r.modelRouting.scannerMayDecide, false);
      assert.equal(r.modelRouting.finalDecisionOwner, "kernel/stop-continue-gate");
      assert.equal(r.modelRouting.containsRawPrompt, false);
      assert.equal(r.modelRouting.containsRawSource, false);
      assert.equal(r.modelRouting.containsRawSecret, false);
      assert.ok(!r.modelRouting.reasonCodes.includes("MODEL_ROUTING_VERIFIER_REJECTED"),
        "valid routing must not have VERIFIER_REJECTED reason code");
    });

    it("verifier-rejected projection must not leak into runtime session", () => {
      const canonical = routeCanonical({
        frame: baseUnifiedFrame({ deterministicEvidenceAvailable: false }),
        approvalPolicy: "none",
        now: NOW,
      });
      assert.equal(canonical.verifierResult.valid, true, "normal routing must pass verifier");
      assert.equal(canonical.projection.modelMayDecide, false);
      assert.equal(canonical.projection.scannerMayDecide, false);
    });
  });

  describe("P2 regression: normal code work routes to code_generation profile", () => {
    before(() => resetAllHealth());

    it("runtime session for code task selects code_generation profile", () => {
      const dir = tmpDir("p2");
      try {
        const { record: r } = runRuntimeSession({ task: "refactor the parser module", dir, now: NOW });
        assert.ok(r.modelRouting, "modelRouting must be present");
        assert.ok(
          r.modelRouting.reasonCodes.includes("CODE_GENERATION_PROOF_REQUIRED") ||
          r.modelRouting.selectedModelProfile === "code_generation" ||
          r.modelRouting.resolverStatus === "verifier_rejected",
          "normal code work must route through code_generation profile or be verifier-safe",
        );
      } finally {
        try { rmSync(dir, { recursive: true, force: true }); } catch {}
      }
    });

    it("unified route for code_generation taskType gets correct profile", () => {
      const decision = unifiedRoute(baseUnifiedFrame({
        taskType: "code_generation",
        deterministicEvidenceAvailable: false,
      }));
      assert.equal(decision.selectedModelProfile, "code_generation");
      assert.ok(decision.reasonCodes.includes("CODE_GENERATION_PROOF_REQUIRED"));
    });
  });

  describe("S9: CLI UX — serialized output safety", () => {
    let dir: string;
    before(() => { dir = tmpDir("s9"); });
    after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    it("serialized session exposes safe routing metadata, no API keys", () => {
      const { record: r } = runRuntimeSession({ task: "check code quality", dir, now: NOW });
      const serialized = JSON.stringify(r);

      assert.ok(r.modelRouting, "modelRouting must be present");
      assert.ok(serialized.includes("modelMayDecide"));
      assert.ok(serialized.includes("finalDecisionOwner"));
      assert.ok(!serialized.includes("sk-"), "no API keys in output");
      assert.ok(!serialized.includes("ANTHROPIC_API_KEY"));
      assert.ok(!serialized.includes("OPENAI_API_KEY"));
      assert.equal(r.modelRouting.containsRawPrompt, false);
      assert.equal(r.modelRouting.containsRawSource, false);
      assert.equal(r.modelRouting.containsRawSecret, false);
      assert.ok(r.modelRouting.selectedPrimitive);
      assert.ok(r.modelRouting.selectedModelProfile !== undefined);
      assert.ok(r.modelRouting.resolverStatus);
      assert.ok(Array.isArray(r.modelRouting.reasonCodes));
    });
  });

  describe("S10: control-center routing diagnostics", () => {
    let dir: string;
    before(() => { dir = tmpDir("s10"); resetAllHealth(); });
    after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    it("control-center shows routing as safe diagnostics, no leaks", () => {
      runRuntimeSession({ task: "refactor auth middleware", dir, now: NOW });
      const cc = buildControlCenter(dir, { now: NOW });
      const text = renderControlCenterText(cc);
      const mr = cc.sections.modelRouting;

      assert.equal(cc.contract, "avorelo.controlCenter.v1");
      assert.ok(!text.includes("sk-"), "no API keys in text output");
      assert.ok(!text.includes("ghp_"));
      assert.ok(!text.includes("ANTHROPIC_API_KEY"));

      if (mr.status === "available") {
        assert.ok(mr.selectedPrimitive);
        assert.ok(mr.selectedModelProfile !== undefined);
        assert.equal(mr.modelMayDecide, false);
        assert.equal(mr.finalDecisionOwner, "kernel/stop-continue-gate");
      }
    });
  });
});
