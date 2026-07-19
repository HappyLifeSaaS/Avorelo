import type { ToolAdapterId, WellKnownAdapterId, ToolExecutionResult } from "./types.ts";

export type AdapterCostTier = "free" | "pay_per_use" | "subscription" | "unknown";

export type AdapterCostProfile = {
  adapterId: ToolAdapterId;
  costTier: AdapterCostTier;
  estimatedCostPerTaskUsd: number | null;
  tokenCostPer1kInput: number | null;
  tokenCostPer1kOutput: number | null;
  localOnly: boolean;
  requiresApiKey: boolean;
  containsRawSecret: false;
  containsRawPrompt: false;
};

export type CostBenchmarkEntry = {
  adapterId: ToolAdapterId;
  taskType: string;
  durationMs: number;
  estimatedCostUsd: number | null;
  tokenCountEstimate: number | null;
  success: boolean;
  recordedAt: number;
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawSecret: false;
  containsRawOutput: false;
};

export type CostBenchmarkSummary = {
  contract: "avorelo.costBenchmark.v1";
  entries: CostBenchmarkEntry[];
  totalEstimatedCostUsd: number;
  totalDurationMs: number;
  adapterBreakdown: Array<{
    adapterId: ToolAdapterId;
    taskCount: number;
    totalCostUsd: number;
    avgDurationMs: number;
    successRate: number;
  }>;
  cheapestAdapter: ToolAdapterId | null;
  fastestAdapter: ToolAdapterId | null;
  mostReliableAdapter: ToolAdapterId | null;
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawSecret: false;
  containsRawOutput: false;
  modelMayDecide: false;
  scannerMayDecide: false;
  finalDecisionOwner: "kernel/stop-continue-gate";
};

const COST_PROFILES: Record<WellKnownAdapterId, AdapterCostProfile> = {
  "deterministic-local": {
    adapterId: "deterministic-local", costTier: "free",
    estimatedCostPerTaskUsd: 0, tokenCostPer1kInput: null, tokenCostPer1kOutput: null,
    localOnly: true, requiresApiKey: false, containsRawSecret: false, containsRawPrompt: false,
  },
  "manual-gate": {
    adapterId: "manual-gate", costTier: "free",
    estimatedCostPerTaskUsd: 0, tokenCostPer1kInput: null, tokenCostPer1kOutput: null,
    localOnly: true, requiresApiKey: false, containsRawSecret: false, containsRawPrompt: false,
  },
  "scanner": {
    adapterId: "scanner", costTier: "free",
    estimatedCostPerTaskUsd: 0, tokenCostPer1kInput: null, tokenCostPer1kOutput: null,
    localOnly: true, requiresApiKey: false, containsRawSecret: false, containsRawPrompt: false,
  },
  "semgrep": {
    adapterId: "semgrep", costTier: "free",
    estimatedCostPerTaskUsd: 0, tokenCostPer1kInput: null, tokenCostPer1kOutput: null,
    localOnly: true, requiresApiKey: false, containsRawSecret: false, containsRawPrompt: false,
  },
  "playwright-proof": {
    adapterId: "playwright-proof", costTier: "free",
    estimatedCostPerTaskUsd: 0, tokenCostPer1kInput: null, tokenCostPer1kOutput: null,
    localOnly: true, requiresApiKey: false, containsRawSecret: false, containsRawPrompt: false,
  },
  "github-actions": {
    adapterId: "github-actions", costTier: "pay_per_use",
    estimatedCostPerTaskUsd: 0.008, tokenCostPer1kInput: null, tokenCostPer1kOutput: null,
    localOnly: false, requiresApiKey: true, containsRawSecret: false, containsRawPrompt: false,
  },
  "claude-code": {
    adapterId: "claude-code", costTier: "pay_per_use",
    estimatedCostPerTaskUsd: 0.05, tokenCostPer1kInput: 0.003, tokenCostPer1kOutput: 0.015,
    localOnly: false, requiresApiKey: true, containsRawSecret: false, containsRawPrompt: false,
  },
  "codex": {
    adapterId: "codex", costTier: "pay_per_use",
    estimatedCostPerTaskUsd: 0.03, tokenCostPer1kInput: 0.003, tokenCostPer1kOutput: 0.012,
    localOnly: false, requiresApiKey: true, containsRawSecret: false, containsRawPrompt: false,
  },
  "gemini-cli": {
    adapterId: "gemini-cli", costTier: "pay_per_use",
    estimatedCostPerTaskUsd: 0.02, tokenCostPer1kInput: 0.001, tokenCostPer1kOutput: 0.004,
    localOnly: false, requiresApiKey: true, containsRawSecret: false, containsRawPrompt: false,
  },
  "aider": {
    adapterId: "aider", costTier: "pay_per_use",
    estimatedCostPerTaskUsd: 0.04, tokenCostPer1kInput: 0.003, tokenCostPer1kOutput: 0.015,
    localOnly: false, requiresApiKey: true, containsRawSecret: false, containsRawPrompt: false,
  },
  "cursor": {
    adapterId: "cursor", costTier: "subscription",
    estimatedCostPerTaskUsd: null, tokenCostPer1kInput: null, tokenCostPer1kOutput: null,
    localOnly: false, requiresApiKey: false, containsRawSecret: false, containsRawPrompt: false,
  },
};

