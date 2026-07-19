import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  routeCanonical,
  getModelRegistry,
  getModelsForProfile,
  getLocalModels,
  getEnabledModels,
  getModel,
  resolveModel,
  createRouteSession,
  requestProfileChange,
  canDowngrade,
  recordSensitiveSurface,
  markProviderUnhealthy,
  markProviderHealthy,
  resetAllHealth,
  isProviderAvailable,
  buildCascade,
  verifyRoutingDecision,
  createSafeProjection,
  routePrimitive,
} from "../src/avorelo/kernel/model-routing/index.ts";

function baseFrame() {
  return {
    taskType: "code",
    riskClass: "low" as const,
    touchedLayers: [] as string[],
    browserAvailable: false,
    externalToolsAllowed: false,
    scannerAvailable: true,
    mcpTouched: false,
    paymentTouched: false,
    authTouched: false,
    cloudTouched: false,
    dashboardTouched: false,
    publicCopyTouched: false,
    proofRequired: false,
    deterministicEvidenceAvailable: false,
    dataSensitivity: "low" as const,
    externalWriteRequested: false,
    secretsPossible: false,
    productionImpactPossible: false,
    deepMode: false,
  };
}

describe("model registry", () => {
  it("returns non-empty registry", () => {
    const reg = getModelRegistry();
    assert.ok(reg.length > 0);
  });

  it("has local and cloud models", () => {
    const local = getLocalModels();
    const all = getEnabledModels();
    assert.ok(local.length > 0);
    assert.ok(all.length > local.length);
  });

  it("getModel returns correct model", () => {
    const m = getModel("local/deterministic");
    assert.ok(m);
    assert.equal(m.providerClass, "local");
    assert.equal(m.costClass, "free");
  });

  it("getModelsForProfile returns matching models", () => {
    const models = getModelsForProfile("code_generation");
    assert.ok(models.length > 0);
    for (const m of models) {
      assert.ok(m.profiles.includes("code_generation"));
    }
  });

  it("all models have required fields", () => {
    for (const m of getModelRegistry()) {
      assert.ok(m.modelId);
      assert.ok(m.provider);
      assert.ok(m.providerClass);
      assert.ok(typeof m.contextWindow === "number");
      assert.ok(typeof m.supportsVision === "boolean");
    }
  });
});

describe("provider registry", () => {
  it("all providers start healthy", () => {
    resetAllHealth();
    assert.ok(isProviderAvailable("anthropic"));
    assert.ok(isProviderAvailable("openai"));
    assert.ok(isProviderAvailable("local"));
  });

  it("marks provider unhealthy and recovers after cooldown", () => {
    resetAllHealth();
    const now = 1000000;
    markProviderUnhealthy("anthropic", "429", 5000, now);
    assert.equal(isProviderAvailable("anthropic", now + 1000), false);
    assert.equal(isProviderAvailable("anthropic", now + 6000), true);
    resetAllHealth();
  });

  it("markProviderHealthy restores immediately", () => {
    resetAllHealth();
    markProviderUnhealthy("openai", "500", 60000);
    markProviderHealthy("openai");
    assert.ok(isProviderAvailable("openai"));
    resetAllHealth();
  });
});

