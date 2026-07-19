// Avorelo Kernel Model Routing Dogfood. Proves canonical routing correctness and safety invariants.

import {
  routeCanonical,
  getModelRegistry,
  getModelsForProfile,
  getLocalModels,
  resolveModel,
  createRouteSession,
  requestProfileChange,
  canDowngrade,
  markProviderUnhealthy,
  resetAllHealth,
  routePrimitive,
  buildCascade,
  verifyRoutingDecision,
  createSafeProjection,
} from "../kernel/model-routing/index.ts";

const failures: string[] = [];

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

function check(name: string, test: () => boolean, desc: string) {
  try {
    if (!test()) failures.push(`${name}: ${desc}`);
  } catch (e) {
    failures.push(`${name}: THREW ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Registry
check("K1_registry_nonempty", () => getModelRegistry().length > 0, "registry should have models");
check("K2_local_models", () => getLocalModels().length > 0, "should have local models");
check("K3_code_gen_models", () => getModelsForProfile("code_generation").length > 0, "should have code_generation models");

// Resolver
resetAllHealth();
check("K4_no_model_resolve", () => {
  const r = resolveModel({ profile: "none", providerConstraints: { localOnly: false, denyDataCollection: false, requireVision: false, requireToolSupport: false, requireJsonOutput: false, maxCostClass: "standard", allowedProviders: null, deniedProviders: null }, contextSignals: { estimatedTokens: 0, requiresVision: false, requiresToolUse: false, requiresJsonOutput: false, requiresReasoning: false }, approvalPolicy: "none" });
  return r.status === "no_model_needed" && r.selectedModel === null;
}, "none profile should resolve to no_model_needed");

check("K5_blocked_resolve", () => {
  const r = resolveModel({ profile: "code_generation", providerConstraints: { localOnly: false, denyDataCollection: false, requireVision: false, requireToolSupport: false, requireJsonOutput: false, maxCostClass: "expensive", allowedProviders: null, deniedProviders: null }, contextSignals: { estimatedTokens: 0, requiresVision: false, requiresToolUse: false, requiresJsonOutput: false, requiresReasoning: false }, approvalPolicy: "blocked" });
  return r.status === "stop_blocked";
}, "blocked policy should stop");

check("K6_local_only_filter", () => {
  const r = resolveModel({ profile: "code_generation", providerConstraints: { localOnly: true, denyDataCollection: false, requireVision: false, requireToolSupport: false, requireJsonOutput: false, maxCostClass: "expensive", allowedProviders: null, deniedProviders: null }, contextSignals: { estimatedTokens: 0, requiresVision: false, requiresToolUse: false, requiresJsonOutput: false, requiresReasoning: false }, approvalPolicy: "none" });
  return r.selectedModel === null || r.selectedModel.providerClass === "local";
}, "local-only should filter cloud");

check("K7_deny_training", () => {
  const r = resolveModel({ profile: "code_generation", providerConstraints: { localOnly: false, denyDataCollection: true, requireVision: false, requireToolSupport: false, requireJsonOutput: false, maxCostClass: "expensive", allowedProviders: null, deniedProviders: null }, contextSignals: { estimatedTokens: 0, requiresVision: false, requiresToolUse: false, requiresJsonOutput: false, requiresReasoning: false }, approvalPolicy: "none" });
  return r.selectedModel === null || r.selectedModel.dataPolicy !== "training_included";
}, "deny data collection should filter training_included");

check("K8_unhealthy_excluded", () => {
  resetAllHealth();
  markProviderUnhealthy("anthropic", "429", 60000);
  markProviderUnhealthy("openai", "500", 60000);
  const r = resolveModel({ profile: "code_generation", providerConstraints: { localOnly: false, denyDataCollection: false, requireVision: false, requireToolSupport: false, requireJsonOutput: false, maxCostClass: "expensive", allowedProviders: null, deniedProviders: null }, contextSignals: { estimatedTokens: 0, requiresVision: false, requiresToolUse: false, requiresJsonOutput: false, requiresReasoning: false }, approvalPolicy: "none" });
  const ok = r.selectedModel === null || (r.selectedModel.provider !== "anthropic" && r.selectedModel.provider !== "openai");
  resetAllHealth();
  return ok;
}, "unhealthy providers excluded");

// Session memory
check("K9_upgrade_only", () => {
  const mem = createRouteSession("df-1");
  requestProfileChange(mem, "security_sensitive_review", "auth");
  const r = requestProfileChange(mem, "cheap_classification", "simple");
  return !r.allowed && mem.highWaterProfile === "security_sensitive_review";
}, "downgrade blocked after security escalation");

check("K10_can_downgrade_false", () => {
  return canDowngrade(createRouteSession("df-2")) === false;
}, "canDowngrade always false");

// Canonical routing end-to-end
check("K11_docs_deterministic", () => {
  const r = routeCanonical({ frame: { ...baseFrame(), taskType: "docs", riskClass: "low" as const }, approvalPolicy: "none" });
  return r.projection.selectedPrimitive === "no_action" && r.projection.selectedModelProfile === "none" && r.projection.modelMayDecide === false;
}, "docs should be deterministic no_action");

check("K12_production_blocked", () => {
  const r = routeCanonical({ frame: { ...baseFrame(), productionImpactPossible: true }, approvalPolicy: "none" });
  return r.projection.selectedPrimitive === "stop_blocked";
}, "production impact should block");

check("K13_security_scanner", () => {
  const r = routeCanonical({ frame: { ...baseFrame(), secretsPossible: true, riskClass: "high" as const }, approvalPolicy: "none" });
  return r.primitiveDecision.selectedScanners.length > 0 && r.projection.forbiddenActions.includes("model_owns_READY");
}, "security-sensitive should use scanners and forbid model_owns_READY");

check("K14_safety_flags", () => {
  const scenarios = [
    { ...baseFrame(), taskType: "docs" },
    { ...baseFrame(), taskType: "code_generation" },
    { ...baseFrame(), secretsPossible: true, riskClass: "high" as const },
    { ...baseFrame(), deepMode: true },
  ];
  return scenarios.every(f => {
    const r = routeCanonical({ frame: f, approvalPolicy: "none" });
    return r.projection.modelMayDecide === false && r.projection.scannerMayDecide === false && r.projection.finalDecisionOwner === "kernel/stop-continue-gate" && r.projection.containsRawPrompt === false && r.projection.containsRawSource === false && r.projection.containsRawSecret === false;
  });
}, "all routes carry correct safety flags");

check("K15_verifier_valid", () => {
  resetAllHealth();
  const frame = baseFrame();
  const r = routeCanonical({ frame, approvalPolicy: "none" });
  return r.verifierResult.valid;
}, "verifier passes for clean route");

check("K16_external_write_approval", () => {
  const r = routeCanonical({ frame: { ...baseFrame(), externalWriteRequested: true }, approvalPolicy: "none" });
  return r.primitiveDecision.approvalRequired === true;
}, "external write requires approval");

check("K17_deep_mode_scanners", () => {
  const r = routeCanonical({ frame: { ...baseFrame(), deepMode: true }, approvalPolicy: "none" });
  return r.primitiveDecision.selectedScanners.length >= 3 && r.primitiveDecision.selectedModelProfile !== "none";
}, "deep mode selects scanners and model");

check("K18_cascade_deterministic_first", () => {
  const frame = baseFrame();
  const pd = routePrimitive(frame);
  const cascade = buildCascade(frame, pd);
  return cascade.steps[0].primitive === "deterministic_local_read" && cascade.steps[0].reason === "local_evidence_first";
}, "cascade always starts with local evidence");

check("K19_forbidden_persist_raw", () => {
  const r = routeCanonical({ frame: baseFrame(), approvalPolicy: "none" });
  return r.projection.forbiddenActions.includes("persist_raw_prompt") && r.projection.forbiddenActions.includes("persist_raw_source") && r.projection.forbiddenActions.includes("persist_raw_secret");
}, "all routes forbid raw persistence");

check("K20_no_fake_savings", () => {
  const r = routeCanonical({ frame: baseFrame(), approvalPolicy: "none" });
  return r.projection.forbiddenActions.includes("claim_savings_without_evidence");
}, "all routes forbid fake savings");

const total = 20;
const out = { ok: failures.length === 0, scenarios: total, passed: total - failures.length, failures };
process.stdout.write("AVORELO KERNEL MODEL ROUTING DOGFOOD\n" + JSON.stringify(out, null, 2) + "\n");
process.exit(failures.length === 0 ? 0 : 1);
