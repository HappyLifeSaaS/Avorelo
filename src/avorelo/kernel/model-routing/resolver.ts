// Model resolver. Filters unsafe providers, filters by capability, selects cheapest safe candidate.
// Safety-first: privacy → data policy → capabilities → health → cost → latency.

import type {
  ModelCapability, ModelProfile, ResolverResult, ResolverStatus,
  ProviderConstraints, ContextSignals, CostClass,
} from "./types.ts";
import { getModelsForProfile, getEnabledModels } from "./model-registry.ts";
import { isProviderAvailable } from "./provider-registry.ts";

const COST_ORDER: CostClass[] = ["free", "cheap", "standard", "expensive"];

function costRank(c: CostClass): number {
  return COST_ORDER.indexOf(c);
}

export type ResolveInput = {
  profile: ModelProfile;
  providerConstraints: ProviderConstraints;
  contextSignals: ContextSignals;
  approvalPolicy: string;
  now?: number;
};

export function resolveModel(input: ResolveInput): ResolverResult {
  const { profile, providerConstraints, contextSignals, approvalPolicy } = input;
  const reasonCodes: string[] = [];

  if (profile === "none") {
    return { status: "no_model_needed", selectedModel: null, fallbackChain: [], reasonCodes: ["NO_MODEL_PROFILE"] };
  }

  if (approvalPolicy === "blocked") {
    return { status: "stop_blocked", selectedModel: null, fallbackChain: [], reasonCodes: ["STOP_BLOCKED_BY_POLICY"] };
  }

  if (approvalPolicy === "require_manual_review" || approvalPolicy === "require_confirmation") {
    reasonCodes.push("APPROVAL_REQUIRED");
  }

  let candidates = getModelsForProfile(profile);
  if (candidates.length === 0) {
    candidates = getEnabledModels().filter(m => m.profiles.length > 0);
    reasonCodes.push("PROFILE_FALLBACK_TO_ALL");
  }

  // Filter: local-only constraint
  if (providerConstraints.localOnly) {
    candidates = candidates.filter(m => m.providerClass === "local");
    reasonCodes.push("LOCAL_ONLY_FILTER");
  }

  // Filter: deny data collection (explicit constraint OR sensitive profiles)
  const sensitiveProfiles = ["security_sensitive_review", "privacy_sensitive_summary"];
  const forceDataProtection = providerConstraints.denyDataCollection || sensitiveProfiles.includes(profile);
  if (forceDataProtection) {
    candidates = candidates.filter(m => m.dataPolicy !== "training_included");
    reasonCodes.push(providerConstraints.denyDataCollection ? "DENY_DATA_COLLECTION_FILTER" : "SENSITIVE_PROFILE_DATA_PROTECTION");
  }

  // Filter: allowed/denied providers
  if (providerConstraints.allowedProviders) {
    candidates = candidates.filter(m => providerConstraints.allowedProviders!.includes(m.provider));
  }
  if (providerConstraints.deniedProviders) {
    candidates = candidates.filter(m => !providerConstraints.deniedProviders!.includes(m.provider));
  }

  // Filter: vision
  if (providerConstraints.requireVision || contextSignals.requiresVision) {
    candidates = candidates.filter(m => m.supportsVision);
    reasonCodes.push("VISION_REQUIRED_FILTER");
  }

  // Filter: tool support
  if (providerConstraints.requireToolSupport || contextSignals.requiresToolUse) {
    candidates = candidates.filter(m => m.supportsToolUse);
  }

  // Filter: JSON output
  if (providerConstraints.requireJsonOutput || contextSignals.requiresJsonOutput) {
    candidates = candidates.filter(m => m.supportsJsonOutput);
  }

  // Filter: context window
  if (contextSignals.estimatedTokens > 0) {
    candidates = candidates.filter(m => m.contextWindow >= contextSignals.estimatedTokens);
    if (candidates.length === 0) reasonCodes.push("CONTEXT_WINDOW_TOO_SMALL");
  }

  // Filter: cost ceiling
  candidates = candidates.filter(m => costRank(m.costClass) <= costRank(providerConstraints.maxCostClass));

  // Filter: provider health
  const now = input.now ?? Date.now();
  candidates = candidates.filter(m => isProviderAvailable(m.provider, now));

  if (candidates.length === 0) {
    return { status: "no_safe_candidate", selectedModel: null, fallbackChain: [], reasonCodes: [...reasonCodes, "NO_CANDIDATES_AFTER_FILTERING"] };
  }

  // Sort: cheapest first, then fastest
  candidates.sort((a, b) => {
    const costDiff = costRank(a.costClass) - costRank(b.costClass);
    if (costDiff !== 0) return costDiff;
    const latOrder = ["instant", "fast", "standard", "slow"];
    return latOrder.indexOf(a.latencyClass) - latOrder.indexOf(b.latencyClass);
  });

  const selected = candidates[0];
  const fallback = candidates.slice(1);
  reasonCodes.push("RESOLVED_CHEAPEST_SAFE");

  return {
    status: fallback.length > 0 ? "resolved" : "resolved",
    selectedModel: selected,
    fallbackChain: fallback,
    reasonCodes,
  };
}
