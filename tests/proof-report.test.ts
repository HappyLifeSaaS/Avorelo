// Avorelo Phase 7 — Proof & Savings Report tests (node:test, zero-dep). No network, no DB, no real secrets.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProofReport, summarizeProofReport, buildProofReportSyncMetadata, validateProofReport } from "../src/avorelo/capabilities/proof-report/index.ts";
import { createMeasuredTokenCostEvidence, createImportedTokenCostEvidence, createEstimatedTokenCostEvidence, createInferredTokenCostEvidence, createUnavailableTokenCostEvidence } from "../src/avorelo/capabilities/token-cost-evidence/index.ts";

const ser = (b: unknown) => { try { return JSON.stringify(b); } catch { return ""; } };
const TOK = "ghp_ABCDEF" + "GHIJKLMNOPQRSTUVWXYZ0123456789";
const AT = "2026-06-11T00:00:00.000Z";

test("1. report contract metadata exists", () => {
  const r = buildProofReport({ createdAt: AT });
  assert.equal(r.contract, "avorelo.proofReport.v1");
  assert.equal(r.schemaVersion, 1);
  assert.ok(r.reportId);
});
test("2. unavailable token/cost evidence produces savings unavailable", () => {
  const r = buildProofReport({ createdAt: AT, tokenCostEvidence: [createUnavailableTokenCostEvidence("no_meter")] });
  assert.equal(r.sections.savedOrAvoided.canShowSavings, false);
  assert.ok(r.sections.savedOrAvoided.refusalReason);
});
test("3. unavailable is not converted to zero saved", () => {
  const r = buildProofReport({ createdAt: AT, tokenCostEvidence: [createUnavailableTokenCostEvidence("no_meter")] });
  assert.equal(r.sections.savedOrAvoided.savingsAmount, null);
});
test("4. measured/imported cost can show cost summary", () => {
  const r = buildProofReport({ createdAt: AT, tokenCostEvidence: [createImportedTokenCostEvidence({ scope: "session", totalTokens: 10, costAmount: 0.5, currency: "USD" })] });
  assert.equal(r.evidenceSummary.canShowCostSummary, true);
  assert.equal(r.sections.savedOrAvoided.costSummary?.confidence, "imported");
});
test("5. cost summary is not savings", () => {
  const r = buildProofReport({ createdAt: AT, tokenCostEvidence: [createMeasuredTokenCostEvidence({ scope: "session", totalTokens: 10, costAmount: 1, currency: "USD" })] });
  assert.equal(r.sections.savedOrAvoided.savingsClaimAllowed, false);
  assert.equal(r.sections.savedOrAvoided.savingsAmount, null);
});
test("6. estimated evidence remains labeled estimated", () => {
  const r = buildProofReport({ createdAt: AT, tokenCostEvidence: [createEstimatedTokenCostEvidence({ scope: "context_packet", totalTokens: 500 })] });
  assert.equal(r.evidenceSummary.estimatedCount, 1);
});
test("7. inferred evidence remains labeled inferred", () => {
  const r = buildProofReport({ createdAt: AT, tokenCostEvidence: [createInferredTokenCostEvidence({ scope: "unknown", totalTokens: 200 })] });
  assert.equal(r.evidenceSummary.inferredCount, 1);
});
test("8. estimated/inferred cannot create exact savings", () => {
  const r = buildProofReport({ createdAt: AT, tokenCostEvidence: [createEstimatedTokenCostEvidence({ scope: "context_packet", totalTokens: 500 }), createInferredTokenCostEvidence({ scope: "unknown", totalTokens: 200 })] });
  assert.equal(r.sections.savedOrAvoided.savingsClaimAllowed, false);
  assert.equal(r.sections.savedOrAvoided.savingsAmount, null);
});
test("9. no comparative evidence means savings refused", () => {
  const r = buildProofReport({ createdAt: AT, tokenCostEvidence: [createMeasuredTokenCostEvidence({ scope: "session", totalTokens: 10 })] });
  assert.equal(r.sections.savedOrAvoided.refusalReason, "no_comparative_evidence_baseline_vs_current");
});
test("10. missing baseline means savings refused (no evidence)", () => {
  const r = buildProofReport({ createdAt: AT });
  assert.equal(r.sections.savedOrAvoided.refusalReason, "no_token_cost_evidence");
  assert.equal(r.sections.savedOrAvoided.savingsClaimAllowed, false);
});
test("11. mixed currency handled safely", () => {
  const r = buildProofReport({ createdAt: AT, tokenCostEvidence: [createImportedTokenCostEvidence({ scope: "session", totalTokens: 1, costAmount: 1, currency: "USD" }), createImportedTokenCostEvidence({ scope: "session", totalTokens: 1, costAmount: 1, currency: "EUR" })] });
  assert.equal(r.sections.savedOrAvoided.costSummary?.mixedCurrency, true);
  assert.equal(r.sections.savedOrAvoided.costSummary?.totalCost, null);
});
test("12. report includes evidence confidence breakdown", () => {
  const r = buildProofReport({ createdAt: AT, tokenCostEvidence: [createMeasuredTokenCostEvidence({ scope: "session", totalTokens: 1 }), createUnavailableTokenCostEvidence("x")] });
  assert.equal(r.evidenceSummary.measuredCount, 1);
  assert.equal(r.evidenceSummary.unavailableCount, 1);
});
test("13. report has found/protected/verified/needsAttention/next sections", () => {
  const r = buildProofReport({ createdAt: AT });
  for (const k of ["found", "protected", "fixedOrPrepared", "verified", "needsAttention", "next"]) assert.ok(Array.isArray((r.sections as Record<string, unknown>)[k]));
});
test("14. secret-boundary code becomes protected item without raw secret", () => {
  const r = buildProofReport({ createdAt: AT, secretBoundary: { codes: ["SEC_GH_TOKEN"], protectedCount: 1 } });
  assert.equal(r.sections.protected.length, 1);
  assert.equal(ser(r).includes(TOK), false);
});
test("15. continuity proof gap becomes needsAttention", () => {
  const r = buildProofReport({ createdAt: AT, continuity: { proofMissing: ["tests pass"] } });
  assert.ok(r.sections.needsAttention.some((i) => i.code === "PROOF_GAP"));
});
test("16. continuity safe next action becomes next item", () => {
  const r = buildProofReport({ createdAt: AT, continuity: { safeNextActions: ["Run tests"] } });
  assert.ok(r.sections.next.some((i) => i.code === "NEXT_ACTION"));
});
test("17. context packet becomes prepared item without selectedRefs", () => {
  const r = buildProofReport({ createdAt: AT, context: { contextPacketId: "ctx_1", budget: "small", selectedCount: 2 } });
  assert.ok(r.sections.fixedOrPrepared.some((i) => i.code === "CONTEXT_PREPARED"));
  assert.equal((r as unknown as Record<string, unknown>).selectedRefs, undefined);
});
test("18-21. report serialization contains no raw prompt/secret/source/log/diff", () => {
  const r = buildProofReport({ createdAt: AT, continuity: { safeNextActions: [`leak ${TOK}`, "diff --git a/x b/x"], proofMissing: ["stdout: ERROR"] }, secretBoundary: { codes: ["SEC_GH_TOKEN"], protectedCount: 1 } });
  const s = ser(r);
  assert.equal(s.includes(TOK), false);
  assert.equal(validateProofReport(r).valid, true);
});
test("22. sync projection is metadata-only", () => {
  const proj = buildProofReportSyncMetadata(buildProofReport({ createdAt: AT, continuity: { safeNextActions: ["secret stuff"] } }));
  const o = proj as unknown as Record<string, unknown>;
  assert.equal(o.sections, undefined);
  assert.equal(proj.contract, "avorelo.proofReport.sync.v1");
  assert.ok(typeof proj.sectionCounts.next === "number");
});
test("23. sync projection excludes item summaries/local text", () => {
  const proj = buildProofReportSyncMetadata(buildProofReport({ createdAt: AT, continuity: { safeNextActions: ["unique-local-text-xyz"] } }));
  assert.equal(ser(proj).includes("unique-local-text-xyz"), false);
});
test("28. report does not lower proof/security (no such fields)", () => {
  const r = buildProofReport({ createdAt: AT });
  const o = r as unknown as Record<string, unknown>;
  assert.equal(o.proofTier, undefined);
  assert.equal(o.approvalPolicy, undefined);
});
test("29. report refuses ROI (no roi field, savings refused)", () => {
  const r = buildProofReport({ createdAt: AT, tokenCostEvidence: [createMeasuredTokenCostEvidence({ scope: "session", totalTokens: 1 })] });
  assert.equal(/\broi\b/.test(ser(r).toLowerCase()), false);
});
test("30. report does not include percent reduction", () => {
  const r = buildProofReport({ createdAt: AT, tokenCostEvidence: [createMeasuredTokenCostEvidence({ scope: "session", totalTokens: 1 })] });
  assert.equal(/percent|reduction|"improvement"/.test(ser(r).toLowerCase()), false);
});
test("32. summarizeProofReport reports refusal reason + section counts", () => {
  const s = summarizeProofReport(buildProofReport({ createdAt: AT, continuity: { proofMissing: ["x"] } }));
  assert.equal(s.canShowSavings, false);
  assert.ok(s.savingsRefusalReason);
  assert.equal(s.sections.needsAttention, 1);
});
