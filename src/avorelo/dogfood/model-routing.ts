// Avorelo Model/Primitive Routing Dogfood. 12 scenarios proving routing correctness.
import { routePrimitive, type RoutingTaskFrame } from "../validation/model-routing/index.ts";

const failures: string[] = [];
const base: RoutingTaskFrame = { taskType: "code", riskClass: "low", touchedLayers: [], browserAvailable: false, externalToolsAllowed: false, scannerAvailable: true, mcpTouched: false, paymentTouched: false, authTouched: false, cloudTouched: false, dashboardTouched: false, publicCopyTouched: false, proofRequired: false, deterministicEvidenceAvailable: false, dataSensitivity: "low", externalWriteRequested: false, secretsPossible: false, productionImpactPossible: false, deepMode: false };

function check(name: string, frame: Partial<RoutingTaskFrame>, test: (r: ReturnType<typeof routePrimitive>) => boolean, desc: string) {
  const r = routePrimitive({ ...base, ...frame });
  if (!test(r)) failures.push(`${name}: ${desc} | got primitive=${r.selectedPrimitive} model=${r.selectedModelProfile}`);
}

check("S1_docs_low", { taskType: "docs", riskClass: "low" }, r => r.selectedPrimitive === "no_action" && r.selectedModelProfile === "none", "docs-only should be no_action/none");
check("S2_security", { riskClass: "high", secretsPossible: true }, r => r.selectedPrimitive === "built_in_scanner" && r.selectedScanners.length > 0, "security should select scanners");
check("S3_public_copy", { publicCopyTouched: true }, r => r.selectedScanners.includes("claims"), "public copy should select claims scanner");
check("S4_payment", { paymentTouched: true, riskClass: "high" }, r => r.forbiddenActions.includes("model_owns_READY"), "payment should forbid model owning READY");
check("S5_ui_no_browser", { dashboardTouched: true, browserAvailable: false }, r => r.selectedPrimitive === "manual_checklist" && r.reasonCodes.includes("BROWSER_UNAVAILABLE_FALLBACK"), "UI without browser should fallback");
check("S6_ui_browser", { dashboardTouched: true, browserAvailable: true }, r => r.selectedPrimitive === "browser_workflow", "UI with browser should select browser_workflow");
check("S7_mcp", { mcpTouched: true }, r => r.forbiddenActions.includes("broad_mcp_exposure_without_approval"), "MCP should forbid broad exposure");
check("S8_external_write", { externalWriteRequested: true }, r => r.approvalRequired === true, "external write should require approval");
check("S9_production", { productionImpactPossible: true }, r => r.selectedPrimitive === "stop_blocked", "production impact should be stop_blocked");
check("S10_sensitive", { dataSensitivity: "high" }, r => r.forbiddenActions.includes("raw_prompt_exposure"), "sensitive data should forbid raw exposure");
check("S11_deep", { deepMode: true }, r => r.selectedScanners.length >= 3 && r.selectedModelProfile !== "none", "deep mode should select scanners + model");
check("S12_code_gen", { taskType: "code_generation" }, r => r.selectedModelProfile === "code_generation" && r.requiredEvidence.includes("test_output"), "code gen should require test output");

// Verify routing contracts
const r = routePrimitive(base);
if (!r.receiptFields.length) failures.push("S13: route missing receiptFields");
if (!r.kernelDecisionOwner) failures.push("S14: route missing kernelDecisionOwner");

const out = { ok: failures.length === 0, scenarios: 14, passed: 14 - failures.length, failures };
process.stdout.write("AVORELO MODEL ROUTING DOGFOOD\n" + JSON.stringify(out, null, 2) + "\n");
process.exit(failures.length === 0 ? 0 : 1);
