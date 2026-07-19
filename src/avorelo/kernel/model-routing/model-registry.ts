// Canonical model capability registry. Local-only, no network.
// Models are declarative metadata — no provider credentials needed.

import type { ModelCapability, ModelProfile, ProviderClass } from "./types.ts";

const REGISTRY: ModelCapability[] = [
  {
    modelId: "local/deterministic",
    displayName: "Local Deterministic",
    provider: "local",
    providerClass: "local",
    contextWindow: Infinity,
    costClass: "free",
    latencyClass: "instant",
    supportsVision: false,
    supportsToolUse: false,
    supportsJsonOutput: true,
    supportsReasoning: false,
    dataPolicy: "no_training",
    profiles: ["none", "cheap_classification"],
    enabled: true,
  },
  {
    modelId: "local/scanner",
    displayName: "Local Scanner",
    provider: "local",
    providerClass: "local",
    contextWindow: Infinity,
    costClass: "free",
    latencyClass: "instant",
    supportsVision: false,
    supportsToolUse: false,
    supportsJsonOutput: true,
    supportsReasoning: false,
    dataPolicy: "no_training",
    profiles: ["cheap_classification", "security_sensitive_review"],
    enabled: true,
  },
  {
    modelId: "cloud/claude-sonnet",
    displayName: "Claude Sonnet",
    provider: "anthropic",
    providerClass: "cloud_zdr",
    contextWindow: 200_000,
    costClass: "standard",
    latencyClass: "fast",
    supportsVision: true,
    supportsToolUse: true,
    supportsJsonOutput: true,
    supportsReasoning: true,
    dataPolicy: "zdr",
    profiles: ["standard_synthesis", "code_generation", "cheap_classification"],
    enabled: true,
  },
  {
    modelId: "cloud/claude-opus",
    displayName: "Claude Opus",
    provider: "anthropic",
    providerClass: "cloud_zdr",
    contextWindow: 200_000,
    costClass: "expensive",
    latencyClass: "slow",
    supportsVision: true,
    supportsToolUse: true,
    supportsJsonOutput: true,
    supportsReasoning: true,
    dataPolicy: "zdr",
    profiles: ["high_reasoning", "security_sensitive_review", "code_generation"],
    enabled: true,
  },
  {
    modelId: "cloud/claude-haiku",
    displayName: "Claude Haiku",
    provider: "anthropic",
    providerClass: "cloud_zdr",
    contextWindow: 200_000,
    costClass: "cheap",
    latencyClass: "fast",
    supportsVision: true,
    supportsToolUse: true,
    supportsJsonOutput: true,
    supportsReasoning: false,
    dataPolicy: "zdr",
    profiles: ["cheap_classification", "standard_synthesis", "fallback_only"],
    enabled: true,
  },
  {
    modelId: "cloud/gpt-4o",
    displayName: "GPT-4o",
    provider: "openai",
    providerClass: "cloud_standard",
    contextWindow: 128_000,
    costClass: "standard",
    latencyClass: "fast",
    supportsVision: true,
    supportsToolUse: true,
    supportsJsonOutput: true,
    supportsReasoning: true,
    dataPolicy: "training_included",
    profiles: ["standard_synthesis", "code_generation"],
    enabled: true,
  },
  {
    modelId: "cloud/gpt-4o-mini",
    displayName: "GPT-4o Mini",
    provider: "openai",
    providerClass: "cloud_standard",
    contextWindow: 128_000,
    costClass: "cheap",
    latencyClass: "fast",
    supportsVision: true,
    supportsToolUse: true,
    supportsJsonOutput: true,
    supportsReasoning: false,
    dataPolicy: "training_included",
    profiles: ["cheap_classification", "fallback_only"],
    enabled: true,
  },
];

export function getModelRegistry(): readonly ModelCapability[] {
  return REGISTRY;
}

export function getModel(modelId: string): ModelCapability | undefined {
  return REGISTRY.find(m => m.modelId === modelId);
}

export function getModelsForProfile(profile: ModelProfile): ModelCapability[] {
  return REGISTRY.filter(m => m.enabled && m.profiles.includes(profile));
}

export function getLocalModels(): ModelCapability[] {
  return REGISTRY.filter(m => m.enabled && m.providerClass === "local");
}

export function getEnabledModels(): ModelCapability[] {
  return REGISTRY.filter(m => m.enabled);
}
