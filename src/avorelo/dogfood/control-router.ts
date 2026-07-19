// Avorelo Unified Control Router Dogfood. 25 scenarios.
import { unifiedRoute, type UnifiedTaskFrame } from "../control-router/index.ts";

const failures: string[] = [];
const base: UnifiedTaskFrame = { taskType: "code", riskClass: "low", touchedLayers: [], browserAvailable: false, externalToolsAllowed: false, scannerAvailable: true, mcpTouched: false, paymentTouched: false, authTouched: false, cloudTouched: false, dashboardTouched: false, publicCopyTouched: false, proofRequired: false, deterministicEvidenceAvailable: false, dataSensitivity: "low", externalWriteRequested: false, secretsPossible: false, productionImpactPossible: false, deepMode: false, changedFiles: [], userIntent: "", localOnly: true, userPlan: "free", founderCockpitTouched: false, aiTeamTouched: false, feedbackLoopTouched: false, oldRepoReferenceUsed: false, installedTools: [], contextBudgetRemaining: 100, tokenBudgetRemaining: 100000 };

function check(name: string, frame: Partial<UnifiedTaskFrame>, test: (r: ReturnType<typeof unifiedRoute>) => boolean) {
  const r = unifiedRoute({ ...base, ...frame });
  if (!test(r)) failures.push(`${name}: FAILED`);
}

// Core routing scenarios
check("S1_docs_low", { taskType: "docs", riskClass: "low" }, r => r.selectedPrimitive === "no_action" && r.selectedModelProfile === "none");
check("S2_security_high", { riskClass: "high", secretsPossible: true }, r => r.selectedScanners.length > 0);
check("S3_public_copy", { publicCopyTouched: true }, r => r.selectedScanners.includes("claims"));
check("S4_payment", { paymentTouched: true, riskClass: "high" }, r => r.forbiddenActions.includes("model_owns_READY"));
check("S5_ui_no_browser", { dashboardTouched: true }, r => r.selectedPrimitive === "manual_checklist");
check("S6_ui_browser", { dashboardTouched: true, browserAvailable: true }, r => r.selectedPrimitive === "browser_workflow");
check("S7_mcp", { mcpTouched: true }, r => r.forbiddenActions.includes("broad_mcp_exposure_without_approval"));
check("S8_external_write", { externalWriteRequested: true }, r => r.approvalRequired);
check("S9_production", { productionImpactPossible: true }, r => r.selectedPrimitive === "stop_blocked");
check("S10_deep", { deepMode: true }, r => r.selectedScanners.length >= 3);

// Unified composition checks
check("S11_has_capabilities", { paymentTouched: true }, r => r.selectedCapabilities.length > 0);
check("S12_has_receipt_fields", {}, r => r.receiptFields.length > 0);
check("S13_kernel_owns_truth", {}, r => r.finalDecisionOwner === "kernel/stop-continue-gate");
check("S14_model_cannot_decide", {}, r => r.modelMayDecide === false);
check("S15_scanner_cannot_decide", {}, r => r.scannerMayDecide === false);
check("S16_old_repo_not_readiness", { oldRepoReferenceUsed: true }, r => r.forbiddenActions.includes("old_repo_as_readiness_proof"));
check("S17_founder_no_truth", { founderCockpitTouched: true }, r => r.forbiddenActions.includes("founder_cockpit_creates_truth"));
check("S18_ai_team_no_ready", { aiTeamTouched: true }, r => r.forbiddenActions.includes("ai_team_declares_READY"));
check("S19_sensitive_data", { dataSensitivity: "high" }, r => r.forbiddenActions.includes("raw_prompt_exposure"));
check("S20_code_gen", { taskType: "code_generation" }, r => r.selectedModelProfile === "code_generation");

// Skill/scanner integration
check("S21_skills_selected", { riskClass: "high", touchedLayers: ["Kernel"] }, r => r.skillRouteSelected > 0);
check("S22_scanners_run_deep", { deepMode: true }, r => r.scannerResults.ran > 0);
check("S23_no_connect", { taskType: "offline" }, r => r.selectedPrimitive === "no_connect");
check("S24_fallback_exists", {}, r => r.fallbackPlan.length > 0);
check("S25_next_action", {}, r => r.nextAction.length > 0);

const out = { ok: failures.length === 0, scenarios: 25, passed: 25 - failures.length, failures };
process.stdout.write("AVORELO CONTROL ROUTER DOGFOOD\n" + JSON.stringify(out, null, 2) + "\n");
process.exit(failures.length === 0 ? 0 : 1);
