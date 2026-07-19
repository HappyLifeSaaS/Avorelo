// Canonical Seamless Model & Primitive Routing kernel.
// Consumes validation/model-routing (primitive selection) and adds model resolution,
// provider health, session memory, cascade planning, and verification.
// One canonical path — no duplicate routing sources of truth.

export type {
  ModelCapability, ProviderClass, DataPolicy, CostClass, LatencyClass,
  ContextSignals, AgenticSignals, ProviderConstraints, DataSensitivity,
  ResolverStatus, ResolverResult, ModelRoutingProjection,
  ProviderHealth,
} from "./types.ts";

export { getModelRegistry, getModel, getModelsForProfile, getLocalModels, getEnabledModels } from "./model-registry.ts";
export { getProviderHealth, getAllProviders, isProviderAvailable, markProviderUnhealthy, markProviderHealthy, resetAllHealth } from "./provider-registry.ts";
export { resolveModel, type ResolveInput } from "./resolver.ts";
export { createRouteSession, requestProfileChange, canDowngrade, recordSensitiveSurface, type RouteSessionMemory, type UpgradeResult } from "./session-memory.ts";
export { buildCascade, type CascadeStep, type CascadePlan } from "./cascade.ts";
export { verifyRoutingDecision, type VerifierViolation, type VerifierResult } from "./verifier.ts";
export { createSafeProjection } from "./receipt.ts";

// Re-export primitive routing types and function from validation layer (single source of truth)
export { routePrimitive, type Primitive, type ModelProfile, type RoutingTaskFrame, type PrimitiveRouteDecision } from "../../validation/model-routing/index.ts";

import { routePrimitive, type RoutingTaskFrame, type PrimitiveRouteDecision } from "../../validation/model-routing/index.ts";
import { resolveModel } from "./resolver.ts";
import { buildCascade } from "./cascade.ts";
import { verifyRoutingDecision } from "./verifier.ts";
import { createSafeProjection } from "./receipt.ts";
import type { ModelRoutingProjection, ProviderConstraints, ContextSignals, ResolverResult } from "./types.ts";
import type { CascadePlan } from "./cascade.ts";
import type { VerifierResult } from "./verifier.ts";

export type CanonicalRoutingInput = {
  frame: RoutingTaskFrame;
  approvalPolicy: string;
  providerConstraints?: Partial<ProviderConstraints>;
  contextSignals?: Partial<ContextSignals>;
  precomputedPrimitive?: PrimitiveRouteDecision;
  now?: number;
};

export type CanonicalRoutingResult = {
  projection: ModelRoutingProjection;
  primitiveDecision: PrimitiveRouteDecision;
  resolverResult: ResolverResult;
  cascadePlan: CascadePlan;
  verifierResult: VerifierResult;
};

const DEFAULT_PROVIDER_CONSTRAINTS: ProviderConstraints = {
  localOnly: false,
  denyDataCollection: false,
  requireVision: false,
  requireToolSupport: false,
  requireJsonOutput: false,
  maxCostClass: "standard",
  allowedProviders: null,
  deniedProviders: null,
};

const DEFAULT_CONTEXT_SIGNALS: ContextSignals = {
  estimatedTokens: 0,
  requiresVision: false,
  requiresToolUse: false,
  requiresJsonOutput: false,
  requiresReasoning: false,
};

export function routeCanonical(input: CanonicalRoutingInput): CanonicalRoutingResult {
  const { frame, approvalPolicy } = input;
  const providerConstraints = { ...DEFAULT_PROVIDER_CONSTRAINTS, ...input.providerConstraints };
  const contextSignals = { ...DEFAULT_CONTEXT_SIGNALS, ...input.contextSignals };

  // Step 1: primitive routing — use precomputed if provided, otherwise compute once
  const primitiveDecision = input.precomputedPrimitive ?? routePrimitive(frame);

  // Step 2: model resolution (new kernel layer)
  const resolverResult = resolveModel({
    profile: primitiveDecision.selectedModelProfile,
    providerConstraints,
    contextSignals,
    approvalPolicy,
    now: input.now,
  });

  // Step 3: cascade plan
  const cascadePlan = buildCascade(frame, primitiveDecision);

  // Step 4: safe projection
  const projection = createSafeProjection(primitiveDecision, resolverResult, cascadePlan);

  // Step 5: verify
  const verifierResult = verifyRoutingDecision(frame, primitiveDecision.selectedModelProfile, resolverResult, projection);

  return { projection, primitiveDecision, resolverResult, cascadePlan, verifierResult };
}
