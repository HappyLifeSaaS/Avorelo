// Avorelo Model / Primitive Routing V1. Deterministic-first. Routes work, not just models.
// Kernel owns final policy. Model output cannot bypass deterministic gates.

export type Primitive = "no_action" | "no_connect" | "deterministic_local_read" | "deterministic_local_script" | "built_in_scanner" | "scanner_adapter" | "internal_skill" | "manual_checklist" | "llm_model_profile" | "mcp_tool" | "browser_workflow" | "direct_api" | "human_approval" | "stop_blocked" | "prepare_next_run_packet";

export type ModelProfile = "none" | "cheap_classification" | "standard_synthesis" | "high_reasoning" | "code_generation" | "security_sensitive_review" | "privacy_sensitive_summary" | "fallback_only";

export type RoutingTaskFrame = {
  taskType: string;
  riskClass: "low" | "medium" | "high";
  touchedLayers: string[];
  browserAvailable: boolean;
  externalToolsAllowed: boolean;
  scannerAvailable: boolean;
  mcpTouched: boolean;
  paymentTouched: boolean;
  authTouched: boolean;
  cloudTouched: boolean;
  dashboardTouched: boolean;
  publicCopyTouched: boolean;
  proofRequired: boolean;
  deterministicEvidenceAvailable: boolean;
  dataSensitivity: "low" | "medium" | "high";
  externalWriteRequested: boolean;
  secretsPossible: boolean;
  productionImpactPossible: boolean;
  deepMode: boolean;
};

export type PrimitiveRouteDecision = {
  selectedPrimitive: Primitive;
  selectedModelProfile: ModelProfile;
  selectedScanners: string[];
  selectedSkills: string[];
  skippedSkills: string[];
  reasonCodes: string[];
  forbiddenActions: string[];
  approvalRequired: boolean;
  requiredEvidence: string[];
  verificationMode: string;
  estimatedLatencyMs: number;
  estimatedContextCost: string;
  fallbackPlan: string;
  receiptFields: string[];
  kernelDecisionOwner: string;
};

export function routePrimitive(frame: RoutingTaskFrame): PrimitiveRouteDecision {
  const reasonCodes: string[] = [];
  const forbiddenActions: string[] = [];
  const requiredEvidence: string[] = [];
  const receiptFields: string[] = ["taskType", "selectedPrimitive", "selectedModelProfile", "reasonCodes"];
  let selectedPrimitive: Primitive = "deterministic_local_read";
  let selectedModelProfile: ModelProfile = "none";
  let selectedScanners: string[] = [];
  let approvalRequired = false;
  let fallbackPlan = "deterministic_local_read";

  // Rule 1: No-connect is a positive decision
  if (frame.taskType === "offline" || (!frame.externalToolsAllowed && !frame.mcpTouched)) {
    selectedPrimitive = "no_connect";
    reasonCodes.push("NO_CONNECT_SUFFICIENT");
  }

  // Rule 2: Deterministic-first when evidence available
  if (frame.deterministicEvidenceAvailable && !frame.deepMode) {
    selectedPrimitive = "deterministic_local_script";
    selectedModelProfile = "none";
    reasonCodes.push("DETERMINISTIC_EVIDENCE_AVAILABLE");
  }

  // Rule 3: Security-sensitive → scanner + deterministic gate
  if (frame.riskClass === "high" || frame.secretsPossible || frame.paymentTouched || frame.authTouched) {
    selectedPrimitive = "built_in_scanner";
    selectedScanners = ["secret-patterns", "claims", "permissions"];
    if (frame.riskClass === "high") selectedModelProfile = "security_sensitive_review";
    reasonCodes.push("SECURITY_SENSITIVE_ROUTE");
    requiredEvidence.push("scanner_output", "deterministic_gate_verdict");
    forbiddenActions.push("model_owns_READY", "model_owns_entitlement");
  }

  // Rule 4: External write → human approval
  if (frame.externalWriteRequested) {
    approvalRequired = true;
    forbiddenActions.push("silent_external_write");
    reasonCodes.push("EXTERNAL_WRITE_REQUIRES_APPROVAL");
  }

  // Rule 5: Production impact → stop_blocked unless production confidence
  if (frame.productionImpactPossible) {
    selectedPrimitive = "stop_blocked";
    reasonCodes.push("PRODUCTION_IMPACT_BLOCKED");
    requiredEvidence.push("production_confidence_receipt");
  }

  // Rule 6: Browser workflow only if available
  if (frame.dashboardTouched && frame.browserAvailable) {
    selectedPrimitive = "browser_workflow";
    requiredEvidence.push("screenshot_proof");
  } else if (frame.dashboardTouched && !frame.browserAvailable) {
    selectedPrimitive = "manual_checklist";
    reasonCodes.push("BROWSER_UNAVAILABLE_FALLBACK");
    fallbackPlan = "manual_checklist + backlog browser proof";
  }

  // Rule 7: Public copy → claim guard + optional synthesis
  if (frame.publicCopyTouched) {
    selectedScanners.push("claims");
    requiredEvidence.push("claim_guard_output");
    if (!frame.deterministicEvidenceAvailable) {
      selectedModelProfile = "standard_synthesis";
      reasonCodes.push("SYNTHESIS_FOR_COPY_REVIEW");
    }
  }

  // Rule 8: MCP → tool governance
  if (frame.mcpTouched) {
    selectedScanners.push("permissions");
    reasonCodes.push("MCP_TOOL_GOVERNANCE_REQUIRED");
    forbiddenActions.push("broad_mcp_exposure_without_approval");
  }

  // Rule 9: Sensitive data → redaction
  if (frame.dataSensitivity === "high") {
    forbiddenActions.push("raw_prompt_exposure", "raw_source_exposure", "raw_secret_exposure");
    if (selectedModelProfile === "none") selectedModelProfile = "privacy_sensitive_summary";
    reasonCodes.push("SENSITIVE_DATA_REDACTION_REQUIRED");
  }

  // Rule 10: Deep mode → full review
  if (frame.deepMode) {
    selectedPrimitive = "internal_skill";
    selectedModelProfile = selectedModelProfile === "none" ? "high_reasoning" : selectedModelProfile;
    selectedScanners = ["secret-patterns", "env-exposure", "claims", "permissions", "generated-exposure"];
    reasonCodes.push("DEEP_MODE_FULL_REVIEW");
  }

  // Rule 11: Code generation
  if (frame.taskType === "code_generation") {
    selectedModelProfile = "code_generation";
    requiredEvidence.push("test_output", "proof_receipt");
    reasonCodes.push("CODE_GENERATION_PROOF_REQUIRED");
  }

  // Rule 12: Docs-only low-risk
  if (frame.taskType === "docs" && frame.riskClass === "low" && !frame.publicCopyTouched) {
    selectedPrimitive = "no_action";
    selectedModelProfile = "none";
    selectedScanners = [];
    reasonCodes.push("DOCS_ONLY_NO_ACTION");
  }

  return {
    selectedPrimitive, selectedModelProfile, selectedScanners, selectedSkills: [],
    skippedSkills: [], reasonCodes, forbiddenActions, approvalRequired,
    requiredEvidence, verificationMode: frame.proofRequired ? "outcome_required" : "best_effort",
    estimatedLatencyMs: selectedModelProfile === "none" ? 10 : 500,
    estimatedContextCost: selectedModelProfile === "none" ? "low" : "medium",
    fallbackPlan, receiptFields,
    kernelDecisionOwner: "kernel/stop-continue-gate",
  };
}