describe("resolver", () => {
  it("no_model profile returns no_model_needed", () => {
    const result = resolveModel({
      profile: "none",
      providerConstraints: { localOnly: false, denyDataCollection: false, requireVision: false, requireToolSupport: false, requireJsonOutput: false, maxCostClass: "standard", allowedProviders: null, deniedProviders: null },
      contextSignals: { estimatedTokens: 0, requiresVision: false, requiresToolUse: false, requiresJsonOutput: false, requiresReasoning: false },
      approvalPolicy: "none",
    });
    assert.equal(result.status, "no_model_needed");
    assert.equal(result.selectedModel, null);
  });

  it("blocked approval returns stop_blocked", () => {
    const result = resolveModel({
      profile: "code_generation",
      providerConstraints: { localOnly: false, denyDataCollection: false, requireVision: false, requireToolSupport: false, requireJsonOutput: false, maxCostClass: "expensive", allowedProviders: null, deniedProviders: null },
      contextSignals: { estimatedTokens: 0, requiresVision: false, requiresToolUse: false, requiresJsonOutput: false, requiresReasoning: false },
      approvalPolicy: "blocked",
    });
    assert.equal(result.status, "stop_blocked");
  });

  it("localOnly filters out cloud models", () => {
    const result = resolveModel({
      profile: "code_generation",
      providerConstraints: { localOnly: true, denyDataCollection: false, requireVision: false, requireToolSupport: false, requireJsonOutput: false, maxCostClass: "expensive", allowedProviders: null, deniedProviders: null },
      contextSignals: { estimatedTokens: 0, requiresVision: false, requiresToolUse: false, requiresJsonOutput: false, requiresReasoning: false },
      approvalPolicy: "none",
    });
    if (result.selectedModel) {
      assert.equal(result.selectedModel.providerClass, "local");
    }
  });

  it("denyDataCollection filters training_included", () => {
    resetAllHealth();
    const result = resolveModel({
      profile: "code_generation",
      providerConstraints: { localOnly: false, denyDataCollection: true, requireVision: false, requireToolSupport: false, requireJsonOutput: false, maxCostClass: "expensive", allowedProviders: null, deniedProviders: null },
      contextSignals: { estimatedTokens: 0, requiresVision: false, requiresToolUse: false, requiresJsonOutput: false, requiresReasoning: false },
      approvalPolicy: "none",
    });
    if (result.selectedModel) {
      assert.notEqual(result.selectedModel.dataPolicy, "training_included");
    }
  });

  it("sensitive profiles auto-exclude training_included providers", () => {
    resetAllHealth();
    for (const profile of ["security_sensitive_review", "privacy_sensitive_summary"] as const) {
      const result = resolveModel({
        profile,
        providerConstraints: { localOnly: false, denyDataCollection: false, requireVision: false, requireToolSupport: false, requireJsonOutput: false, maxCostClass: "expensive", allowedProviders: null, deniedProviders: null },
        contextSignals: { estimatedTokens: 0, requiresVision: false, requiresToolUse: false, requiresJsonOutput: false, requiresReasoning: false },
        approvalPolicy: "none",
      });
      if (result.selectedModel) {
        assert.notEqual(result.selectedModel.dataPolicy, "training_included", `${profile} must not resolve to training_included`);
      }
      assert.ok(result.reasonCodes.includes("SENSITIVE_PROFILE_DATA_PROTECTION"), `${profile} must have data protection reason code`);
    }
  });

  it("requireVision filters non-vision models", () => {
    resetAllHealth();
    const result = resolveModel({
      profile: "code_generation",
      providerConstraints: { localOnly: false, denyDataCollection: false, requireVision: true, requireToolSupport: false, requireJsonOutput: false, maxCostClass: "expensive", allowedProviders: null, deniedProviders: null },
      contextSignals: { estimatedTokens: 0, requiresVision: false, requiresToolUse: false, requiresJsonOutput: false, requiresReasoning: false },
      approvalPolicy: "none",
    });
    if (result.selectedModel) {
      assert.equal(result.selectedModel.supportsVision, true);
    }
  });

  it("unhealthy provider excluded", () => {
    resetAllHealth();
    markProviderUnhealthy("anthropic", "429", 60000);
    const result = resolveModel({
      profile: "code_generation",
      providerConstraints: { localOnly: false, denyDataCollection: false, requireVision: false, requireToolSupport: false, requireJsonOutput: false, maxCostClass: "expensive", allowedProviders: null, deniedProviders: null },
      contextSignals: { estimatedTokens: 0, requiresVision: false, requiresToolUse: false, requiresJsonOutput: false, requiresReasoning: false },
      approvalPolicy: "none",
    });
    if (result.selectedModel) {
      assert.notEqual(result.selectedModel.provider, "anthropic");
    }
    resetAllHealth();
  });

  it("context window too small filters model", () => {
    resetAllHealth();
    const result = resolveModel({
      profile: "code_generation",
      providerConstraints: { localOnly: false, denyDataCollection: false, requireVision: false, requireToolSupport: false, requireJsonOutput: false, maxCostClass: "expensive", allowedProviders: null, deniedProviders: null },
      contextSignals: { estimatedTokens: 500000, requiresVision: false, requiresToolUse: false, requiresJsonOutput: false, requiresReasoning: false },
      approvalPolicy: "none",
    });
    if (result.selectedModel) {
      assert.ok(result.selectedModel.contextWindow >= 500000);
    }
  });

  it("prefers cheapest safe candidate", () => {
    resetAllHealth();
    const result = resolveModel({
      profile: "code_generation",
      providerConstraints: { localOnly: false, denyDataCollection: false, requireVision: false, requireToolSupport: false, requireJsonOutput: false, maxCostClass: "expensive", allowedProviders: null, deniedProviders: null },
      contextSignals: { estimatedTokens: 0, requiresVision: false, requiresToolUse: false, requiresJsonOutput: false, requiresReasoning: false },
      approvalPolicy: "none",
    });
    if (result.selectedModel && result.fallbackChain.length > 0) {
      assert.ok(["free", "cheap", "standard"].includes(result.selectedModel.costClass));
    }
  });

  it("no_safe_candidate when impossible constraints", () => {
    resetAllHealth();
    const result = resolveModel({
      profile: "security_sensitive_review",
      providerConstraints: { localOnly: true, denyDataCollection: false, requireVision: true, requireToolSupport: true, requireJsonOutput: false, maxCostClass: "expensive", allowedProviders: null, deniedProviders: null },
      contextSignals: { estimatedTokens: 0, requiresVision: false, requiresToolUse: false, requiresJsonOutput: false, requiresReasoning: false },
      approvalPolicy: "none",
    });
    assert.equal(result.status, "no_safe_candidate");
  });
});

