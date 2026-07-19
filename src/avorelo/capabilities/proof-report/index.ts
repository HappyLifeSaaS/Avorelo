// Avorelo Proof & Savings Report v1 (Phase 7, Layer 4). Deterministic, local-first, redacted.
// A compact, honest report of what Avorelo did + what evidence exists. Consumes Phase 6 token/cost evidence
// and Phase 2-5 metadata; it does NOT reimplement them. SAVINGS ARE REFUSED unless backed by eligible
// comparative evidence — and Phase 6 evidence is non-comparative, so v1 always refuses savings (cost summary
// is still shown when measured/imported evidence exists). unavailable != zero != savings.

import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { redactString } from "../secret-boundary/redactor.ts";
import { classifyPayload } from "../../shared/redaction/policy.ts";
import { validateReceiptSafety } from "../../kernel/receipts/validation.ts";
import { evaluateReceiptSafety } from "../../kernel/receipts/eligibility.ts";
import { summarizeTokenCostEvidence, loadTokenCostEvidence } from "../token-cost-evidence/index.ts";
import { loadLatestContinuity } from "../continuity/index.ts";
import type {
  ProofReport,
  ProofReportItem,
  ProofReportScope,
  ProofReportSavingsSection,
  ProofReportSyncMetadata,
  ProofItemStatus,
  TokenCostEvidence,
  EvidenceConfidence,
} from "../../shared/schemas/index.ts";

const rs = (s: string) => redactString(String(s ?? ""), "handoff", "report").redacted;
// Defense in depth: redact secrets, then if the policy still flags unsafe content (git diff / terminal log /
// env value / sensitive path), replace the whole string with a safe placeholder rather than leak it.
function safeText(s: string): string {
  const red = rs(s);
  return classifyPayload({ s: red }).safe ? red : "[redacted: unsafe content removed]";
}

export type ProofReportInput = {
  scope?: ProofReportScope;
  createdAt?: string;
  relatedIds?: ProofReport["relatedIds"];
  tokenCostEvidence?: TokenCostEvidence[];
  // Phase 2-5 are consumed as safe METADATA, never raw artifacts.
  secretBoundary?: { codes?: string[]; protectedCount?: number } | null;
  continuity?: { continuityPacketId?: string; proofMissing?: string[]; openQuestions?: string[]; safeNextActions?: string[]; route?: string; riskClass?: string; proofTier?: string } | null;
  context?: { contextPacketId?: string; budget?: string; selectedCount?: number; route?: string } | null;
  found?: Partial<ProofReportItem>[];
  verified?: Partial<ProofReportItem>[];
  needsAttention?: Partial<ProofReportItem>[];
};

function item(code: string, title: string, status: ProofItemStatus, summary: string, confidence: EvidenceConfidence = "unavailable", evidenceIds: string[] = []): ProofReportItem {
  return { code, title: safeText(title), status, confidence, evidenceIds, summary: safeText(summary) };
}

/**
 * Build the savings section. v1 REFUSES savings (Phase 6 evidence is non-comparative). A cost summary is
 * shown only from measured/imported cost evidence. Estimated/inferred/unavailable never become savings.
 */
function buildSavingsSection(summary: ReturnType<typeof summarizeTokenCostEvidence>, evidenceCount: number): ProofReportSavingsSection {
  const canShowCostSummary = (summary.measuredCount + summary.importedCount) > 0;
  const costConfidence: EvidenceConfidence = summary.measuredCount > 0 ? "measured" : summary.importedCount > 0 ? "imported" : "unavailable";
  const refusalReason = evidenceCount === 0 ? "no_token_cost_evidence" : "no_comparative_evidence_baseline_vs_current";
  return {
    canShowSavings: false, // v1: no comparative evidence type exists yet
    refusalReason,
    costSummary: canShowCostSummary
      ? { totalCost: summary.totalCost, currency: summary.currency, confidence: costConfidence, mixedCurrency: summary.mixedCurrency }
      : { totalCost: null, currency: null, confidence: "unavailable", mixedCurrency: summary.mixedCurrency },
    savingsAmount: null, // NEVER zero when unavailable
    savingsCurrency: null,
    savingsConfidence: "unavailable",
    savingsClaimAllowed: false,
  };
}

