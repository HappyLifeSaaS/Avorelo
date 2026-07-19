import type { ContextMemoryItem, TrustScore, FreshnessScore } from "./types.ts";

export function scoreTrust(item: ContextMemoryItem): TrustScore {
  if (item.safety.containsSecret) {
    return {
      itemId: item.id,
      trustLevel: "unsafe",
      confidence: 1.0,
      reason: "Contains secret content — excluded from agent context",
      evidenceIds: [],
    };
  }

  if (item.safety.redactionRequired) {
    return {
      itemId: item.id,
      trustLevel: "unsafe",
      confidence: 0.95,
      reason: "Requires redaction — unsafe for direct use",
      evidenceIds: [],
    };
  }

  if (item.source.kind === "receipt" && item.source.receiptId) {
    return {
      itemId: item.id,
      trustLevel: "verified",
      confidence: 0.95,
      reason: "Backed by receipt evidence",
      evidenceIds: [item.source.receiptId],
    };
  }

  if (item.source.kind === "receipt") {
    return {
      itemId: item.id,
      trustLevel: "verified",
      confidence: 0.9,
      reason: "Receipt-sourced evidence",
      evidenceIds: item.trust.evidenceIds,
    };
  }

  if (item.source.kind === "git") {
    return {
      itemId: item.id,
      trustLevel: "verified",
      confidence: 0.9,
      reason: "Derived from current git state",
      evidenceIds: item.trust.evidenceIds,
    };
  }

  if (item.source.kind === "policy") {
    return {
      itemId: item.id,
      trustLevel: "confirmed",
      confidence: 0.9,
      reason: "Explicit policy document",
      evidenceIds: [],
    };
  }

  if (item.source.kind === "dashboard_state") {
    return {
      itemId: item.id,
      trustLevel: "confirmed",
      confidence: 0.8,
      reason: "Dashboard/activation state",
      evidenceIds: [],
    };
  }

  if (item.type === "instruction" && item.source.kind === "file") {
    return {
      itemId: item.id,
      trustLevel: "confirmed",
      confidence: 0.8,
      reason: "Project instruction file",
      evidenceIds: [],
    };
  }

  if (item.source.kind === "external") {
    return {
      itemId: item.id,
      trustLevel: "unverified",
      confidence: 0.3,
      reason: "External source — not independently verified",
      evidenceIds: [],
    };
  }

  return {
    itemId: item.id,
    trustLevel: item.trust.level,
    confidence: item.trust.confidence,
    reason: item.trust.reason,
    evidenceIds: item.trust.evidenceIds,
  };
}

export function scoreFreshness(item: ContextMemoryItem): FreshnessScore {
  const ts = item.freshness.lastVerifiedAt ?? item.source.timestamp ?? null;

  if (!ts) {
    return {
      itemId: item.id,
      freshnessStatus: "unknown",
      lastVerifiedAt: null,
      expiresAt: null,
      reason: "No timestamp available",
    };
  }

  const age = Date.now() - new Date(ts).getTime();
  const oneHour = 3_600_000;
  const oneDay = 86_400_000;
  const oneWeek = 7 * oneDay;
  const oneMonth = 30 * oneDay;

  if (age < oneHour) {
    return { itemId: item.id, freshnessStatus: "current", lastVerifiedAt: ts, expiresAt: null, reason: "Verified within the last hour" };
  }
  if (age < oneDay) {
    return { itemId: item.id, freshnessStatus: "current", lastVerifiedAt: ts, expiresAt: null, reason: "Verified today" };
  }
  if (age < oneWeek) {
    return { itemId: item.id, freshnessStatus: "recent", lastVerifiedAt: ts, expiresAt: null, reason: "Verified within the last week" };
  }
  if (age < oneMonth) {
    return { itemId: item.id, freshnessStatus: "stale", lastVerifiedAt: ts, expiresAt: null, reason: "Over a week old — may be outdated" };
  }

  return { itemId: item.id, freshnessStatus: "expired", lastVerifiedAt: ts, expiresAt: null, reason: "Over a month old — likely outdated" };
}

export function trustBeats(a: TrustScore, b: TrustScore): boolean {
  const order: Record<string, number> = {
    verified: 5,
    confirmed: 4,
    inferred: 3,
    unverified: 2,
    contradicted: 1,
    unsafe: 0,
  };
  if (order[a.trustLevel] !== order[b.trustLevel]) {
    return order[a.trustLevel] > order[b.trustLevel];
  }
  return a.confidence > b.confidence;
}