describe("session memory", () => {
  it("creates with none profile", () => {
    const mem = createRouteSession("test-1");
    assert.equal(mem.highWaterProfile, "none");
    assert.equal(mem.escalationHistory.length, 0);
  });

  it("allows upgrade", () => {
    const mem = createRouteSession("test-2");
    const r = requestProfileChange(mem, "code_generation", "code task");
    assert.ok(r.allowed);
    assert.ok(r.wasEscalation);
    assert.equal(mem.highWaterProfile, "code_generation");
  });

  it("blocks downgrade", () => {
    const mem = createRouteSession("test-3");
    requestProfileChange(mem, "security_sensitive_review", "auth touched");
    const r = requestProfileChange(mem, "cheap_classification", "simple task");
    assert.equal(r.allowed, false);
    assert.equal(mem.highWaterProfile, "security_sensitive_review");
    assert.equal(mem.downgradeAttempts, 1);
  });

  it("canDowngrade always false", () => {
    const mem = createRouteSession("test-4");
    assert.equal(canDowngrade(mem), false);
  });

  it("records sensitive surfaces", () => {
    const mem = createRouteSession("test-5");
    recordSensitiveSurface(mem, "auth");
    recordSensitiveSurface(mem, "payment");
    recordSensitiveSurface(mem, "auth");
    assert.equal(mem.sensitiveSurfacesTouched.length, 2);
  });
});

describe("cascade", () => {
  it("builds cascade for deterministic route", () => {
    const frame = baseFrame();
    frame.deterministicEvidenceAvailable = true;
    const pd = routePrimitive(frame);
    const cascade = buildCascade(frame, pd);
    assert.ok(cascade.steps.length >= 1);
    assert.equal(cascade.steps[0].primitive, "deterministic_local_read");
  });

  it("includes scanner step for security-sensitive", () => {
    const frame = baseFrame();
    frame.secretsPossible = true;
    frame.riskClass = "high";
    const pd = routePrimitive(frame);
    const cascade = buildCascade(frame, pd);
    assert.ok(cascade.steps.some(s => s.primitive === "built_in_scanner"));
  });

  it("includes approval step when required", () => {
    const frame = baseFrame();
    frame.externalWriteRequested = true;
    const pd = routePrimitive(frame);
    const cascade = buildCascade(frame, pd);
    assert.ok(cascade.steps.some(s => s.primitive === "human_approval"));
  });

  it("includes stop_blocked for production impact", () => {
    const frame = baseFrame();
    frame.productionImpactPossible = true;
    const pd = routePrimitive(frame);
    const cascade = buildCascade(frame, pd);
    assert.ok(cascade.steps.some(s => s.primitive === "stop_blocked"));
  });
});

