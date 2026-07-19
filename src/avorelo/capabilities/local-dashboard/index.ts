// Avorelo Local Dashboard capability (Slice 3). LOCAL-FIRST, read-only PROJECTION of Kernel receipts into
// outcome / needs-attention / blocked / stale cards + a source-of-truth panel. THE ONE RULE: it owns NO
// policy/evidence/receipt truth — it only READS receipts (kernel/receipts.listReceipts) and renders them.
// No network, no login, no server. Deterministic given (now, staleWindowMs).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listReceipts } from "../../kernel/receipts/index.ts";
import { redact } from "../../shared/redaction/index.ts";
import type { Receipt, ReceiptCard, LocalDashboardModel, CardKind, EvidenceLevel } from "../../shared/schemas/index.ts";
import { EVIDENCE_ORDER } from "../../shared/schemas/index.ts";

/** Default freshness window: 14 days. Conservative; configurable per call. (Old repo used 90d for hygiene.) */
export const DEFAULT_STALE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function highestLevel(levels: EvidenceLevel[]): EvidenceLevel | null {
  let best: EvidenceLevel | null = null;
  let bestRank = -1;
  for (const l of levels) {
    const rank = EVIDENCE_ORDER.indexOf(l);
    if (rank > bestRank) { bestRank = rank; best = l; }
  }
  return best;
}

/** A truthful "done" requires STOP_DONE backed by BOTH OUTCOME and POST_ACTION (mirrors the gate; never trust the label alone). */
function isReady(r: Receipt): boolean {
  return r.decision === "STOP_DONE" && r.evidenceLevels.includes("OUTCOME") && r.evidenceLevels.includes("POST_ACTION");
}

export function toCard(r: Receipt, opts: { now: number; staleWindowMs: number }): ReceiptCard {
  const ageMs = typeof r.writtenAt === "number" ? Math.max(0, opts.now - r.writtenAt) : null;
  const stale = ageMs !== null && ageMs > opts.staleWindowMs;
  const ready = isReady(r);

  // A compromised-environment proof (Slice 4) is a "something is wrong" signal, not normal progress.
  const environmentCompromised = (r.decisionBasis?.reasonCodes ?? []).includes("ENVIRONMENT_COMPROMISED");

  let kind: CardKind;
  if (r.decision === "STOP_BLOCKED") kind = "blocked";
  else if (r.decision === "STOP_DONE") kind = ready ? "done" : "needs_attention"; // STOP_DONE without OUTCOME+POST_ACTION is suspicious
  else if (environmentCompromised) kind = "needs_attention"; // CONTINUE under a dirty/stale environment needs attention
  else kind = "in_progress"; // CONTINUE (incl. fake-READY attempts) is never "done"
  // A stale terminal receipt needs attention regardless of how it finished.
  if (stale && kind === "done") kind = "needs_attention";

  return {
    receiptId: r.receiptId,
    contractId: r.contractId,
    decision: r.decision,
    kind,
    highestEvidenceLevel: highestLevel(r.evidenceLevels),
    ready,
    stale,
    ageMs,
    safeNextActions: r.safeNextActions ?? [],
    receiptDigest: r.receiptDigest,
    redactionClasses: r.redactionClasses ?? [],
  };
}

export type BuildOpts = { now: number; staleWindowMs?: number };

/** Build the local dashboard read-model from the receipts in <dir>/.avorelo/receipts. Read-only. */
export function buildLocalDashboard(dir: string, opts: BuildOpts): LocalDashboardModel {
  const staleWindowMs = opts.staleWindowMs ?? DEFAULT_STALE_WINDOW_MS;
  const receipts = listReceipts(dir);
  const cards = receipts
    .map((r) => toCard(r, { now: opts.now, staleWindowMs }))
    .sort((a, b) => a.receiptId.localeCompare(b.receiptId)); // deterministic order

  const totals = {
    total: cards.length,
    done: cards.filter((c) => c.kind === "done").length,
    inProgress: cards.filter((c) => c.kind === "in_progress").length,
    blocked: cards.filter((c) => c.kind === "blocked").length,
    needsAttention: cards.filter((c) => c.kind === "needs_attention").length,
    stale: cards.filter((c) => c.stale).length,
    unknownAge: cards.filter((c) => c.ageMs === null).length,
  };

  const model: LocalDashboardModel = {
    generatedAt: opts.now,
    receiptDir: join(dir, ".avorelo", "receipts"),
    staleWindowMs,
    totals,
    cards,
    notes: [],
    redaction: "applied",
  };
  // Defense-in-depth: the model is derived from already-redacted receipts, but redact again before it leaves.
  return redact(model).value;
}

// --- Rendering (local file only; no remote assets, all dynamic strings escaped) ---

