// Avorelo Value Ledger & Compact Value Surface v1 (Phase 8, Layer 4). Deterministic, local-first, redacted.
// Turns proof reports into a durable, confidence-labelled local value HISTORY + compact value cards — NOT a
// dashboard, NOT an analytics product. Consumes Phase 7 ProofReport (+ prior phases) as outputs; does not
// reimplement them. Aggregates evidence but NEVER invents value: no ROI, no productivity score, no fake
// savings. unavailable remains unavailable. Cards preserve confidence labels.

import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { redactString } from "../secret-boundary/redactor.ts";
import { classifyPayload } from "../../shared/redaction/policy.ts";
import { validateReceiptSafety } from "../../kernel/receipts/validation.ts";
import { evaluateReceiptSafety } from "../../kernel/receipts/eligibility.ts";
import type {
  ValueLedgerEntry,
  CompactValueCard,
  ValueLedgerSyncMetadata,
  ValueLedgerSource,
  ValueLedgerCategory,
  ValueLedgerStatus,
  ValueCardTitle,
  ValueMetricKind,
  EvidenceConfidence,
  ProofReport,
} from "../../shared/schemas/index.ts";

// Defense in depth: redact secrets, then drop any text the policy still flags (diff/log/env/path).
function safeText(s: string): string {
  const red = redactString(String(s ?? ""), "handoff", "ledger").redacted;
  return classifyPayload({ s: red }).safe ? red : "[redacted: unsafe content removed]";
}

function entryId(seed: string): string { return "vle_" + createHash("sha256").update(seed).digest("hex").slice(0, 12); }

export type MakeEntryInput = {
  source: ValueLedgerSource;
  category: ValueLedgerCategory;
  status: ValueLedgerStatus;
  confidence?: EvidenceConfidence;
  summary: string;
  reasonCodes?: string[];
  relatedIds?: ValueLedgerEntry["relatedIds"];
  metric?: { kind: ValueMetricKind; value: number | null; currency?: string | null; confidence?: EvidenceConfidence };
  createdAt?: string;
};

export function makeValueLedgerEntry(input: MakeEntryInput): ValueLedgerEntry {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const confidence = input.confidence ?? "unavailable";
  return {
    contract: "avorelo.valueLedger.v1", schemaVersion: 1,
    entryId: entryId(`${input.category}:${input.source}:${createdAt}:${input.summary}`),
    createdAt, source: input.source, relatedIds: input.relatedIds ?? {},
    category: input.category, confidence, status: input.status,
    metric: input.metric ? { kind: input.metric.kind, value: input.metric.value, currency: input.metric.currency ?? null, confidence: input.metric.confidence ?? confidence } : undefined,
    summary: safeText(input.summary),
    reasonCodes: (input.reasonCodes ?? []).map(safeText),
    safety: { redacted: true, containsRawPrompt: false, containsRawSource: false, containsRawSecret: false, containsTerminalLog: false, containsGitDiff: false },
  };
}

/**
 * Derive value-ledger entries from a Phase-7 ProofReport. Aggregates evidence only; never invents value.
 * Savings entries appear ONLY if the report explicitly allowed savings (never in v1).
 */
