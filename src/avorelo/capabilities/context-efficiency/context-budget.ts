import type { ContextPacket } from "../../shared/schemas/index.ts";

import type { ContextEfficiencyBrief, ContextEfficiencyPathRecommendation } from "./types.ts";
import type { WorkspaceMapCompatClassification } from "./workspace-map-compat.ts";

type BuildContextPlanInput = {
  packet: ContextPacket | null;
  sourceOfTruth: ContextEfficiencyPathRecommendation[];
  summarized: ContextEfficiencyPathRecommendation[];
  excluded: ContextEfficiencyPathRecommendation[];
  deferred: ContextEfficiencyPathRecommendation[];
  gated: ContextEfficiencyPathRecommendation[];
};

function dedupe(items: ContextEfficiencyPathRecommendation[]): ContextEfficiencyPathRecommendation[] {
  const seen = new Set<string>();
  const result: ContextEfficiencyPathRecommendation[] = [];
  for (const item of items) {
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    result.push(item);
  }
  return result;
}

export function buildContextPlan(input: BuildContextPlanInput): ContextEfficiencyBrief["contextPlan"] {
  const selected = input.packet?.selectedRefs ?? [];
  const deferredSourceOfTruth = input.sourceOfTruth
    .slice(4)
    .map((item) => ({ ...item, recommendation: "defer_until_needed" as const, summary: "Keep lower-priority source-of-truth paths out of the first context pass." }));
  const packetSummary = selected
    .filter((ref) => ref.includeMode === "summary" || ref.includeMode === "path_only")
    .map((ref) => ({
      path: ref.label,
      recommendation: "summarize" as const,
      summary: ref.safety === "sensitive" ? "Sensitive path should stay summarized only." : "Context can stay summarized until directly needed.",
      reasonCode: "CONTEXT_EFFICIENCY_CONTEXT_BUDGET_APPLIED",
      tags: [`kind:${ref.kind}`, `authority:${ref.authority}`, `safety:${ref.safety}`],
    }));
  const packetDeferred = selected
    .slice(4)
    .map((ref) => ({
      path: ref.label,
      recommendation: "defer_until_needed" as const,
      summary: "Lower-priority context can wait until the task proves it is needed.",
      reasonCode: "CONTEXT_EFFICIENCY_CONTEXT_BUDGET_APPLIED",
      tags: [`kind:${ref.kind}`, `authority:${ref.authority}`, `safety:${ref.safety}`],
    }));

  return {
    include: dedupe(input.sourceOfTruth).slice(0, 4),
    summarize: dedupe([...input.summarized, ...packetSummary]).slice(0, 8),
    exclude: dedupe(input.excluded).slice(0, 8),
    deferUntilNeeded: dedupe([...deferredSourceOfTruth, ...input.deferred, ...packetDeferred]).slice(0, 8),
    requiresUserConfirmation: dedupe(input.gated).slice(0, 8),
  };
}

export function toSummaryRecommendation(classification: WorkspaceMapCompatClassification): ContextEfficiencyPathRecommendation {
  return {
    path: classification.normalizedPath,
    recommendation: "summarize",
    summary: classification.summary,
    reasonCode: "CONTEXT_EFFICIENCY_CONTEXT_BUDGET_APPLIED",
    tags: classification.tags,
  };
}