export function getAdapterCostProfile(adapterId: ToolAdapterId): AdapterCostProfile {
  return COST_PROFILES[adapterId as WellKnownAdapterId] ?? {
    adapterId, costTier: "unknown" as AdapterCostTier,
    estimatedCostPerTaskUsd: null, tokenCostPer1kInput: null, tokenCostPer1kOutput: null,
    localOnly: false, requiresApiKey: false, containsRawSecret: false, containsRawPrompt: false,
  };
}

export function getAllCostProfiles(): AdapterCostProfile[] {
  return Object.values(COST_PROFILES);
}

export function createBenchmarkEntry(
  result: ToolExecutionResult,
  taskType: string,
  tokenCountEstimate: number | null,
): CostBenchmarkEntry {
  const profile = getAdapterCostProfile(result.adapterId);
  let estimatedCostUsd: number | null = null;

  if (profile.estimatedCostPerTaskUsd !== null) {
    estimatedCostUsd = profile.estimatedCostPerTaskUsd;
  }
  if (tokenCountEstimate !== null && profile.tokenCostPer1kInput !== null) {
    estimatedCostUsd = (tokenCountEstimate / 1000) * (profile.tokenCostPer1kInput + (profile.tokenCostPer1kOutput ?? 0)) / 2;
  }

  return {
    adapterId: result.adapterId,
    taskType,
    durationMs: result.durationMs ?? 0,
    estimatedCostUsd,
    tokenCountEstimate,
    success: result.status === "executed",
    recordedAt: Date.now(),
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
    containsRawOutput: false,
  };
}

export function buildCostBenchmarkSummary(entries: CostBenchmarkEntry[]): CostBenchmarkSummary {
  const byAdapter = new Map<ToolAdapterId, CostBenchmarkEntry[]>();
  for (const e of entries) {
    const arr = byAdapter.get(e.adapterId) ?? [];
    arr.push(e);
    byAdapter.set(e.adapterId, arr);
  }

  const adapterBreakdown: CostBenchmarkSummary["adapterBreakdown"] = [];
  for (const [adapterId, adapterEntries] of byAdapter) {
    const totalCost = adapterEntries.reduce((sum, e) => sum + (e.estimatedCostUsd ?? 0), 0);
    const totalDuration = adapterEntries.reduce((sum, e) => sum + e.durationMs, 0);
    const successCount = adapterEntries.filter(e => e.success).length;
    adapterBreakdown.push({
      adapterId,
      taskCount: adapterEntries.length,
      totalCostUsd: totalCost,
      avgDurationMs: adapterEntries.length > 0 ? totalDuration / adapterEntries.length : 0,
      successRate: adapterEntries.length > 0 ? successCount / adapterEntries.length : 0,
    });
  }

  const withCost = adapterBreakdown.filter(a => a.totalCostUsd > 0);
  const withTasks = adapterBreakdown.filter(a => a.taskCount > 0);

  return {
    contract: "avorelo.costBenchmark.v1",
    entries,
    totalEstimatedCostUsd: entries.reduce((sum, e) => sum + (e.estimatedCostUsd ?? 0), 0),
    totalDurationMs: entries.reduce((sum, e) => sum + e.durationMs, 0),
    adapterBreakdown,
    cheapestAdapter: withCost.length > 0
      ? withCost.sort((a, b) => (a.totalCostUsd / a.taskCount) - (b.totalCostUsd / b.taskCount))[0].adapterId
      : null,
    fastestAdapter: withTasks.length > 0
      ? withTasks.sort((a, b) => a.avgDurationMs - b.avgDurationMs)[0].adapterId
      : null,
    mostReliableAdapter: withTasks.length > 0
      ? withTasks.sort((a, b) => b.successRate - a.successRate)[0].adapterId
      : null,
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
    containsRawOutput: false,
    modelMayDecide: false,
    scannerMayDecide: false,
    finalDecisionOwner: "kernel/stop-continue-gate",
  };
}

export function estimateTaskCost(adapterId: ToolAdapterId, tokenEstimate: number | null): number | null {
  const profile = getAdapterCostProfile(adapterId);
  if (profile.costTier === "free") return 0;
  if (profile.estimatedCostPerTaskUsd !== null && tokenEstimate === null) return profile.estimatedCostPerTaskUsd;
  if (tokenEstimate !== null && profile.tokenCostPer1kInput !== null) {
    return (tokenEstimate / 1000) * (profile.tokenCostPer1kInput + (profile.tokenCostPer1kOutput ?? 0)) / 2;
  }
  return null;
}

export function rankAdaptersByCostEfficiency(
  adapterIds: ToolAdapterId[],
  tokenEstimate: number | null,
): Array<{ adapterId: ToolAdapterId; estimatedCostUsd: number | null; costTier: AdapterCostTier }> {
  return adapterIds
    .map(id => ({
      adapterId: id,
      estimatedCostUsd: estimateTaskCost(id, tokenEstimate),
      costTier: getAdapterCostProfile(id).costTier,
    }))
    .sort((a, b) => {
      if (a.estimatedCostUsd === null && b.estimatedCostUsd === null) return 0;
      if (a.estimatedCostUsd === null) return 1;
      if (b.estimatedCostUsd === null) return -1;
      return a.estimatedCostUsd - b.estimatedCostUsd;
    });
}
