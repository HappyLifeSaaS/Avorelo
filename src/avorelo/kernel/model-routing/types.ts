// Canonical types for model routing kernel. Consumes shared schema types.

import type { RiskClass, ProofTier, ApprovalPolicy } from "../../shared/schemas/index.ts";
import type { Primitive, ModelProfile } from "../../validation/model-routing/index.ts";

export type { RiskClass, ProofTier, ApprovalPolicy, Primitive, ModelProfile };

export type DataSensitivity = "low" | "medium" | "high" | "secret";
export type CostClass = "free" | "cheap" | "standard" | "expensive";
export type LatencyClass = "instant" | "fast" | "standard" | "slow";
export type ProviderClass = "none" | "local" | "cloud_zdr" | "cloud_standard";
export type DataPolicy = "no_training" | "zdr" | "training_included";

export type ContextSignals = {
  estimatedTokens: number;
  requiresVision: boolean;
  requiresToolUse: boolean;
  requiresJsonOutput: boolean;
  requiresReasoning: boolean;
};

export type AgenticSignals = {
  isMultiStep: boolean;
  touchedSensitiveSurface: boolean;
  sessionDepth: number;
  escalationCount: number;
};

export type ProviderConstraints = {
  localOnly: boolean;
  denyDataCollection: boolean;
  requireVision: boolean;
  requireToolSupport: boolean;
  requireJsonOutput: boolean;
  maxCostClass: CostClass;
  allowedProviders: string[] | null;
  deniedProviders: string[] | null;
};

export type ModelCapability = {
  modelId: string;
  displayName: string;
  provider: string;
  providerClass: ProviderClass;
  contextWindow: number;
  costClass: CostClass;
  latencyClass: LatencyClass;
  supportsVision: boolean;
  supportsToolUse: boolean;
  supportsJsonOutput: boolean;
  supportsReasoning: boolean;
  dataPolicy: DataPolicy;
  profiles: ModelProfile[];
  enabled: boolean;
};

export type ProviderHealth = {
  provider: string;
  healthy: boolean;
  lastError: string | null;
  cooldownUntil: number;
  consecutiveFailures: number;
};

export type ResolverStatus =
  | "no_model_needed"
  | "deterministic_only"
  | "resolved"
  | "no_safe_candidate"
  | "stop_blocked"
  | "approval_required"
  | "fallback_used";

export type ResolverResult = {
  status: ResolverStatus;
  selectedModel: ModelCapability | null;
  fallbackChain: ModelCapability[];
  reasonCodes: string[];
};

export type ModelRoutingProjection = {
  selectedPrimitive: string;
  selectedModelProfile: string;
  resolverStatus: string;
  providerClass: string;
  fallbackPlan: string[];
  verifierPlan: string[];
  reasonCodes: string[];
  forbiddenActions: string[];
  modelMayAssist: boolean;
  modelMayDecide: false;
  scannerMayDecide: false;
  finalDecisionOwner: "kernel/stop-continue-gate";
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawSecret: false;
};