export function buildProofReport(input: ProofReportInput): ProofReport {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const tce = input.tokenCostEvidence ?? [];
  const summary = summarizeTokenCostEvidence(tce);

  const protectedItems: ProofReportItem[] = [];
  const found: ProofReportItem[] = (input.found ?? []).map((f) => item(f.code ?? "FOUND", f.title ?? "Found", "found", f.summary ?? "", f.confidence ?? "unavailable", f.evidenceIds ?? []));
  const verified: ProofReportItem[] = (input.verified ?? []).map((f) => item(f.code ?? "VERIFIED", f.title ?? "Verified", "verified", f.summary ?? "", f.confidence ?? "measured", f.evidenceIds ?? []));
  const fixedOrPrepared: ProofReportItem[] = [];
  const needsAttention: ProofReportItem[] = [];
  const next: ProofReportItem[] = [];

  // Secret Boundary → protected (codes/counts only).
  if (input.secretBoundary && (input.secretBoundary.protectedCount || (input.secretBoundary.codes ?? []).length)) {
    const codes = input.secretBoundary.codes ?? [];
    protectedItems.push(item("SECRET_BOUNDARY_PROTECTED", "Secret Boundary protected", "protected", `${input.secretBoundary.protectedCount ?? codes.length} item(s) protected: ${codes.join(", ") || "n/a"}`, "measured"));
  }

  // Context Compiler → prepared (no selectedRefs/source).
  if (input.context && (input.context.contextPacketId || input.context.selectedCount != null)) {
    fixedOrPrepared.push(item("CONTEXT_PREPARED", "Context prepared", "prepared", `bounded context ${input.context.budget ?? ""} (${input.context.selectedCount ?? 0} ref(s))`, "inferred", input.context.contextPacketId ? [input.context.contextPacketId] : []));
  }

  // Continuity → needsAttention (proof gaps / open questions) + next (safe next actions).
  if (input.continuity) {
    for (const p of input.continuity.proofMissing ?? []) needsAttention.push(item("PROOF_GAP", "Proof gap", "needs_attention", p, "unavailable"));
    for (const q of input.continuity.openQuestions ?? []) needsAttention.push(item("OPEN_QUESTION", "Open question", "needs_attention", q, "unavailable"));
    for (const a of input.continuity.safeNextActions ?? []) next.push(item("NEXT_ACTION", "Safe next action", "next", a, "inferred"));
  }

  for (const n of input.needsAttention ?? []) {
    needsAttention.push(item(n.code ?? "NEEDS_ATTENTION", n.title ?? "Needs attention", "needs_attention", n.summary ?? "", n.confidence ?? "unavailable", n.evidenceIds ?? []));
  }

  // Token/cost evidence → found item (evidence exists), never savings.
  if (tce.length > 0) {
    found.push(item("TOKEN_COST_EVIDENCE", "Token/cost evidence", "found", `${tce.length} record(s): measured=${summary.measuredCount} imported=${summary.importedCount} estimated=${summary.estimatedCount} inferred=${summary.inferredCount} unavailable=${summary.unavailableCount}`, summary.measuredCount > 0 ? "measured" : summary.importedCount > 0 ? "imported" : "unavailable", tce.map((e) => e.evidenceId)));
  }

  const report: ProofReport = {
    contract: "avorelo.proofReport.v1", schemaVersion: 1,
    reportId: "rpt_" + createHash("sha256").update(`${input.scope}:${createdAt}:${tce.length}`).digest("hex").slice(0, 12),
    createdAt,
    scope: input.scope ?? "local_workspace",
    relatedIds: { ...input.relatedIds, tokenCostEvidenceIds: tce.map((e) => e.evidenceId) },
    sections: {
      found, protected: protectedItems, fixedOrPrepared, verified,
      savedOrAvoided: buildSavingsSection(summary, tce.length),
      needsAttention, next,
    },
    evidenceSummary: {
      tokenCostEvidenceCount: tce.length,
      measuredCount: summary.measuredCount, importedCount: summary.importedCount,
      estimatedCount: summary.estimatedCount, inferredCount: summary.inferredCount, unavailableCount: summary.unavailableCount,
      canShowCostSummary: (summary.measuredCount + summary.importedCount) > 0,
      canShowSavings: false,
      unavailableReasons: summary.unavailableReasons,
    },
    safety: {
      redacted: true, containsRawPrompt: false, containsRawTranscript: false, containsRawSource: false,
      containsRawSecret: false, containsEnvValue: false, containsTerminalLog: false, containsGitDiff: false,
    },
    syncProjectionEligible: false,
  };
  report.syncProjectionEligible = evaluateReceiptSafety({ allowlisted: true, redacted: true, payload: buildProofReportSyncMetadata(report), reasonCodes: ["REDACTED"] }).eligible;
  return report;
}

/** Build a report from locally persisted evidence (token-cost + latest continuity). Metadata only. */
export function buildProofReportFromLocalEvidence(target: string, createdAt?: string): ProofReport {
  const tce = loadTokenCostEvidence(target);
  const cont = loadLatestContinuity(target);
  return buildProofReport({
    scope: "local_workspace", createdAt, tokenCostEvidence: tce,
    continuity: cont ? { continuityPacketId: cont.contextPacketRef ?? undefined, proofMissing: cont.proofMissing, openQuestions: cont.openQuestions, safeNextActions: cont.safeNextActions, route: cont.route, riskClass: cont.riskClass, proofTier: cont.proofTier } : null,
  });
}

