// Tool Adapter Orchestration Dogfood.
// Proves adapter selection, detection, policies, receipts, and safety gates
// work end-to-end. Local-only, no network, no real tool installations.

import {
  planToolExecution, buildToolRoutingProjection, getEffectiveAvailability,
  getAdapterDescriptors, getDescriptor, resetAllAdapterHealth, markAdapterUnhealthy,
  isAdapterHealthy, classifyTask, defaultPolicyConstraints, isFallbackSafe,
  createToolProofReceipt, createToolExecutionResult, detectAllTools,
} from "../kernel/tool-adapters/index.ts";
import { tmpdir } from "node:os";

type ScenarioResult = {
  scenario: string;
  pass: boolean;
  detail: string;
};

const results: ScenarioResult[] = [];
const NOW = 1718500000000;

function record(scenario: string, pass: boolean, detail: string) {
  results.push({ scenario, pass, detail });
}

function assert(cond: boolean, msg: string) { if (!cond) throw new Error(`ASSERT: ${msg}`); }

// S1: registry has the original adapters plus proof adapters
try {
  const descs = getAdapterDescriptors();
  assert(descs.length === 11, "11 adapters");
  for (const d of descs) {
    assert(typeof d.id === "string", `id for ${d.displayName}`);
    assert(typeof d.localOnly === "boolean", `localOnly for ${d.id}`);
  }
  record("registry_completeness", true, `${descs.length} adapters with complete descriptors`);
} catch (e: any) { record("registry_completeness", false, e.message); }

// S2: detection works locally with no side effects
try {
  resetAllAdapterHealth();
  const all = detectAllTools(tmpdir(), NOW);
  assert(all.length === 11, "11 detections");
  const dl = all.find(t => t.adapterId === "deterministic-local");
  const mg = all.find(t => t.adapterId === "manual-gate");
  assert(dl?.status === "available", "deterministic-local available");
  assert(mg?.status === "available", "manual-gate available");
  record("local_detection", true, `detected ${all.length} adapters, always-available ones confirmed`);
} catch (e: any) { record("local_detection", false, e.message); }

// S3: low_risk_code task selects an adapter
try {
  resetAllAdapterHealth();
  const plan = planToolExecution({
    taskType: "code_generation", riskClass: "low",
    paymentTouched: false, authTouched: false,
    productionImpactPossible: false, deterministicEvidenceAvailable: false,
    deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
  });
  assert(!!plan.selectedAdapter, "adapter selected");
  assert(plan.modelMayDecide === false, "model cannot decide");
  assert(plan.finalDecisionOwner === "kernel/stop-continue-gate", "kernel owns decision");
  record("low_risk_code_planning", true, `selected=${plan.selectedAdapter} mode=${plan.executionMode}`);
} catch (e: any) { record("low_risk_code_planning", false, e.message); }

// S4: production_deploy → manual-gate only
try {
  resetAllAdapterHealth();
  const plan = planToolExecution({
    taskType: "deploy", riskClass: "high",
    paymentTouched: false, authTouched: false,
    productionImpactPossible: true, deterministicEvidenceAvailable: false,
    deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
  });
  assert(plan.selectedAdapter === "manual-gate", `expected manual-gate, got ${plan.selectedAdapter}`);
  assert(plan.approvalRequired === true, "approval required");
  assert(plan.toolMayExecute === false, "tool cannot execute");
  assert(plan.forbiddenActions.includes("tool_approves_deploy"), "forbidden action present");
  record("production_deploy_gate", true, "manual-gate enforced for production");
} catch (e: any) { record("production_deploy_gate", false, e.message); }

// S5: billing/payment → elevated proof
try {
  resetAllAdapterHealth();
  const plan = planToolExecution({
    taskType: "code_generation", riskClass: "high",
    paymentTouched: true, authTouched: false,
    productionImpactPossible: false, deterministicEvidenceAvailable: false,
    deepMode: false, secretsPossible: true, dir: tmpdir(), now: NOW,
  });
  assert(plan.approvalRequired === true, "approval required for billing");
  assert(plan.proofRequired === true, "proof required for billing");
  assert(plan.modelMayDecide === false, "model cannot decide billing");
  record("billing_payment_proof", true, `selected=${plan.selectedAdapter} approval=${plan.approvalRequired}`);
} catch (e: any) { record("billing_payment_proof", false, e.message); }

