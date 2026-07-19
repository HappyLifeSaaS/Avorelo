// Safe model routing projection/receipt. Never contains raw content.

import type { ModelRoutingProjection, Primitive, ModelProfile, ResolverResult } from "./types.ts";
import type { PrimitiveRouteDecision } from "../../validation/model-routing/index.ts";
import type { CascadePlan } from "./cascade.ts";

export function createSafeProjection(
  primitiveDecision: PrimitiveRouteDecision,
  resolverResult: ResolverResult,
  cascade: CascadePlan,
): ModelRoutingProjection {
  const modelMayAssist =
    primitiveDecision.selectedModelProfile !== "none" &&
    primitiveDecision.selectedPrimitive !== "stop_blocked" &&
    primitiveDecision.selectedPrimitive !== "no_action";

  return {
    selectedPrimitive: primitiveDecision.selectedPrimitive,
    selectedModelProfile: primitiveDecision.selectedModelProfile,
    resolverStatus: resolverResult.status,
    providerClass: resolverResult.selectedModel?.providerClass ?? "none",
    fallbackPlan: resolverResult.fallbackChain.map(m => m.modelId),
    verifierPlan: cascade.steps.map(s => s.reason),
    reasonCodes: [
      ...primitiveDecision.reasonCodes,
      ...resolverResult.reasonCodes,
    ],
    forbiddenActions: [
      ...primitiveDecision.forbiddenActions,
      "persist_raw_prompt",
      "persist_raw_source",
      "persist_raw_secret",
      "model_own_ready",
      "model_own_entitlement",
      "model_own_production_readiness",
      "claim_savings_without_evidence",
    ],
    modelMayAssist,
    modelMayDecide: false,
    scannerMayDecide: false,
    finalDecisionOwner: "kernel/stop-continue-gate",
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
  };
}
