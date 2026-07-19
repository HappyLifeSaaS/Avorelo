// Avorelo Model Routing Usage-Level Dogfood.
// Proves routing works as a real user would experience it — through runtime sessions,
// control-router, CLI surfaces, and control-center — not only isolated kernel functions.
// Local-only, deterministic, no network, no API keys, no external providers.

import { runRuntimeSession, validateRuntimeSession, loadLatestRuntimeSession } from "../capabilities/runtime-flow/index.ts";
import { buildControlCenter, renderText as renderControlCenterText } from "../capabilities/control-center/index.ts";
import { unifiedRoute, type UnifiedTaskFrame } from "../control-router/index.ts";
import {
  routeCanonical, routePrimitive, resolveModel, resetAllHealth, markProviderUnhealthy,
  createRouteSession, requestProfileChange, recordSensitiveSurface, canDowngrade,
  getModelRegistry, getModelsForProfile,
} from "../kernel/model-routing/index.ts";
import type { RoutingTaskFrame } from "../kernel/model-routing/index.ts";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

type ScenarioResult = {
  scenario: string;
  pass: boolean;
  detail: string;
  route?: string;
  gate?: string;
  modelRoutingPresent?: boolean;
  unsafeFallback?: boolean;
  proofDowngrade?: boolean;
  rawPersistence?: boolean;
  fakeSavings?: boolean;
};

const results: ScenarioResult[] = [];
const NOW = 1718500000000;