export function entriesFromProofReport(report: ProofReport, createdAt?: string): ValueLedgerEntry[] {
  const at = createdAt ?? report.createdAt;
  const rid = { reportId: report.reportId };
  const out: ValueLedgerEntry[] = [];

  if (report.sections.protected.length > 0) {
    out.push(makeValueLedgerEntry({ source: "secret_boundary", category: "secret_boundary_protected", status: "protected", confidence: "measured", summary: `${report.sections.protected.length} item(s) protected`, reasonCodes: report.sections.protected.map((i) => i.code), relatedIds: rid, metric: { kind: "count", value: report.sections.protected.length, confidence: "measured" }, createdAt: at }));
  }
  const proofCount = report.sections.verified.length;
  out.push(makeValueLedgerEntry({ source: "proof_report", category: "proof_captured", status: proofCount > 0 ? "verified" : "unavailable", confidence: proofCount > 0 ? "measured" : "unavailable", summary: proofCount > 0 ? `${proofCount} verified item(s)` : "no verified proof captured", relatedIds: rid, metric: { kind: "proof_count", value: proofCount > 0 ? proofCount : null, confidence: proofCount > 0 ? "measured" : "unavailable" }, createdAt: at }));

  if (report.sections.fixedOrPrepared.length > 0 || report.sections.next.length > 0) {
    const n = report.sections.fixedOrPrepared.length + report.sections.next.length;
    out.push(makeValueLedgerEntry({ source: "continuity", category: "next_run_prepared", status: "prepared", confidence: "inferred", summary: `${n} item(s) prepared for next run`, relatedIds: rid, metric: { kind: "count", value: n, confidence: "inferred" }, createdAt: at }));
  }

  // Token/cost evidence → evidence card (NOT savings). Cost summary only if the report allowed it.
  const es = report.evidenceSummary;
  if (es.tokenCostEvidenceCount > 0) {
    const cs = report.sections.savedOrAvoided.costSummary;
    const metric = es.canShowCostSummary && cs && cs.totalCost !== null
      ? { kind: "cost_summary" as ValueMetricKind, value: cs.totalCost, currency: cs.currency, confidence: cs.confidence }
      : { kind: "evidence_count" as ValueMetricKind, value: es.tokenCostEvidenceCount, confidence: (es.measuredCount > 0 ? "measured" : es.importedCount > 0 ? "imported" : "unavailable") as EvidenceConfidence };
    out.push(makeValueLedgerEntry({ source: "token_cost_evidence", category: "token_cost_evidence", status: "captured", confidence: metric.confidence, summary: `${es.tokenCostEvidenceCount} evidence record(s); savings ${report.sections.savedOrAvoided.savingsClaimAllowed ? "allowed" : "not claimed (" + (report.sections.savedOrAvoided.refusalReason ?? "unavailable") + ")"}`, reasonCodes: [report.sections.savedOrAvoided.refusalReason ?? "savings_unavailable"], relatedIds: rid, metric, createdAt: at }));
  }

  for (const na of report.sections.needsAttention) {
    out.push(makeValueLedgerEntry({ source: "proof_report", category: "needs_attention", status: "needs_attention", confidence: "unavailable", summary: na.summary, reasonCodes: [na.code], relatedIds: rid, createdAt: at }));
  }
  return out;
}

// ---------- Cards ----------

const CARD_FOR_CATEGORY: Record<ValueLedgerCategory, ValueCardTitle> = {
  scope_safety_protected: "Scope & Safety Protected",
  secret_boundary_protected: "Secret Boundary Protected",
  proof_captured: "Proof Captured",
  next_run_prepared: "Next Run Prepared",
  review_load_reduced: "Review Load Reduced",
  rework_avoided: "Rework Avoided",
  token_cost_evidence: "Token/Cost Evidence",
  needs_attention: "Needs Attention",
};
const ALL_CARD_TITLES: ValueCardTitle[] = ["Scope & Safety Protected", "Secret Boundary Protected", "Proof Captured", "Next Run Prepared", "Review Load Reduced", "Rework Avoided", "Token/Cost Evidence", "Needs Attention"];

/** Build the eight compact value cards from ledger entries. Cards preserve confidence; unavailable stays unavailable. */
export function buildCompactValueCards(entries: ValueLedgerEntry[]): CompactValueCard[] {
  return ALL_CARD_TITLES.map((title) => {
    const cat = (Object.keys(CARD_FOR_CATEGORY) as ValueLedgerCategory[]).find((c) => CARD_FOR_CATEGORY[c] === title)!;
    const matching = entries.filter((e) => e.category === cat);
    const isNeedsAttention = title === "Needs Attention";
    // Entries that actually carry value (an unavailable/empty entry does not make a card "available").
    const real = matching.filter((e) => e.status !== "unavailable" && e.confidence !== "unavailable");
    if (matching.length === 0 || (!isNeedsAttention && real.length === 0)) {
      const reasonCodes = Array.from(new Set(matching.flatMap((e) => e.reasonCodes)));
      return { cardId: "card_" + cat, title, status: "unavailable", confidence: "unavailable", valueLabel: matching.length === 0 ? "unavailable" : "not claimed", reasonCodes, sourceEntryIds: matching.map((e) => e.entryId) };
    }
    const considered = isNeedsAttention ? matching : real;
    // Highest-confidence representative for the label.
    const order: EvidenceConfidence[] = ["measured", "imported", "estimated", "inferred", "unavailable"];
    const best = considered.slice().sort((a, b) => order.indexOf(a.confidence) - order.indexOf(b.confidence))[0];
    const totalCount = considered.reduce((n, e) => n + (typeof e.metric?.value === "number" ? e.metric!.value! : 1), 0);
    let valueLabel: string;
    if (title === "Token/Cost Evidence") {
      const costEntry = matching.find((e) => e.metric?.kind === "cost_summary");
      valueLabel = costEntry && costEntry.metric?.value != null ? `cost ${costEntry.metric.value} ${costEntry.metric.currency ?? ""} (${costEntry.metric.confidence}) — savings not claimed`.trim() : `${matching.length} evidence record(s) — savings not claimed`;
    } else {
      valueLabel = `${totalCount} ${isNeedsAttention ? "item(s) need attention" : "item(s)"} (${best.confidence})`;
    }
    return {
      cardId: "card_" + cat,
      title,
      status: isNeedsAttention ? "needs_attention" : "available",
      confidence: best.confidence,
      valueLabel,
      reasonCodes: Array.from(new Set(matching.flatMap((e) => e.reasonCodes))),
      sourceEntryIds: matching.map((e) => e.entryId),
    };
  });
}

