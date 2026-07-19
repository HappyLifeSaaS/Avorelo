import { randomUUID } from "node:crypto";
import type {
  ContextMemoryItem,
  ContextConflict,
  ModeDetectionResult,
  ContextBudget,
  WorkBriefData,
  PromotionResult,
} from "./types.ts";

export function compileBrief(
  items: ContextMemoryItem[],
  promotions: PromotionResult[],
  conflicts: ContextConflict[],
  mode: ModeDetectionResult,
  budget: ContextBudget,
): WorkBriefData {
  const includedSet = new Set(budget.includedItemIds);
  const included = items.filter((i) => includedSet.has(i.id));

  const constraints = included
    .filter((i) => i.type === "constraint" || i.type === "policy" || i.safety.productionImpact || i.safety.ownerOnly)
    .map((i) => i.summary);

  const facts = included
    .filter((i) => i.trust.level === "verified" || i.trust.level === "confirmed")
    .filter((i) => i.type !== "constraint" && i.type !== "policy")
    .map((i) => i.summary);

  const blockers = conflicts
    .filter((c) => c.safeDefault === "pending_verification" || c.impact.includes("Block"))
    .map((c) => `${c.type}: ${c.resolution}`);

  const risks = conflicts
    .filter((c) => c.impact.includes("might") || c.impact.includes("may"))
    .map((c) => c.impact);

  const whatNotToAssume = buildAssumptionWarnings(mode, conflicts, items);
  const requiredProof = mode.requiredProofBeforeCompletion;

  const suggestedActions = buildSuggestedActions(mode, conflicts);

  const sourceRefs = included
    .filter((i) => i.source.path || i.source.receiptId)
    .map((i) => i.source.receiptId ?? i.source.path ?? "unknown")
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 10);

  const currentWorkingTruth = [
    `This is a ${mode.detectedMode.replace(/_/g, " ")} session (confidence: ${(mode.confidence * 100).toFixed(0)}%).`,
    ...mode.safetyConstraints.map((c) => `${c}.`),
    "Old handoffs are inputs, not truth.",
    "Current branch/worktree state must be verified before completion claims.",
  ];

  return {
    schemaVersion: "1.0.0",
    briefId: `brief_${randomUUID().slice(0, 8)}`,
    generatedAt: new Date().toISOString(),
    detectedMode: mode.detectedMode,
    modeConfidence: mode.confidence,
    currentWorkingTruth,
    mustFollowConstraints: constraints.length > 0 ? constraints : mode.safetyConstraints,
    relevantFacts: facts.slice(0, 10),
    openBlockers: blockers,
    knownRisks: risks,
    whatNotToAssume,
    requiredProofBeforeCompletion: requiredProof,
    suggestedNextActions: suggestedActions,
    sourceReceiptReferences: sourceRefs,
    budget,
    conflictCount: conflicts.length,
  };
}

export function renderBriefMarkdown(brief: WorkBriefData): string {
  const lines: string[] = [
    "# Avorelo Trusted Work Brief",
    "",
    "## Current working truth",
    ...brief.currentWorkingTruth.map((t) => `- ${t}`),
    "",
    "## Detected mode",
    `- Mode: ${brief.detectedMode}`,
    `- Confidence: ${(brief.modeConfidence * 100).toFixed(0)}%`,
    "",
    "## Must-follow constraints",
    ...(brief.mustFollowConstraints.length > 0
      ? brief.mustFollowConstraints.map((c) => `- ${c}`)
      : ["- None identified."]),
    "",
    "## Relevant facts",
    ...(brief.relevantFacts.length > 0
      ? brief.relevantFacts.map((f) => `- ${f}`)
      : ["- No verified facts available."]),
    "",
    "## Open blockers",
    ...(brief.openBlockers.length > 0
      ? brief.openBlockers.map((b) => `- ${b}`)
      : ["- None."]),
    "",
    "## Known risks",
    ...(brief.knownRisks.length > 0
      ? brief.knownRisks.map((r) => `- ${r}`)
      : ["- None identified."]),
    "",
    "## What not to assume",
    ...brief.whatNotToAssume.map((w) => `- ${w}`),
    "",
    "## Required proof before completion",
    ...brief.requiredProofBeforeCompletion.map((p) => `- ${p}`),
    "",
    "## Suggested next safe actions",
    ...brief.suggestedNextActions.map((a) => `- ${a}`),
    "",
    "## Source receipt references",
    ...(brief.sourceReceiptReferences.length > 0
      ? brief.sourceReceiptReferences.map((r) => `- ${r}`)
      : ["- No receipts referenced."]),
    "",
    `---`,
    `Brief ID: ${brief.briefId}`,
    `Generated: ${brief.generatedAt}`,
    `Conflicts: ${brief.conflictCount}`,
    `Items included: ${brief.budget.includedItemIds.length}`,
    `Items excluded: ${brief.budget.excludedItemIds.length}`,
  ];

  return lines.join("\n");
}

function buildAssumptionWarnings(
  mode: ModeDetectionResult,
  conflicts: ContextConflict[],
  _items: ContextMemoryItem[],
): string[] {
  const warnings: string[] = [
    "Do not assume a previous 'ready' or 'done' claim is still valid without current receipt evidence.",
  ];

  if (mode.detectedMode !== "production_release") {
    warnings.push("Do not assume this session has production deploy authority.");
  }

  warnings.push("Do not assume dashboard connection means receipt history is complete.");

  if (conflicts.length > 0) {
    warnings.push(`${conflicts.length} context conflict(s) exist — resolve or acknowledge before claiming completion.`);
  }

  if (mode.blockedContextClasses.length > 0) {
    warnings.push(`Blocked context classes: ${mode.blockedContextClasses.join(", ")}.`);
  }

  return warnings;
}

function buildSuggestedActions(mode: ModeDetectionResult, conflicts: ContextConflict[]): string[] {
  const actions: string[] = [];

  if (mode.requiredProofBeforeCompletion.includes("targeted tests")) {
    actions.push("Run targeted tests for changed code.");
  }
  if (mode.requiredProofBeforeCompletion.includes("receipt generated")) {
    actions.push("Generate Avorelo receipt after verification.");
  }
  if (conflicts.length > 0) {
    actions.push("Review and acknowledge context conflicts.");
  }
  actions.push("Verify clean worktree before completion.");

  return actions;
}
