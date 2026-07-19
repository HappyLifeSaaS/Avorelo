import { randomUUID } from "node:crypto";
import type { ContextMemoryItem, PromotionResult, PromotionDecision, LifecycleStatus } from "./types.ts";
import { scoreTrust, scoreFreshness } from "./trust.ts";

const UNVERIFIED_READY_PATTERNS = [
  /production[- ]?ready/i,
  /deployed to production/i,
  /live in production/i,
  /verified and complete/i,
  /npm published/i,
];

export function evaluatePromotion(item: ContextMemoryItem): PromotionResult {
  const trust = scoreTrust(item);
  const freshness = scoreFreshness(item);

  if (item.safety.containsSecret || item.safety.redactionRequired) {
    return makeResult(item.id, "mark_unsafe", "Secret or sensitive content detected — excluded from agent context", [], "candidate", false);
  }

  if (trust.trustLevel === "unsafe") {
    return makeResult(item.id, "mark_unsafe", trust.reason, [], "candidate", false);
  }

  if (item.source.kind === "external" && trust.trustLevel === "unverified") {
    return makeResult(item.id, "mark_unverified", "External source not verified — cannot promote automatically", [], "candidate", false);
  }

  const summaryLower = item.summary.toLowerCase();
  const hasUnverifiedReadyClaim = UNVERIFIED_READY_PATTERNS.some((p) => p.test(summaryLower));
  if (hasUnverifiedReadyClaim && trust.trustLevel !== "verified") {
    return makeResult(
      item.id,
      "reject",
      "Claims readiness/production/deployment without verified receipt evidence",
      [],
      "candidate",
      false,
    );
  }

  if (freshness.freshnessStatus === "expired") {
    return makeResult(item.id, "reject", `Expired content (${freshness.reason}) — not promoted`, [], "candidate", false);
  }

  if (freshness.freshnessStatus === "stale" && trust.trustLevel !== "verified") {
    return makeResult(item.id, "mark_unverified", `Stale and unverified — needs re-verification`, [], "candidate", false);
  }

  if (trust.trustLevel === "contradicted") {
    return makeResult(item.id, "reject", "Contradicted by stronger evidence", [], "candidate", false);
  }

  if (trust.trustLevel === "verified" || trust.trustLevel === "confirmed") {
    return makeResult(item.id, "promote", trust.reason, trust.evidenceIds, "promoted", true);
  }

  if (trust.trustLevel === "inferred" && (freshness.freshnessStatus === "current" || freshness.freshnessStatus === "recent")) {
    return makeResult(item.id, "promote", `Inferred but current — promoted with lower confidence`, trust.evidenceIds, "promoted", true);
  }

  return makeResult(item.id, "mark_unverified", "Insufficient evidence for automatic promotion", [], "candidate", false);
}

export function evaluatePromotions(items: ContextMemoryItem[]): PromotionResult[] {
  return items.map(evaluatePromotion);
}

function makeResult(
  itemId: string,
  decision: PromotionDecision,
  reason: string,
  evidenceIds: string[],
  lifecycle: LifecycleStatus,
  safeForAgent: boolean,
): PromotionResult {
  return {
    schemaVersion: "1.0.0",
    decisionId: `promotion_${randomUUID().slice(0, 8)}`,
    itemId,
    decision,
    reason,
    evidenceIds,
    resultingLifecycleStatus: lifecycle,
    safeForAgent,
  };
}
