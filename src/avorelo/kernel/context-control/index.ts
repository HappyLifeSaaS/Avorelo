export type {
  ContextSourceKind,
  ContextItemType,
  TrustLevel,
  FreshnessStatus,
  LifecycleStatus,
  PromotionDecision,
  WorkMode,
  ConflictType,
  DiscoveredSource,
  DiscoveryResult,
  ContextMemoryItem,
  PromotionResult,
  TrustScore,
  FreshnessScore,
  ContextConflict,
  ModeDetectionResult,
  ContextBudget,
  WorkBriefData,
  ContextReceiptType,
  ContextReceipt,
  WorkBriefReceipt,
  ContextExclusionReceipt,
  AgentContextDecisionReceipt,
  MemoryPromotionReceipt,
  ContextConflictReceipt,
  DashboardContextState,
} from "./types.ts";

export { discoverContextSources } from "./discovery.ts";
export { normalizeSource } from "./normalization.ts";
export { scoreTrust, scoreFreshness, trustBeats } from "./trust.ts";
export { evaluatePromotion, evaluatePromotions } from "./promotion.ts";
export { detectConflicts } from "./conflicts.ts";
export { detectWorkMode } from "./mode-detection.ts";
export { allocateBudget } from "./budget.ts";
export { compileBrief, renderBriefMarkdown } from "./brief-compiler.ts";
export { containsSecret, redactText, redactLines, isSensitivePath } from "./redaction.ts";
export { evaluateAgentAction, evaluateCompletionClaim } from "./agent-guard.ts";
export type { GuardDecision } from "./agent-guard.ts";

export { promoteItem, forgetItem } from "./promote-forget.ts";
export type { PromoteRequest, PromoteResult, ForgetRequest, ForgetResult } from "./promote-forget.ts";

export { runRepoPreflight, formatPreflightResult } from "./repo-preflight.ts";
export type { RepoPreflightResult } from "./repo-preflight.ts";

export {
  createWorkBriefReceipt,
  createExclusionReceipt,
  createAgentDecisionReceipt,
  createPromotionReceipt,
  createConflictReceipt,
} from "./receipts.ts";

export {
  storeDiscovery,
  storeItems,
  loadItems,
  storeConflicts,
  loadConflicts,
  storeMode,
  loadMode,
  storeBrief,
  loadLatestBrief,
  storeContextReceipt,
  loadLatestContextReceipt,
  storeDashboardState,
  buildDashboardState,
} from "./storage.ts";

import { existsSync } from "node:fs";
import { join } from "node:path";
import { discoverContextSources } from "./discovery.ts";
import { normalizeSource } from "./normalization.ts";
import { evaluatePromotions } from "./promotion.ts";
import { detectConflicts } from "./conflicts.ts";
import { detectWorkMode } from "./mode-detection.ts";
import { allocateBudget } from "./budget.ts";
import { compileBrief, renderBriefMarkdown } from "./brief-compiler.ts";
import {
  createWorkBriefReceipt,
  createExclusionReceipt,
  createPromotionReceipt,
  createConflictReceipt,
} from "./receipts.ts";
import {
  storeDiscovery,
  storeItems,
  storeConflicts,
  storeMode,
  storeBrief,
  storeContextReceipt,
  storeDashboardState,
  buildDashboardState,
  loadLatestContextReceipt,
} from "./storage.ts";
import type {
  WorkBriefData,
  ModeDetectionResult,
  ContextConflict,
  ContextMemoryItem,
  PromotionResult,
  WorkBriefReceipt,
} from "./types.ts";

export interface GenerateBriefResult {
  brief: WorkBriefData;
  briefMarkdown: string;
  briefPath: string;
  receiptPath: string;
  receipt: WorkBriefReceipt;
  mode: ModeDetectionResult;
  conflicts: ContextConflict[];
  items: ContextMemoryItem[];
  promotions: PromotionResult[];
  sourceCount: number;
  candidateCount: number;
  redactionsApplied: number;
}

export function generateBrief(
  repoRoot: string,
  options?: {
    branchName?: string;
    changedFiles?: string[];
    taskText?: string;
    commands?: string[];
  },
): GenerateBriefResult {
  const discovery = discoverContextSources(repoRoot);
  storeDiscovery(repoRoot, discovery);

  const items: ContextMemoryItem[] = [];
  for (const source of discovery.sources) {
    items.push(...normalizeSource(repoRoot, source, options?.branchName));
  }
  storeItems(repoRoot, items);

  const promotions = evaluatePromotions(items);

  const promotionReceipt = createPromotionReceipt(promotions);
  storeContextReceipt(repoRoot, promotionReceipt);

  for (let i = 0; i < items.length; i++) {
    const promo = promotions[i];
    if (promo) {
      items[i] = { ...items[i], lifecycle: { ...items[i].lifecycle, status: promo.resultingLifecycleStatus } };
    }
  }

  const conflicts = detectConflicts(items);
  storeConflicts(repoRoot, conflicts);

  if (conflicts.length > 0) {
    const conflictReceipt = createConflictReceipt(conflicts);
    storeContextReceipt(repoRoot, conflictReceipt);
  }

  const hasActivation = existsSync(join(repoRoot, ".avorelo", "activation", "activation-state.json"));
  const mode = detectWorkMode({
    branchName: options?.branchName,
    changedFiles: options?.changedFiles,
    taskText: options?.taskText,
    commands: options?.commands,
    hasActivationState: hasActivation,
  });
  storeMode(repoRoot, mode);

  const budget = allocateBudget(items, promotions, conflicts.length);

  const excluded = promotions
    .filter((p) => p.decision !== "promote")
    .map((p) => ({
      itemId: p.itemId,
      reason: p.reason,
      safeDefault: p.safeForAgent ? "include_if_needed" : "exclude_from_agent_brief",
    }));

  if (excluded.length > 0) {
    const exclusionReceipt = createExclusionReceipt(excluded);
    storeContextReceipt(repoRoot, exclusionReceipt);
  }

  const brief = compileBrief(items, promotions, conflicts, mode, budget);
  const briefMarkdown = renderBriefMarkdown(brief);
  const { latestPath } = storeBrief(repoRoot, briefMarkdown);

  const latestReceipt = loadLatestContextReceipt(repoRoot);
  const dashState = buildDashboardState(
    mode.detectedMode,
    mode.confidence,
    latestPath,
    latestReceipt?.receiptId ?? null,
    conflicts.map((c) => c.resolution),
    conflicts.map((c) => c.type),
    latestReceipt === null,
  );
  storeDashboardState(repoRoot, dashState);

  const receipt = createWorkBriefReceipt(
    brief,
    latestPath,
    discovery.sources.length,
    items.length,
    discovery.redactionsApplied,
  );
  const receiptPath = storeContextReceipt(repoRoot, receipt);

  return {
    brief,
    briefMarkdown,
    briefPath: latestPath,
    receiptPath,
    receipt,
    mode,
    conflicts,
    items,
    promotions,
    sourceCount: discovery.sources.length,
    candidateCount: items.length,
    redactionsApplied: discovery.redactionsApplied,
  };
}
