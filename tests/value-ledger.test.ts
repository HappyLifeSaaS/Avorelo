// Avorelo Phase 8 — Value Ledger & Compact Value Surface tests (node:test, zero-dep). No network/DB/secrets.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeValueLedgerEntry,
  entriesFromProofReport,
  buildCompactValueCards,
  summarizeValueLedger,
  buildValueLedgerSyncMetadata,
  validateValueLedgerEntry,
} from "../src/avorelo/capabilities/value-ledger/index.ts";
import { buildProofReport } from "../src/avorelo/capabilities/proof-report/index.ts";
import { createImportedTokenCostEvidence, createUnavailableTokenCostEvidence } from "../src/avorelo/capabilities/token-cost-evidence/index.ts";

const AT = "2026-06-11T00:00:00.000Z";
const TOK = "ghp_ABCDEF" + "GHIJKLMNOPQRSTUVWXYZ0123456789";
const ser = (b: unknown) => { try { return JSON.stringify(b); } catch { return ""; } };
const entry = (over: Record<string, unknown> = {}) => makeValueLedgerEntry({ source: "proof_report", category: "proof_captured", status: "verified", confidence: "measured", summary: "x", createdAt: AT, ...over } as never);

test("1. ledger entry contract exists", () => {
  const e = entry();
  assert.equal(e.contract, "avorelo.valueLedger.v1");
  assert.equal(e.schemaVersion, 1);
  assert.ok(e.entryId);
});
test("2. validate entry works", () => assert.equal(validateValueLedgerEntry(entry()).valid, true));
test("3. entry is redacted", () => assert.equal(entry().safety.redacted, true));
test("4. raw secret in summary is redacted", () => {
  const e = entry({ summary: `leak ${TOK}` });
  assert.equal(ser(e).includes(TOK), false);
});
test("5/6. raw source/log/diff in summary scrubbed", () => {
  const e = entry({ summary: "diff --git a/x b/x\n+++ b/x" });
  assert.equal(ser(e).includes("diff --git"), false);
  assert.equal(validateValueLedgerEntry(e).valid, true);
});
test("7. proof report creates proof captured entry (when verified present)", () => {
  const r = buildProofReport({ createdAt: AT, verified: [{ code: "V1", title: "ok", summary: "verified" }] });
  const es = entriesFromProofReport(r);
  assert.ok(es.some((e) => e.category === "proof_captured" && e.status === "verified"));
});
test("8. secret boundary event creates protected entry", () => {
  const r = buildProofReport({ createdAt: AT, secretBoundary: { codes: ["SEC_GH_TOKEN"], protectedCount: 1 } });
  assert.ok(entriesFromProofReport(r).some((e) => e.category === "secret_boundary_protected"));
});
test("9. continuity packet creates next-run-prepared entry", () => {
  const r = buildProofReport({ createdAt: AT, continuity: { safeNextActions: ["Run tests"] } });
  assert.ok(entriesFromProofReport(r).some((e) => e.category === "next_run_prepared"));
});
test("10. unavailable evidence creates unavailable entry, not zero", () => {
  const r = buildProofReport({ createdAt: AT, tokenCostEvidence: [createUnavailableTokenCostEvidence("no_meter")] });
  const es = entriesFromProofReport(r);
  const tc = es.find((e) => e.category === "token_cost_evidence");
  assert.ok(tc);
  assert.notEqual(tc!.metric?.value, 0);
});
test("11. token/cost evidence creates evidence entry, not savings", () => {
  const r = buildProofReport({ createdAt: AT, tokenCostEvidence: [createImportedTokenCostEvidence({ scope: "session", totalTokens: 10, costAmount: 1, currency: "USD" })] });
  const es = entriesFromProofReport(r);
  const tc = es.find((e) => e.category === "token_cost_evidence");
  assert.ok(tc && tc.summary.includes("savings not claimed"));
});
test("12. savings card only appears if Phase 7 allowed savings (never in v1)", () => {
  const r = buildProofReport({ createdAt: AT, tokenCostEvidence: [createImportedTokenCostEvidence({ scope: "session", totalTokens: 10, costAmount: 1, currency: "USD" })] });
  const cards = buildCompactValueCards(entriesFromProofReport(r));
  const tc = cards.find((c) => c.title === "Token/Cost Evidence")!;
  assert.equal(tc.valueLabel.includes("savings not claimed"), true);
  assert.equal(/saved \$|savings: \d/.test(ser(cards)), false);
});
test("13. cost summary card is not savings", () => {
  const r = buildProofReport({ createdAt: AT, tokenCostEvidence: [createImportedTokenCostEvidence({ scope: "session", totalTokens: 10, costAmount: 2, currency: "USD" })] });
  const tc = buildCompactValueCards(entriesFromProofReport(r)).find((c) => c.title === "Token/Cost Evidence")!;
  assert.match(tc.valueLabel, /cost 2 USD/);
  assert.match(tc.valueLabel, /not claimed/);
});
test("14. compact cards include confidence labels", () => {
  const cards = buildCompactValueCards([entry({ category: "secret_boundary_protected", status: "protected", confidence: "measured", metric: { kind: "count", value: 2, confidence: "measured" } })]);
  assert.ok(cards.every((c) => typeof c.confidence === "string"));
});
test("15. needs attention card appears for proof gaps", () => {
  const r = buildProofReport({ createdAt: AT, continuity: { proofMissing: ["tests pass"] } });
  const cards = buildCompactValueCards(entriesFromProofReport(r));
  assert.equal(cards.find((c) => c.title === "Needs Attention")!.status, "needs_attention");
});
test("16. no ROI fields", () => {
  const cards = buildCompactValueCards(entriesFromProofReport(buildProofReport({ createdAt: AT, tokenCostEvidence: [createImportedTokenCostEvidence({ scope: "session", totalTokens: 1, costAmount: 1, currency: "USD" })] })));
  assert.equal(/\broi\b/.test(ser(cards).toLowerCase()), false);
});
test("17. no productivity score", () => {
  const cards = buildCompactValueCards([entry()]);
  assert.equal(/productivity|score/.test(ser(cards).toLowerCase()), false);
});
test("18. sync projection metadata-only", () => {
  const proj = buildValueLedgerSyncMetadata([entry({ summary: "unique-local-text-abc" })]);
  assert.equal(proj.contract, "avorelo.valueLedger.sync.v1");
  assert.equal((proj as unknown as Record<string, unknown>).entries, undefined);
});
test("19. sync projection excludes summaries/local text", () => {
  const proj = buildValueLedgerSyncMetadata([entry({ summary: "unique-local-text-abc" })]);
  assert.equal(ser(proj).includes("unique-local-text-abc"), false);
});
test("22. cards do not claim savings without eligibility", () => {
  const cards = buildCompactValueCards(entriesFromProofReport(buildProofReport({ createdAt: AT, tokenCostEvidence: [createImportedTokenCostEvidence({ scope: "session", totalTokens: 1, costAmount: 1, currency: "USD" })] })));
  assert.equal(cards.some((c) => /saved/i.test(c.valueLabel) && !/not claimed/i.test(c.valueLabel)), false);
});
test("23. aggregation preserves confidence labels", () => {
  const s = summarizeValueLedger([entry({ confidence: "measured" }), entry({ confidence: "estimated" }), entry({ confidence: "unavailable", status: "unavailable" })]);
  assert.equal(s.confidenceBreakdown.measured, 1);
  assert.equal(s.confidenceBreakdown.estimated, 1);
  assert.equal(s.confidenceBreakdown.unavailable, 1);
});
test("24. all 8 cards always present (compact surface)", () => {
  const cards = buildCompactValueCards([]);
  assert.equal(cards.length, 8);
  assert.ok(cards.every((c) => c.status === "unavailable"));
});
test("25. raw secret in reasonCodes/summary never survives entry", () => {
  const e = makeValueLedgerEntry({ source: "manual_safe", category: "proof_captured", status: "captured", summary: `note ${TOK}`, reasonCodes: [`code ${TOK}`], createdAt: AT });
  assert.equal(ser(e).includes(TOK), false);
});
