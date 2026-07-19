import { randomUUID } from "node:crypto";
import type {
  WorkBriefReceipt,
  ContextExclusionReceipt,
  AgentContextDecisionReceipt,
  MemoryPromotionReceipt,
  ContextConflictReceipt,
  ContextReceipt,
  WorkBriefData,
  PromotionResult,
  ContextConflict,
  WorkMode,
} from "./types.ts";

function baseReceipt(type: ContextReceipt["type"]): ContextReceipt {
  return {
    schemaVersion: "1.0.0",
    type,
    receiptId: `receipt_${randomUUID().slice(0, 12)}`,
    createdAt: new Date().toISOString(),
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
    contentStored: false,
  };
}

export function createWorkBriefReceipt(
  brief: WorkBriefData,
  briefPath: string,
  sourceCount: number,
  candidateCount: number,
  redactionsApplied: number,
): WorkBriefReceipt {
  return {
    ...baseReceipt("work_brief_receipt"),
    type: "work_brief_receipt",
    briefId: brief.briefId,
    briefPath,
    detectedMode: brief.detectedMode,
    modeConfidence: brief.modeConfidence,
    sourceCount,
    candidateItemCount: candidateCount,
    includedItemCount: brief.budget.includedItemIds.length,
    excludedItemCount: brief.budget.excludedItemIds.length,
    conflictCount: brief.conflictCount,
    safetyConstraintsIncluded: brief.mustFollowConstraints.length > 0,
    redactionsApplied,
    safeForAgent: true,
    evidenceIds: [],
    decisionSummary: "Generated safe task-specific working truth from verified local context.",
  };
}

export function createExclusionReceipt(
  excludedItems: Array<{ itemId: string; reason: string; safeDefault: string }>,
): ContextExclusionReceipt {
  return {
    ...baseReceipt("context_exclusion_receipt"),
    type: "context_exclusion_receipt",
    excludedItems,
  };
}

export function createAgentDecisionReceipt(
  action: string,
  decision: "block" | "allow" | "downgrade",
  reason: string,
  mode: WorkMode,
): AgentContextDecisionReceipt {
  return {
    ...baseReceipt("agent_context_decision_receipt"),
    type: "agent_context_decision_receipt",
    action,
    decision,
    reason,
    mode,
    evidenceIds: [],
  };
}

export function createPromotionReceipt(promotions: PromotionResult[]): MemoryPromotionReceipt {
  return {
    ...baseReceipt("memory_promotion_receipt"),
    type: "memory_promotion_receipt",
    promotions,
  };
}

export function createConflictReceipt(conflicts: ContextConflict[]): ContextConflictReceipt {
  return {
    ...baseReceipt("context_conflict_receipt"),
    type: "context_conflict_receipt",
    conflicts,
  };
}