function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function ageText(ageMs: number | null): string {
  if (ageMs === null) return "unknown age";
  const h = ageMs / 3_600_000;
  if (h < 1) return `${Math.round(ageMs / 60_000)}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const KIND_LABEL: Record<CardKind, string> = { done: "DONE", in_progress: "IN PROGRESS", blocked: "BLOCKED", needs_attention: "NEEDS ATTENTION" };

export function renderText(m: LocalDashboardModel): string {
  const lines = [
    "Avorelo — local work proof",
    `  receipts: ${m.totals.total} · done ${m.totals.done} · in-progress ${m.totals.inProgress} · blocked ${m.totals.blocked} · needs-attention ${m.totals.needsAttention} · stale ${m.totals.stale}`,
  ];
  for (const c of m.cards) {
    const flags = [c.stale ? "STALE" : "", c.ageMs === null ? "UNKNOWN-AGE" : ""].filter(Boolean).join(" ");
    lines.push(`  [${KIND_LABEL[c.kind]}] ${c.contractId} — evidence:${c.highestEvidenceLevel ?? "none"} ${flags}`.trimEnd());
    if (c.safeNextActions.length) lines.push(`      next: ${c.safeNextActions.join("; ")}`);
    lines.push(`      source: ${c.receiptId} digest:${c.receiptDigest} (${ageText(c.ageMs)})`);
  }
  for (const n of m.notes) lines.push(`  note: ${n}`);
  return lines.join("\n") + "\n";
}

export function renderHtml(m: LocalDashboardModel): string {
  const card = (c: ReceiptCard) => `
    <li class="card ${esc(c.kind)}">
      <div class="row"><span class="badge ${esc(c.kind)}">${esc(KIND_LABEL[c.kind])}</span>
      <strong>${esc(c.contractId)}</strong>
      <span class="evi">evidence: ${esc(c.highestEvidenceLevel ?? "none")}${c.ready ? " ✓ready" : ""}</span>
      ${c.stale ? '<span class="flag">STALE</span>' : ""}${c.ageMs === null ? '<span class="flag">UNKNOWN AGE</span>' : ""}</div>
      ${c.safeNextActions.length ? `<div class="next">next: ${esc(c.safeNextActions.join("; "))}</div>` : ""}
      <div class="src">source receipt: <code>${esc(c.receiptId)}</code> · digest <code>${esc(c.receiptDigest)}</code> · ${esc(ageText(c.ageMs))}${c.redactionClasses.length ? ` · redacted: ${esc(c.redactionClasses.join(", "))}` : ""}</div>
    </li>`;
  const t = m.totals;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Avorelo — local work proof</title>
<style>
  body{font:14px/1.5 system-ui,sans-serif;margin:2rem;color:#111;background:#fafafa}
  h1{font-size:1.2rem} .totals{color:#444;margin-bottom:1rem}
  ul{list-style:none;padding:0;max-width:880px} .card{background:#fff;border:1px solid #e3e3e3;border-left:4px solid #999;border-radius:6px;padding:.7rem .9rem;margin:.5rem 0}
  .card.done{border-left-color:#1a8f3c} .card.blocked{border-left-color:#c0392b} .card.needs_attention{border-left-color:#d68910} .card.in_progress{border-left-color:#2471a3}
  .badge{font-size:.7rem;font-weight:700;padding:.1rem .4rem;border-radius:3px;color:#fff;background:#999;margin-right:.5rem}
  .badge.done{background:#1a8f3c} .badge.blocked{background:#c0392b} .badge.needs_attention{background:#d68910} .badge.in_progress{background:#2471a3}
  .evi{color:#555;margin-left:.5rem} .flag{color:#c0392b;font-weight:700;margin-left:.5rem;font-size:.75rem}
  .next{color:#7d3c00;margin-top:.3rem} .src{color:#777;margin-top:.3rem;font-size:.8rem} code{background:#f0f0f0;padding:0 .25rem;border-radius:3px}
  .note{color:#777;font-size:.8rem;margin-top:1rem} footer{color:#999;font-size:.75rem;margin-top:1.5rem}
</style></head><body>
<h1>Avorelo — local work proof</h1>
<div class="totals">${t.total} receipts · <b>${t.done}</b> done · ${t.inProgress} in-progress · <b>${t.blocked}</b> blocked · <b>${t.needsAttention}</b> needs-attention · ${t.stale} stale</div>
<ul>${m.cards.map(card).join("")}</ul>
${m.notes.map((n) => `<div class="note">${esc(n)}</div>`).join("")}
<footer>Local-first · no login · no network · rendered from ${esc(m.receiptDir)} · generated ${esc(new Date(m.generatedAt).toISOString())}. The dashboard reads Kernel receipts; it owns no policy/evidence/receipt truth.</footer>
</body></html>`;
}

export type OpenResult = { ok: boolean; model: LocalDashboardModel; htmlPath: string };

/** Render the dashboard to <dir>/.avorelo/dashboard/index.html (local file; no server). */
export function open(dir: string, opts: BuildOpts): OpenResult {
  const model = buildLocalDashboard(dir, opts);
  const dashDir = join(dir, ".avorelo", "dashboard");
  mkdirSync(dashDir, { recursive: true });
  const htmlPath = join(dashDir, "index.html");

  // Community Edition: no entitlement/plan injection. The dashboard shows only truthful local state.
  const html = renderHtml(model);
  writeFileSync(htmlPath, html);
  return { ok: true, model, htmlPath };
}