// S6: security/auth → scanner or manual-gate
try {
  resetAllAdapterHealth();
  const plan = planToolExecution({
    taskType: "code_generation", riskClass: "high",
    paymentTouched: false, authTouched: true,
    productionImpactPossible: false, deterministicEvidenceAvailable: false,
    deepMode: false, secretsPossible: true, dir: tmpdir(), now: NOW,
  });
  assert(plan.selectedAdapter === "semgrep" || plan.selectedAdapter === "scanner" || plan.selectedAdapter === "manual-gate",
    `expected semgrep/scanner/manual-gate, got ${plan.selectedAdapter}`);
  assert(plan.forbiddenActions.includes("persist_raw_secret"), "secrets forbidden");
  record("security_auth_gate", true, `selected=${plan.selectedAdapter}`);
} catch (e: any) { record("security_auth_gate", false, e.message); }

// S7: unhealthy adapter skipped
try {
  resetAllAdapterHealth();
  markAdapterUnhealthy("claude-code", "timeout", 600000, NOW);
  assert(!isAdapterHealthy("claude-code", NOW), "claude-code must be unhealthy");
  const plan = planToolExecution({
    taskType: "code_generation", riskClass: "low",
    paymentTouched: false, authTouched: false,
    productionImpactPossible: false, deterministicEvidenceAvailable: false,
    deepMode: false, secretsPossible: false, dir: tmpdir(), now: NOW,
  });
  assert(plan.selectedAdapter !== "claude-code", "unhealthy adapter skipped");
  resetAllAdapterHealth();
  record("unhealthy_adapter_skip", true, `unhealthy claude-code skipped, selected=${plan.selectedAdapter}`);
} catch (e: any) { resetAllAdapterHealth(); record("unhealthy_adapter_skip", false, e.message); }

// S8: fallback cannot lower privacy
try {
  const safe = isFallbackSafe(
    { dataPolicy: "local_only", riskCeiling: "low" },
    { dataPolicy: "training_included", riskCeiling: "low" },
    defaultPolicyConstraints(),
  );
  assert(safe === false, "privacy-lowering fallback must be blocked");
  record("fallback_privacy_guard", true, "blocked local_only→training_included fallback");
} catch (e: any) { record("fallback_privacy_guard", false, e.message); }

// S9: proof receipt has no raw content
try {
  const receipt = createToolProofReceipt("deterministic-local", "deterministic", "executed", ["CHECK"], NOW);
  assert(receipt.contract === "avorelo.toolProofReceipt.v1", "contract version");
  assert(receipt.containsRawPrompt === false, "no raw prompt");
  assert(receipt.containsRawSource === false, "no raw source");
  assert(receipt.containsRawSecret === false, "no raw secret");
  assert(receipt.containsRawOutput === false, "no raw output");
  assert(receipt.modelMayDecide === false, "model cannot decide");
  record("proof_receipt_safety", true, `receipt=${receipt.receiptId} clean`);
} catch (e: any) { record("proof_receipt_safety", false, e.message); }

// S10: task classification correctness
try {
  const f = (tt: string, rc: string, flags: any) => classifyTask(tt, rc, flags);
  const base = { paymentTouched: false, authTouched: false, productionImpactPossible: false, deterministicEvidenceAvailable: false, deepMode: false };
  assert(f("deploy", "high", { ...base, productionImpactPossible: true }) === "production_deploy", "deploy");
  assert(f("code", "high", { ...base, paymentTouched: true }) === "billing_payment", "billing");
  assert(f("code", "high", { ...base, authTouched: true }) === "security_review", "security");
  assert(f("docs", "low", { ...base, deterministicEvidenceAvailable: true }) === "deterministic_check", "deterministic");
  record("task_classification", true, "all task classes map correctly");
} catch (e: any) { record("task_classification", false, e.message); }

// Summary
const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;

console.log("\n=== Tool Adapter Orchestration Dogfood ===\n");
for (const r of results) {
  console.log(`${r.pass ? "✓" : "✗"} ${r.scenario}: ${r.detail}`);
}
console.log(`\n${passed} passed, ${failed} failed of ${results.length} scenarios`);

if (failed > 0) {
  console.error("\nFAILED scenarios:");
  for (const r of results.filter(r => !r.pass)) console.error(`  ✗ ${r.scenario}: ${r.detail}`);
  process.exit(1);
}