export type ProofReportSummary = { reportId: string; sections: Record<string, number>; canShowCostSummary: boolean; canShowSavings: boolean; savingsRefusalReason: string | null };

export function summarizeProofReport(r: ProofReport): ProofReportSummary {
  return {
    reportId: r.reportId,
    sections: { found: r.sections.found.length, protected: r.sections.protected.length, fixedOrPrepared: r.sections.fixedOrPrepared.length, verified: r.sections.verified.length, needsAttention: r.sections.needsAttention.length, next: r.sections.next.length },
    canShowCostSummary: r.evidenceSummary.canShowCostSummary,
    canShowSavings: r.evidenceSummary.canShowSavings,
    savingsRefusalReason: r.sections.savedOrAvoided.refusalReason ?? null,
  };
}

/** Sanitized metadata-only sync projection. The full report is local-only and never synced. */
export function buildProofReportSyncMetadata(r: ProofReport): ProofReportSyncMetadata {
  return {
    contract: "avorelo.proofReport.sync.v1",
    reportId: r.reportId, createdAt: r.createdAt, scope: r.scope,
    sectionCounts: { found: r.sections.found.length, protected: r.sections.protected.length, fixedOrPrepared: r.sections.fixedOrPrepared.length, verified: r.sections.verified.length, needsAttention: r.sections.needsAttention.length, next: r.sections.next.length },
    evidenceCounts: { tokenCostEvidenceCount: r.evidenceSummary.tokenCostEvidenceCount, measuredCount: r.evidenceSummary.measuredCount, importedCount: r.evidenceSummary.importedCount, estimatedCount: r.evidenceSummary.estimatedCount, inferredCount: r.evidenceSummary.inferredCount, unavailableCount: r.evidenceSummary.unavailableCount },
    canShowCostSummary: r.evidenceSummary.canShowCostSummary,
    savingsClaimAllowed: r.sections.savedOrAvoided.savingsClaimAllowed,
    savingsRefusalReason: r.sections.savedOrAvoided.refusalReason ?? null,
    redacted: true,
  };
}

/** Validate the report carries no raw content (content-bearing fields only; structural flags excluded). */
export function validateProofReport(r: ProofReport): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (r.contract !== "avorelo.proofReport.v1") reasons.push("bad_contract");
  if (r.sections.savedOrAvoided.savingsClaimAllowed !== false && r.sections.savedOrAvoided.savingsAmount === null) reasons.push("savings_allowed_without_amount");
  if (r.sections.savedOrAvoided.savingsAmount !== null && !r.sections.savedOrAvoided.savingsClaimAllowed) reasons.push("savings_amount_without_allow");
  const allItems = [...r.sections.found, ...r.sections.protected, ...r.sections.fixedOrPrepared, ...r.sections.verified, ...r.sections.needsAttention, ...r.sections.next];
  const content = { items: allItems.map((i) => ({ title: i.title, summary: i.summary })), unavailableReasons: r.evidenceSummary.unavailableReasons };
  const c = classifyPayload(content);
  if (!c.safe) reasons.push(...c.violations.map((v) => `unsafe:${v}`));
  return { valid: reasons.length === 0, reasons };
}

function reportsDir(dir: string): string { return join(dir, ".avorelo", "reports"); }

/** Persist the latest report + append history (redacted, local-first). */
export function writeProofReport(dir: string, r: ProofReport): { path: string; syncEligible: boolean } {
  const v = validateProofReport(r);
  if (!v.valid) throw new Error("proof_report_invalid: " + v.reasons.join(","));
  validateReceiptSafety({ schemaName: r.contract, schemaVersion: String(r.schemaVersion), redacted: true, payload: { reasons: r.evidenceSummary.unavailableReasons }, reasonCodes: ["REDACTED"] });
  const d = reportsDir(dir);
  mkdirSync(d, { recursive: true });
  const latest = join(d, "proof-report.latest.json");
  writeFileSync(latest, JSON.stringify(r, null, 2));
  appendFileSync(join(d, "proof-report.history.jsonl"), JSON.stringify(r) + "\n");
  return { path: latest, syncEligible: r.syncProjectionEligible };
}

export function loadLatestProofReport(dir: string): ProofReport | null {
  const latest = join(reportsDir(dir), "proof-report.latest.json");
  if (!existsSync(latest)) return null;
  try { return JSON.parse(readFileSync(latest, "utf8")) as ProofReport; } catch { return null; }
}