describe("verifier", () => {
  it("passes valid projection", () => {
    const frame = baseFrame();
    const pd = routePrimitive(frame);
    resetAllHealth();
    const resolver = resolveModel({
      profile: pd.selectedModelProfile,
      providerConstraints: { localOnly: false, denyDataCollection: false, requireVision: false, requireToolSupport: false, requireJsonOutput: false, maxCostClass: "standard", allowedProviders: null, deniedProviders: null },
      contextSignals: { estimatedTokens: 0, requiresVision: false, requiresToolUse: false, requiresJsonOutput: false, requiresReasoning: false },
      approvalPolicy: "none",
    });
    const cascade = buildCascade(frame, pd);
    const proj = createSafeProjection(pd, resolver, cascade);
    const result = verifyRoutingDecision(frame, pd.selectedModelProfile, resolver, proj);
    assert.ok(result.valid);
  });

  it("catches modelMayDecide=true", () => {
    const frame = baseFrame();
    const pd = routePrimitive(frame);
    resetAllHealth();
    const resolver = resolveModel({
      profile: "none",
      providerConstraints: { localOnly: false, denyDataCollection: false, requireVision: false, requireToolSupport: false, requireJsonOutput: false, maxCostClass: "standard", allowedProviders: null, deniedProviders: null },
      contextSignals: { estimatedTokens: 0, requiresVision: false, requiresToolUse: false, requiresJsonOutput: false, requiresReasoning: false },
      approvalPolicy: "none",
    });
    const cascade = buildCascade(frame, pd);
    const proj = createSafeProjection(pd, resolver, cascade);
    const bad = { ...proj, modelMayDecide: true as any };
    const result = verifyRoutingDecision(frame, pd.selectedModelProfile, resolver, bad);
    assert.ok(result.violations.some(v => v.code === "MODEL_MAY_DECIDE"));
  });

  it("catches training_included for sensitive data", () => {
    const frame = baseFrame();
    frame.dataSensitivity = "high";
    const pd = routePrimitive(frame);
    const fakeModel = {
      modelId: "cloud/gpt-4o",
      displayName: "GPT-4o",
      provider: "openai",
      providerClass: "cloud_standard" as const,
      contextWindow: 128000,
      costClass: "standard" as const,
      latencyClass: "fast" as const,
      supportsVision: true,
      supportsToolUse: true,
      supportsJsonOutput: true,
      supportsReasoning: true,
      dataPolicy: "training_included" as const,
      profiles: ["standard_synthesis" as const],
      enabled: true,
    };
    const resolver = { status: "resolved" as const, selectedModel: fakeModel, fallbackChain: [], reasonCodes: [] };
    const cascade = buildCascade(frame, pd);
    const proj = createSafeProjection(pd, resolver, cascade);
    const result = verifyRoutingDecision(frame, pd.selectedModelProfile, resolver, proj);
    assert.ok(result.violations.some(v => v.code === "TRAINING_DATA_SENSITIVE"));
  });
});

describe("canonical routing (end-to-end)", () => {
  it("routes docs task to no_model_needed", () => {
    const frame = baseFrame();
    frame.taskType = "docs";
    frame.riskClass = "low";
    const result = routeCanonical({ frame, approvalPolicy: "none" });
    assert.equal(result.projection.modelMayDecide, false);
    assert.equal(result.projection.scannerMayDecide, false);
    assert.equal(result.projection.finalDecisionOwner, "kernel/stop-continue-gate");
    assert.equal(result.projection.containsRawPrompt, false);
    assert.equal(result.projection.containsRawSource, false);
    assert.equal(result.projection.containsRawSecret, false);
  });

  it("routes code_generation to resolved model", () => {
    resetAllHealth();
    const frame = baseFrame();
    frame.taskType = "code_generation";
    const result = routeCanonical({
      frame,
      approvalPolicy: "none",
      providerConstraints: { maxCostClass: "expensive" },
    });
    assert.equal(result.projection.selectedModelProfile, "code_generation");
    assert.ok(result.resolverResult.selectedModel);
    assert.ok(result.verifierResult.valid);
  });

  it("routes production impact to stop_blocked", () => {
    const frame = baseFrame();
    frame.productionImpactPossible = true;
    const result = routeCanonical({ frame, approvalPolicy: "none" });
    assert.equal(result.projection.selectedPrimitive, "stop_blocked");
  });

  it("all projections carry safety flags", () => {
    const scenarios = [
      { ...baseFrame(), taskType: "docs", riskClass: "low" as const },
      { ...baseFrame(), taskType: "code_generation" },
      { ...baseFrame(), secretsPossible: true, riskClass: "high" as const },
      { ...baseFrame(), productionImpactPossible: true },
      { ...baseFrame(), deepMode: true },
    ];
    for (const frame of scenarios) {
      const result = routeCanonical({ frame, approvalPolicy: "none" });
      assert.equal(result.projection.modelMayDecide, false, `modelMayDecide for ${frame.taskType}`);
      assert.equal(result.projection.scannerMayDecide, false, `scannerMayDecide for ${frame.taskType}`);
      assert.equal(result.projection.finalDecisionOwner, "kernel/stop-continue-gate");
      assert.equal(result.projection.containsRawPrompt, false);
      assert.equal(result.projection.containsRawSource, false);
      assert.equal(result.projection.containsRawSecret, false);
    }
  });
});
