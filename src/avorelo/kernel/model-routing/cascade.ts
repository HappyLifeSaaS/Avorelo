// Deterministic-first cascade. Plans the execution sequence: local evidence → scanner →
// cheap classify → synthesis → deep review → human approval.

import type { Primitive, ModelProfile } from "./types.ts";
import type { RoutingTaskFrame, PrimitiveRouteDecision } from "../../validation/model-routing/index.ts";

export type CascadeStep = {
  order: number;
  primitive: Primitive;
  reason: string;
  gated: boolean;
};

export type CascadePlan = {
  steps: CascadeStep[];
  finalPrimitive: Primitive;
  requiresModel: boolean;
  requiresApproval: boolean;
};

export function buildCascade(frame: RoutingTaskFrame, primitiveDecision: PrimitiveRouteDecision): CascadePlan {
  const steps: CascadeStep[] = [];
  let order = 0;

  // Step 1: always start with local deterministic evidence
  steps.push({ order: ++order, primitive: "deterministic_local_read", reason: "local_evidence_first", gated: false });

  // Step 2: scanner if security-sensitive
  if (primitiveDecision.selectedScanners.length > 0) {
    steps.push({ order: ++order, primitive: "built_in_scanner", reason: "scanner_required", gated: false });
  }

  // Step 3: cheap classification if model needed
  if (primitiveDecision.selectedModelProfile !== "none" && primitiveDecision.selectedModelProfile !== "security_sensitive_review") {
    steps.push({ order: ++order, primitive: "llm_model_profile", reason: "classify_or_synthesize", gated: false });
  }

  // Step 4: deep review for security/high-risk
  if (primitiveDecision.selectedModelProfile === "security_sensitive_review" || primitiveDecision.selectedModelProfile === "high_reasoning") {
    steps.push({ order: ++order, primitive: "llm_model_profile", reason: "deep_review_required", gated: true });
  }

  // Step 5: human approval if required
  if (primitiveDecision.approvalRequired) {
    steps.push({ order: ++order, primitive: "human_approval", reason: "approval_gate", gated: true });
  }

  // Step 6: production block
  if (frame.productionImpactPossible) {
    steps.push({ order: ++order, primitive: "stop_blocked", reason: "production_impact", gated: true });
  }

  return {
    steps,
    finalPrimitive: primitiveDecision.selectedPrimitive,
    requiresModel: primitiveDecision.selectedModelProfile !== "none",
    requiresApproval: primitiveDecision.approvalRequired,
  };
}