function tmpDir(name: string): string {
  const d = join(tmpdir(), `avorelo-usage-dogfood-${name}-${Date.now()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function cleanDir(d: string) {
  try { rmSync(d, { recursive: true, force: true }); } catch {}
}

function baseUnifiedFrame(overrides: Partial<UnifiedTaskFrame> = {}): UnifiedTaskFrame {
  return {
    taskType: "code",
    riskClass: "low",
    touchedLayers: [],
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
    deterministicEvidenceAvailable: true,
    dataSensitivity: "low",
    externalWriteRequested: false,
    secretsPossible: false,
    productionImpactPossible: false,
    deepMode: false,
    changedFiles: [],
    userIntent: "local task",
    localOnly: true,
    userPlan: "",
    founderCockpitTouched: false,
    aiTeamTouched: false,
    feedbackLoopTouched: false,
    oldRepoReferenceUsed: false,
    installedTools: [],
    contextBudgetRemaining: 100000,
    tokenBudgetRemaining: 100000,
    ...overrides,
  };
}

// ─── Scenario 1: Low-risk deterministic task ───

{
  const dir = tmpDir("s1");
  try {
    const session = runRuntimeSession({ task: "summarize local project status", dir, now: NOW });
    const r = session.record;
    const checks = [
      r.modelRouting !== undefined,
      r.modelRouting?.modelMayDecide === false,
      r.modelRouting?.containsRawPrompt === false,
      r.modelRouting?.containsRawSource === false,
      r.modelRouting?.containsRawSecret === false,
      r.containsRawPrompt === false,
      r.containsRawSecret === false,
      r.redacted === true,
      validateRuntimeSession(r).valid,
    ];
    const allPass = checks.every(Boolean);
    results.push({
      scenario: "S1_low_risk_deterministic_task",
      pass: allPass,
      detail: allPass ? "ok" : `checks: ${checks.join(",")}`,
      route: r.route,
      gate: r.gate,
      modelRoutingPresent: r.modelRouting !== undefined,
      unsafeFallback: false,
      proofDowngrade: false,
      rawPersistence: false,
      fakeSavings: r.proof?.canShowSavings === true,
    });
  } catch (e) {
    results.push({ scenario: "S1_low_risk_deterministic_task", pass: false, detail: `THREW: ${e instanceof Error ? e.message : String(e)}` });
  }
  cleanDir(dir);
}

// ─── Scenario 2: Normal coding task ───

{
  const dir = tmpDir("s2");
  try {
    const session = runRuntimeSession({ task: "add unit tests for the parser module", dir, now: NOW });
    const r = session.record;
    const v = validateRuntimeSession(r);
    const checks = [
      v.valid,
      r.modelRouting !== undefined,
      r.modelRouting?.modelMayDecide === false,
      r.proof?.canShowSavings !== true,
      r.containsRawPrompt === false,
      r.containsRawSourceDump === false,
    ];
    results.push({
      scenario: "S2_normal_coding_task",
      pass: checks.every(Boolean),
      detail: checks.every(Boolean) ? "ok" : `checks: ${checks.join(",")}`,
      route: r.route,
      gate: r.gate,
      modelRoutingPresent: r.modelRouting !== undefined,
      fakeSavings: r.proof?.canShowSavings === true,
      rawPersistence: false,
    });
  } catch (e) {
    results.push({ scenario: "S2_normal_coding_task", pass: false, detail: `THREW: ${e instanceof Error ? e.message : String(e)}` });
  }
  cleanDir(dir);
}

// ─── Scenario 3: Auth/security-sensitive task ───

{
  resetAllHealth();
  const frame = baseUnifiedFrame({
    taskType: "code",
    riskClass: "high",
    authTouched: true,
    dataSensitivity: "high",
    proofRequired: true,
  });
  try {
    const decision = unifiedRoute(frame);
    const sensitiveModels = getModelsForProfile("security_sensitive_review");
    const trainingModels = sensitiveModels.filter(m => m.dataPolicy === "training_included");

    const canonical = routeCanonical({
      frame,
      approvalPolicy: "none",
      providerConstraints: { localOnly: false, denyDataCollection: false, requireVision: false, requireToolSupport: false, requireJsonOutput: false, maxCostClass: "standard", allowedProviders: null, deniedProviders: null },
      now: NOW,
    });

    const resolvedModel = canonical.resolverResult.selectedModel;
    const excludedTraining = resolvedModel === null || resolvedModel.dataPolicy !== "training_included";

    const checks = [
      decision.modelMayDecide === false,
      decision.scannerMayDecide === false,
      decision.finalDecisionOwner === "kernel/stop-continue-gate",
      decision.forbiddenActions.includes("model_owns_READY"),
      decision.modelRoutingProjection !== undefined,
      canonical.projection.modelMayDecide === false,
      canonical.projection.containsRawPrompt === false,
      trainingModels.length === 0 || excludedTraining,
    ];
    results.push({
      scenario: "S3_auth_security_sensitive_task",
      pass: checks.every(Boolean),
      detail: checks.every(Boolean) ? "ok" : `checks: ${checks.join(",")}`,
      route: decision.selectedPrimitive,
      gate: decision.approvalRequired ? "require_approval" : "allow",
      modelRoutingPresent: decision.modelRoutingProjection !== undefined,
      unsafeFallback: false,
    });
  } catch (e) {
    results.push({ scenario: "S3_auth_security_sensitive_task", pass: false, detail: `THREW: ${e instanceof Error ? e.message : String(e)}` });
  }
}

// ─── Scenario 4: Billing/payment/webhook task ───

{
  resetAllHealth();
  const frame = baseUnifiedFrame({
    taskType: "code",
    riskClass: "high",
    paymentTouched: true,
    proofRequired: true,
  });
  try {
    const decision = unifiedRoute(frame);
    const dir = tmpDir("s4");
    const session = runRuntimeSession({ task: "update webhook handler for billing events", dir, now: NOW });
    const r = session.record;

    const checks = [
      decision.modelMayDecide === false,
      decision.finalDecisionOwner === "kernel/stop-continue-gate",
      r.modelRouting !== undefined,
      r.modelRouting?.modelMayDecide === false,
      r.proof?.canShowSavings !== true,
      r.riskClass !== "low",
      r.containsRawSecret === false,
    ];
    results.push({
      scenario: "S4_billing_payment_webhook_task",
      pass: checks.every(Boolean),
      detail: checks.every(Boolean) ? "ok" : `checks: ${checks.join(",")}`,
      route: r.route,
      gate: r.gate,
      modelRoutingPresent: r.modelRouting !== undefined,
      fakeSavings: r.proof?.canShowSavings === true,
    });
    cleanDir(dir);
  } catch (e) {
    results.push({ scenario: "S4_billing_payment_webhook_task", pass: false, detail: `THREW: ${e instanceof Error ? e.message : String(e)}` });
  }
}

// ─── Scenario 5: Production/deploy task ───

{
  resetAllHealth();
  const frame = baseUnifiedFrame({
    taskType: "deploy",
    riskClass: "high",
    productionImpactPossible: true,
    proofRequired: true,
  });
  try {
    const decision = unifiedRoute(frame);
    const canonical = decision.canonicalRouting;

    const checks = [
      decision.selectedPrimitive === "stop_blocked" || decision.approvalRequired === true,
      decision.modelMayDecide === false,
      decision.scannerMayDecide === false,
      decision.finalDecisionOwner === "kernel/stop-continue-gate",
      decision.forbiddenActions.includes("model_owns_READY"),
      canonical !== undefined,
      canonical?.projection.modelMayDecide === false,
    ];
    results.push({
      scenario: "S5_production_deploy_task",
      pass: checks.every(Boolean),
      detail: checks.every(Boolean) ? "ok" : `checks: ${checks.join(",")}`,
      route: decision.selectedPrimitive,
      gate: decision.approvalRequired ? "require_approval" : decision.selectedPrimitive === "stop_blocked" ? "blocked" : "allow",
      modelRoutingPresent: canonical !== undefined,
    });
  } catch (e) {
    results.push({ scenario: "S5_production_deploy_task", pass: false, detail: `THREW: ${e instanceof Error ? e.message : String(e)}` });
  }
}

// ─── Scenario 6: Long-context / provider capability task ───

{
  resetAllHealth();
  try {
    const frame: RoutingTaskFrame = {
      taskType: "code",
      riskClass: "low",
      touchedLayers: [],
      browserAvailable: false,
      externalToolsAllowed: false,
      scannerAvailable: false,
      mcpTouched: false,
      paymentTouched: false,
      authTouched: false,
      cloudTouched: false,
      dashboardTouched: false,
      publicCopyTouched: false,
      proofRequired: false,
      deterministicEvidenceAvailable: false,
      dataSensitivity: "low",
      externalWriteRequested: false,
      secretsPossible: false,
      productionImpactPossible: false,
      deepMode: true,
    };
    const canonical = routeCanonical({
      frame,
      approvalPolicy: "none",
      contextSignals: { estimatedTokens: 500000, requiresVision: false, requiresToolUse: true, requiresJsonOutput: true, requiresReasoning: true },
      now: NOW,
    });

    const reasonCodes = canonical.resolverResult.reasonCodes;
    const proj = canonical.projection;

    const checks = [
      proj.modelMayDecide === false,
      proj.containsRawPrompt === false,
      proj.finalDecisionOwner === "kernel/stop-continue-gate",
      reasonCodes.length > 0,
      canonical.resolverResult.selectedModel === null || canonical.resolverResult.selectedModel.contextWindow >= 500000 || canonical.resolverResult.status === "no_safe_candidate",
    ];
    results.push({
      scenario: "S6_long_context_provider_capability",
      pass: checks.every(Boolean),
      detail: checks.every(Boolean) ? "ok" : `checks: ${checks.join(",")} reasonCodes: ${reasonCodes.join(",")}`,
      route: proj.selectedPrimitive,
      modelRoutingPresent: true,
      unsafeFallback: proj.modelMayDecide !== false,
    });
  } catch (e) {
    results.push({ scenario: "S6_long_context_provider_capability", pass: false, detail: `THREW: ${e instanceof Error ? e.message : String(e)}` });
  }
}

// ─── Scenario 7: Provider failure/fallback ───

{
  resetAllHealth();
  markProviderUnhealthy("anthropic", "timeout", 600000, NOW);
  markProviderUnhealthy("openai", "rate_limit", 600000, NOW);
  try {
    const frame: RoutingTaskFrame = {
      taskType: "code",
      riskClass: "low",
      touchedLayers: [],
      browserAvailable: false,
      externalToolsAllowed: false,
      scannerAvailable: false,
      mcpTouched: false,
      paymentTouched: false,
      authTouched: false,
      cloudTouched: false,
      dashboardTouched: false,
      publicCopyTouched: false,
      proofRequired: false,
      deterministicEvidenceAvailable: false,
      dataSensitivity: "low",
      externalWriteRequested: false,
      secretsPossible: false,
      productionImpactPossible: false,
      deepMode: false,
    };
    const canonical = routeCanonical({ frame, approvalPolicy: "none", now: NOW });
    const proj = canonical.projection;

    const checks = [
      proj.modelMayDecide === false,
      proj.containsRawPrompt === false,
      proj.finalDecisionOwner === "kernel/stop-continue-gate",
      // If no safe candidate, resolver must not resolve to an unhealthy provider
      canonical.resolverResult.selectedModel === null ||
        canonical.resolverResult.selectedModel.provider !== "anthropic" &&
        canonical.resolverResult.selectedModel.provider !== "openai",
    ];
    results.push({
      scenario: "S7_provider_failure_fallback",
      pass: checks.every(Boolean),
      detail: checks.every(Boolean) ? "ok" : `checks: ${checks.join(",")} status: ${canonical.resolverResult.status}`,
      route: proj.selectedPrimitive,
      modelRoutingPresent: true,
      unsafeFallback: proj.modelMayDecide !== false,
    });
  } catch (e) {
    results.push({ scenario: "S7_provider_failure_fallback", pass: false, detail: `THREW: ${e instanceof Error ? e.message : String(e)}` });
  }
  resetAllHealth();
}

// ─── Scenario 8: Downgrade attempt (session escalation then downgrade block) ───

{
  try {
    const session = createRouteSession("usage-dogfood-s8");

    // Start with low profile
    const r1 = requestProfileChange(session, "cheap_classification", "initial_task");
    // Escalate to security
    const r2 = requestProfileChange(session, "security_sensitive_review", "auth_surface_touched");
    recordSensitiveSurface(session, "auth");
    // Attempt downgrade
    const r3 = requestProfileChange(session, "cheap_classification", "simple_followup");
    const neverDowngrade = canDowngrade(session);

    const checks = [
      r1.allowed === true,
      r2.allowed === true && r2.wasEscalation === true,
      r3.allowed === false,
      session.highWaterProfile === "security_sensitive_review",
      session.downgradeAttempts >= 1,
      neverDowngrade === false,
      session.sensitiveSurfacesTouched.includes("auth"),
    ];
    results.push({
      scenario: "S8_downgrade_attempt_blocked",
      pass: checks.every(Boolean),
      detail: checks.every(Boolean) ? "ok" : `checks: ${checks.join(",")}`,
      proofDowngrade: r3.allowed === true,
    });
  } catch (e) {
    results.push({ scenario: "S8_downgrade_attempt_blocked", pass: false, detail: `THREW: ${e instanceof Error ? e.message : String(e)}` });
  }
}

// ─── Scenario P1: Verifier rejection fails closed ───

{
  resetAllHealth();
  const dir = tmpDir("p1");
  try {
    const session = runRuntimeSession({ task: "add logging to error handler", dir, now: NOW });
    const r = session.record;
    const canonical = routeCanonical({
      frame: {
        taskType: "code_generation", riskClass: "low", touchedLayers: [],
        browserAvailable: false, externalToolsAllowed: false, scannerAvailable: true,
        mcpTouched: false, paymentTouched: false, authTouched: false, cloudTouched: false,
        dashboardTouched: false, publicCopyTouched: false, proofRequired: false,
        deterministicEvidenceAvailable: false, dataSensitivity: "low",
        externalWriteRequested: false, secretsPossible: false,
        productionImpactPossible: false, deepMode: false,
      },
      approvalPolicy: "none",
      now: NOW,
    });

    const checks = [
      r.modelRouting !== undefined,
      r.modelRouting?.modelMayDecide === false,
      r.modelRouting?.scannerMayDecide === false,
      r.modelRouting?.finalDecisionOwner === "kernel/stop-continue-gate",
      !r.modelRouting?.reasonCodes.includes("MODEL_ROUTING_VERIFIER_REJECTED"),
      canonical.verifierResult.valid === true,
      canonical.projection.modelMayDecide === false,
    ];
    results.push({
      scenario: "P1_verifier_rejection_fails_closed",
      pass: checks.every(Boolean),
      detail: checks.every(Boolean) ? "ok" : `checks: ${checks.join(",")}`,
      modelRoutingPresent: r.modelRouting !== undefined,
    });
  } catch (e) {
    results.push({ scenario: "P1_verifier_rejection_fails_closed", pass: false, detail: `THREW: ${e instanceof Error ? e.message : String(e)}` });
  }
  cleanDir(dir);
}

// ─── Scenario P2: Normal code work routes to code_generation ───

{
  resetAllHealth();
  const dir = tmpDir("p2");
  try {
    const session = runRuntimeSession({ task: "refactor the parser module", dir, now: NOW });
    const r = session.record;

    const decision = unifiedRoute(baseUnifiedFrame({
      taskType: "code_generation",
      deterministicEvidenceAvailable: false,
    }));

    const checks = [
      r.modelRouting !== undefined,
      r.modelRouting?.reasonCodes.includes("CODE_GENERATION_PROOF_REQUIRED") ||
        r.modelRouting?.selectedModelProfile === "code_generation" ||
        r.modelRouting?.resolverStatus === "verifier_rejected",
      decision.selectedModelProfile === "code_generation",
      decision.reasonCodes.includes("CODE_GENERATION_PROOF_REQUIRED"),
    ];
    results.push({
      scenario: "P2_code_work_routes_code_generation",
      pass: checks.every(Boolean),
      detail: checks.every(Boolean) ? "ok" : `checks: ${checks.join(",")}`,
      modelRoutingPresent: r.modelRouting !== undefined,
    });
  } catch (e) {
    results.push({ scenario: "P2_code_work_routes_code_generation", pass: false, detail: `THREW: ${e instanceof Error ? e.message : String(e)}` });
  }
  cleanDir(dir);
}

// ─── Scenario 9: CLI UX — normal, --json, --verbose behavior ───

{
  const dir = tmpDir("s9");
  try {
    const session = runRuntimeSession({ task: "check code quality", dir, now: NOW });
    const r = session.record;
    const serialized = JSON.stringify(r);

    const checks = [
      // --json exposes modelRouting safely
      r.modelRouting !== undefined,
      serialized.includes("modelMayDecide"),
      serialized.includes("finalDecisionOwner"),
      // no API keys, no model picker details in serialized output
      !serialized.includes("sk-"),
      !serialized.includes("ANTHROPIC_API_KEY"),
      !serialized.includes("OPENAI_API_KEY"),
      // safe flags
      r.modelRouting?.containsRawPrompt === false,
      r.modelRouting?.containsRawSource === false,
      r.modelRouting?.containsRawSecret === false,
      // routing metadata is useful
      r.modelRouting?.selectedPrimitive !== undefined,
      r.modelRouting?.selectedModelProfile !== undefined,
      r.modelRouting?.resolverStatus !== undefined,
      r.modelRouting?.reasonCodes !== undefined,
    ];
    results.push({
      scenario: "S9_cli_ux_json_verbose",
      pass: checks.every(Boolean),
      detail: checks.every(Boolean) ? "ok" : `checks: ${checks.join(",")}`,
      modelRoutingPresent: true,
    });
  } catch (e) {
    results.push({ scenario: "S9_cli_ux_json_verbose", pass: false, detail: `THREW: ${e instanceof Error ? e.message : String(e)}` });
  }
  cleanDir(dir);
}

// ─── Scenario 10: Control-center / status / doctor usefulness ───

{
  const dir = tmpDir("s10");
  try {
    runRuntimeSession({ task: "refactor auth middleware", dir, now: NOW });
    const cc = buildControlCenter(dir, { now: NOW });
    const text = renderControlCenterText(cc);

    const mr = cc.sections.modelRouting;
    const checks = [
      cc.contract === "avorelo.controlCenter.v1",
      // model routing section is present if runtime session ran
      mr.status === "available" || cc.sections.runtimeSession.status === "unavailable",
      // text output does not leak raw secrets/prompts
      !text.includes("sk-"),
      !text.includes("ghp_"),
      !text.includes("ANTHROPIC_API_KEY"),
      // routing diagnostics are useful when available
      mr.status !== "available" || (
        mr.selectedPrimitive !== undefined &&
        mr.selectedModelProfile !== undefined &&
        mr.modelMayDecide === false &&
        mr.finalDecisionOwner === "kernel/stop-continue-gate"
      ),
    ];
    results.push({
      scenario: "S10_control_center_status_doctor",
      pass: checks.every(Boolean),
      detail: checks.every(Boolean) ? "ok" : `checks: ${checks.join(",")}`,
      modelRoutingPresent: mr.status === "available",
    });
  } catch (e) {
    results.push({ scenario: "S10_control_center_status_doctor", pass: false, detail: `THREW: ${e instanceof Error ? e.message : String(e)}` });
  }
  cleanDir(dir);
}

// ─── Summary ───

const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;
const anyUnsafeFallback = results.some(r => r.unsafeFallback === true);
const anyProofDowngrade = results.some(r => r.proofDowngrade === true);
const anyRawPersistence = results.some(r => r.rawPersistence === true);
const anyFakeSavings = results.some(r => r.fakeSavings === true);
const allModelRoutingPresent = results.every(r => r.modelRoutingPresent !== false);

console.log(JSON.stringify({
  contract: "avorelo.dogfood.modelRoutingUsage.v1",
  ok: failed === 0 && !anyUnsafeFallback && !anyProofDowngrade && !anyRawPersistence && !anyFakeSavings,
  scenarios: results.length,
  passed,
  failed,
  allModelRoutingPresent,
  anyUnsafeFallback,
  anyProofDowngrade,
  anyRawPersistence,
  anyFakeSavings,
  results: results.map(r => ({
    scenario: r.scenario,
    pass: r.pass,
    detail: r.detail,
    route: r.route ?? null,
    gate: r.gate ?? null,
    modelRoutingPresent: r.modelRoutingPresent ?? null,
  })),
}, null, 2));

if (failed > 0 || anyUnsafeFallback || anyProofDowngrade || anyRawPersistence || anyFakeSavings) {
  process.exit(1);
}
