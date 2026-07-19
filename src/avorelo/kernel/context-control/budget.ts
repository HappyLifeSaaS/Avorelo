import type { ContextMemoryItem, ContextBudget, PromotionResult } from "./types.ts";

const DEFAULT_MAX_TOKENS = 1800;
const DEFAULT_RESERVED = {
  safetyConstraints: 400,
  verifiedFacts: 400,
  blockersConflicts: 350,
  requiredProof: 250,
  modeState: 200,
  recentDecisions: 200,
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function allocateBudget(
  promotedItems: ContextMemoryItem[],
  promotions: PromotionResult[],
  conflictCount: number,
  maxTokens: number = DEFAULT_MAX_TOKENS,
): ContextBudget {
  const promotedIds = new Set(
    promotions
      .filter((p) => p.decision === "promote")
      .map((p) => p.itemId),
  );

  const included: string[] = [];
  const excluded: string[] = [];
  const exclusionReasons: Record<string, string> = {};
  let usedTokens = 0;

  const safetyItems = promotedItems.filter(
    (i) => promotedIds.has(i.id) && (i.type === "constraint" || i.type === "policy" || i.safety.productionImpact || i.safety.ownerOnly),
  );
  const verifiedFacts = promotedItems.filter(
    (i) => promotedIds.has(i.id) && i.trust.level === "verified" && !safetyItems.includes(i),
  );
  const proofItems = promotedItems.filter(
    (i) => promotedIds.has(i.id) && i.type === "proof" && !safetyItems.includes(i) && !verifiedFacts.includes(i),
  );
  const stateItems = promotedItems.filter(
    (i) => promotedIds.has(i.id) && (i.type === "workstream_state" || i.type === "release_state") && !safetyItems.includes(i) && !verifiedFacts.includes(i) && !proofItems.includes(i),
  );
  const otherItems = promotedItems.filter(
    (i) => promotedIds.has(i.id) && !safetyItems.includes(i) && !verifiedFacts.includes(i) && !proofItems.includes(i) && !stateItems.includes(i),
  );

  const tiers = [
    { items: safetyItems, budget: DEFAULT_RESERVED.safetyConstraints },
    { items: verifiedFacts, budget: DEFAULT_RESERVED.verifiedFacts },
    { items: proofItems, budget: DEFAULT_RESERVED.blockersConflicts },
    { items: stateItems, budget: DEFAULT_RESERVED.modeState },
    { items: otherItems, budget: DEFAULT_RESERVED.recentDecisions },
  ];

  for (const tier of tiers) {
    let tierUsed = 0;
    for (const item of tier.items) {
      const tokens = estimateTokens(item.summary);
      if (usedTokens + tokens <= maxTokens && tierUsed + tokens <= tier.budget) {
        included.push(item.id);
        usedTokens += tokens;
        tierUsed += tokens;
      } else {
        excluded.push(item.id);
        exclusionReasons[item.id] = "exceeded_budget";
      }
    }
  }

  for (const item of promotedItems) {
    if (!promotedIds.has(item.id) && !excluded.includes(item.id)) {
      excluded.push(item.id);
      exclusionReasons[item.id] = "not_promoted";
    }
  }

  return {
    schemaVersion: "1.0.0",
    maxApproxTokens: maxTokens,
    reserved: DEFAULT_RESERVED,
    includedItemIds: included,
    excludedItemIds: excluded,
    exclusionReasons,
  };
}