// ---------- Summary + sync projection ----------

export type ValueLedgerSummary = {
  entryCount: number;
  categories: Record<string, number>;
  confidenceBreakdown: Record<EvidenceConfidence, number>;
  needsAttentionCount: number;
  unavailableCount: number;
};

export function summarizeValueLedger(entries: ValueLedgerEntry[]): ValueLedgerSummary {
  const categories: Record<string, number> = {};
  const confidenceBreakdown: Record<EvidenceConfidence, number> = { measured: 0, imported: 0, estimated: 0, inferred: 0, unavailable: 0 };
  for (const e of entries) {
    categories[e.category] = (categories[e.category] ?? 0) + 1;
    confidenceBreakdown[e.confidence] = (confidenceBreakdown[e.confidence] ?? 0) + 1;
  }
  return {
    entryCount: entries.length, categories, confidenceBreakdown,
    needsAttentionCount: categories["needs_attention"] ?? 0,
    unavailableCount: confidenceBreakdown.unavailable,
  };
}

/** Sanitized metadata-only sync projection. The full ledger is local-only and never synced. */
export function buildValueLedgerSyncMetadata(entries: ValueLedgerEntry[]): ValueLedgerSyncMetadata {
  const s = summarizeValueLedger(entries);
  const cards = buildCompactValueCards(entries);
  const times = entries.map((e) => e.createdAt).sort();
  return {
    contract: "avorelo.valueLedger.sync.v1",
    entryCount: s.entryCount, categories: s.categories, confidenceBreakdown: s.confidenceBreakdown,
    cardStatuses: cards.map((c) => ({ title: c.title, status: c.status, confidence: c.confidence })),
    reasonCodes: Array.from(new Set(entries.flatMap((e) => e.reasonCodes))),
    createdAtRange: { first: times[0] ?? null, last: times[times.length - 1] ?? null },
    redacted: true,
  };
}

export function validateValueLedgerEntry(e: ValueLedgerEntry): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (e.contract !== "avorelo.valueLedger.v1") reasons.push("bad_contract");
  if (e.safety.redacted !== true) reasons.push("not_redacted");
  const c = classifyPayload({ summary: e.summary, reasonCodes: e.reasonCodes });
  if (!c.safe) reasons.push(...c.violations.map((v) => `unsafe:${v}`));
  return { valid: reasons.length === 0, reasons };
}

// ---------- Persistence (local-first, redacted) ----------

function ledgerDir(dir: string): string { return join(dir, ".avorelo", "value-ledger"); }

export function appendValueLedgerEntry(dir: string, e: ValueLedgerEntry): string {
  const v = validateValueLedgerEntry(e);
  if (!v.valid) throw new Error("value_ledger_entry_invalid: " + v.reasons.join(","));
  validateReceiptSafety({ schemaName: e.contract, schemaVersion: String(e.schemaVersion), redacted: true, payload: { summary: e.summary, reasonCodes: e.reasonCodes }, reasonCodes: ["REDACTED"] });
  const d = ledgerDir(dir); mkdirSync(d, { recursive: true });
  const path = join(d, "value-ledger.jsonl");
  appendFileSync(path, JSON.stringify(e) + "\n");
  return path;
}

export function loadValueLedgerEntries(dir: string): ValueLedgerEntry[] {
  const path = join(ledgerDir(dir), "value-ledger.jsonl");
  if (!existsSync(path)) return [];
  const out: ValueLedgerEntry[] = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { const e = JSON.parse(line) as ValueLedgerEntry; if (e.contract === "avorelo.valueLedger.v1") out.push(e); } catch { /* skip */ }
  }
  return out;
}

/** Write the latest compact cards snapshot. Returns sync eligibility of the projection. */
export function writeValueCards(dir: string, entries: ValueLedgerEntry[]): { path: string; syncEligible: boolean } {
  const cards = buildCompactValueCards(entries);
  const d = ledgerDir(dir); mkdirSync(d, { recursive: true });
  const path = join(d, "cards.latest.json");
  writeFileSync(path, JSON.stringify(cards, null, 2));
  const syncEligible = evaluateReceiptSafety({ allowlisted: true, redacted: true, payload: buildValueLedgerSyncMetadata(entries), reasonCodes: ["REDACTED"] }).eligible;
  return { path, syncEligible };
}
