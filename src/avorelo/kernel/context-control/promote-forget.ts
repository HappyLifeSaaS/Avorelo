import { randomUUID } from "node:crypto";
import { loadItems, storeItems, storeContextReceipt } from "./storage.ts";
import { evaluatePromotion } from "./promotion.ts";
import { scoreTrust } from "./trust.ts";
import type { ContextMemoryItem, PromotionResult, ContextReceipt } from "./types.ts";

export interface PromoteRequest {
  itemId: string;
  reason: string;
  evidenceIds?: string[];
}

export interface PromoteResult {
  ok: boolean;
  itemId: string;
  previousStatus: string;
  newStatus: string;
  decision: string;
  reason: string;
  receiptId: string;
}

export interface ForgetRequest {
  itemId: string;
  reason: string;
  supersededBy?: string;
}

export interface ForgetResult {
  ok: boolean;
  itemId: string;
  previousStatus: string;
  newStatus: string;
  reason: string;
  receiptId: string;
}

export function promoteItem(repoRoot: string, request: PromoteRequest): PromoteResult {
  const items = loadItems(repoRoot);
  const idx = items.findIndex((i) => i.id === request.itemId);

  if (idx === -1) {
    const receiptId = createPromoteForgetReceipt(repoRoot, "promote_attempt", request.itemId, "not_found", "not_found", `Item ${request.itemId} not found.`);
    return { ok: false, itemId: request.itemId, previousStatus: "not_found", newStatus: "not_found", decision: "reject", reason: `Item ${request.itemId} not found.`, receiptId };
  }

  const item = items[idx];
  const previousStatus = item.lifecycle.status;

  if (item.safety.containsSecret) {
    const receiptId = createPromoteForgetReceipt(repoRoot, "promote_attempt", request.itemId, previousStatus, previousStatus, "Cannot promote: item contains secrets.");
    return { ok: false, itemId: request.itemId, previousStatus, newStatus: previousStatus, decision: "reject", reason: "Cannot promote: item contains secrets.", receiptId };
  }

  const trustScore = scoreTrust(item);
  if (trustScore.trustLevel === "unsafe") {
    const receiptId = createPromoteForgetReceipt(repoRoot, "promote_attempt", request.itemId, previousStatus, previousStatus, "Cannot promote: trust level is unsafe.");
    return { ok: false, itemId: request.itemId, previousStatus, newStatus: previousStatus, decision: "reject", reason: "Cannot promote: trust level is unsafe.", receiptId };
  }

  const promo = evaluatePromotion(item);
  if (promo.decision === "mark_unsafe") {
    const receiptId = createPromoteForgetReceipt(repoRoot, "promote_attempt", request.itemId, previousStatus, previousStatus, `Cannot promote: ${promo.reason}`);
    return { ok: false, itemId: request.itemId, previousStatus, newStatus: previousStatus, decision: "reject", reason: `Cannot promote: ${promo.reason}`, receiptId };
  }

  const readyClaims = /\b(?:production[- ]?ready|deployed|shipped)\b/i;
  if (readyClaims.test(item.summary) && (!request.evidenceIds || request.evidenceIds.length === 0)) {
    const receiptId = createPromoteForgetReceipt(repoRoot, "promote_attempt", request.itemId, previousStatus, previousStatus, "Cannot promote production/deploy claims without evidence receipt IDs.");
    return { ok: false, itemId: request.itemId, previousStatus, newStatus: previousStatus, decision: "reject", reason: "Cannot promote production/deploy claims without evidence receipt IDs.", receiptId };
  }

  const newStatus = "promoted";
  items[idx] = {
    ...item,
    lifecycle: { ...item.lifecycle, status: newStatus, promotedAt: new Date().toISOString(), promotionReason: request.reason },
    trust: {
      ...item.trust,
      level: request.evidenceIds && request.evidenceIds.length > 0 ? "verified" : "confirmed",
      evidenceIds: [...item.trust.evidenceIds, ...(request.evidenceIds ?? [])],
    },
  };
  storeItems(repoRoot, items);

  const receiptId = createPromoteForgetReceipt(repoRoot, "context_promote", request.itemId, previousStatus, newStatus, request.reason);
  return { ok: true, itemId: request.itemId, previousStatus, newStatus, decision: "promote", reason: request.reason, receiptId };
}

export function forgetItem(repoRoot: string, request: ForgetRequest): ForgetResult {
  const items = loadItems(repoRoot);
  const idx = items.findIndex((i) => i.id === request.itemId);

  if (idx === -1) {
    const receiptId = createPromoteForgetReceipt(repoRoot, "forget_attempt", request.itemId, "not_found", "not_found", `Item ${request.itemId} not found.`);
    return { ok: false, itemId: request.itemId, previousStatus: "not_found", newStatus: "not_found", reason: `Item ${request.itemId} not found.`, receiptId };
  }

  const item = items[idx];
  const previousStatus = item.lifecycle.status;
  const newStatus = request.supersededBy ? "superseded" : "forgotten";

  items[idx] = {
    ...item,
    lifecycle: {
      ...item.lifecycle,
      status: newStatus,
      forgottenAt: new Date().toISOString(),
      forgetReason: request.reason,
      ...(request.supersededBy ? { supersededBy: request.supersededBy } : {}),
    },
    safety: { ...item.safety, agentVisible: false },
  };
  storeItems(repoRoot, items);

  const receiptId = createPromoteForgetReceipt(repoRoot, "context_forget", request.itemId, previousStatus, newStatus, request.reason);
  return { ok: true, itemId: request.itemId, previousStatus, newStatus, reason: request.reason, receiptId };
}

function createPromoteForgetReceipt(
  repoRoot: string,
  action: string,
  itemId: string,
  previousStatus: string,
  newStatus: string,
  reason: string,
): string {
  const receipt: ContextReceipt = {
    schemaVersion: "1.0.0",
    type: "agent_context_decision_receipt",
    receiptId: `receipt_${randomUUID().slice(0, 12)}`,
    createdAt: new Date().toISOString(),
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
    contentStored: false,
    action,
    decision: action.includes("forget") ? "allow" : (newStatus === previousStatus ? "block" : "allow"),
    reason: `${action}: item=${itemId} prev=${previousStatus} new=${newStatus} — ${reason}`,
    mode: "unknown",
    evidenceIds: [],
  };
  const path = storeContextReceipt(repoRoot, receipt);
  return receipt.receiptId;
}
