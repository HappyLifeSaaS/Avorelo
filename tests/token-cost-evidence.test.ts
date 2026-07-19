// Avorelo Phase 6 — Token & Cost Evidence tests (node:test, zero-dep). No network, no DB, no real secrets.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createUnavailableTokenCostEvidence,
  createMeasuredTokenCostEvidence,
  createImportedTokenCostEvidence,
  createEstimatedTokenCostEvidence,
  createInferredTokenCostEvidence,
  validateTokenCostEvidence,
  importTokenCostEvidence,
  summarizeTokenCostEvidence,
  buildTokenCostEvidenceSyncMetadata,
} from "../src/avorelo/capabilities/token-cost-evidence/index.ts";

const ser = (b: unknown) => { try { return JSON.stringify(b); } catch { return ""; } };
const TOK = "ghp_ABCDEF" + "GHIJKLMNOPQRSTUVWXYZ0123456789";

// ---------- Builders ----------
test("1. unavailable evidence has null token and cost values", () => {
  const e = createUnavailableTokenCostEvidence("no_meter", "session");
  assert.equal(e.tokens.inputTokens, null);
  assert.equal(e.tokens.totalTokens, null);
  assert.equal(e.cost.amount, null);
  assert.equal(e.cost.currency, null);
});
test("2. unavailable evidence is not zero", () => {
  const e = createUnavailableTokenCostEvidence("no_meter");
  assert.notEqual(e.tokens.totalTokens, 0);
  assert.equal(e.confidence, "unavailable");
});
test("3. measured evidence accepts non-negative token values", () => {
  const e = createMeasuredTokenCostEvidence({ scope: "session", inputTokens: 100, outputTokens: 50 });
  assert.equal(e.tokens.inputTokens, 100);
  assert.equal(e.tokens.totalTokens, 150);
  assert.equal(e.confidence, "measured");
});
test("4. imported evidence accepts non-negative token values", () => {
  const e = createImportedTokenCostEvidence({ scope: "manual_import", totalTokens: 999 });
  assert.equal(e.tokens.totalTokens, 999);
  assert.equal(e.confidence, "imported");
});
test("5. estimated evidence remains labeled estimated", () => {
  const e = createEstimatedTokenCostEvidence({ scope: "context_packet", totalTokens: 500 });
  assert.equal(e.confidence, "estimated");
  assert.equal(e.source, "estimated_context_budget");
});
test("6. inferred evidence remains labeled inferred", () => {
  const e = createInferredTokenCostEvidence({ scope: "unknown", totalTokens: 200 });
  assert.equal(e.confidence, "inferred");
  assert.equal(e.source, "inferred_from_metadata");
});
test("7. negative token values rejected", () => {
  assert.throws(() => createMeasuredTokenCostEvidence({ scope: "session", inputTokens: -5 }));
});
test("8. NaN/Infinity rejected", () => {
  assert.throws(() => createMeasuredTokenCostEvidence({ scope: "session", inputTokens: NaN }));
  assert.throws(() => createMeasuredTokenCostEvidence({ scope: "session", inputTokens: Infinity }));
});
test("9. negative cost rejected", () => {
  assert.throws(() => createImportedTokenCostEvidence({ scope: "session", totalTokens: 10, costAmount: -1, currency: "USD" }));
});
test("10. cost amount without currency rejected", () => {
  assert.throws(() => createImportedTokenCostEvidence({ scope: "session", totalTokens: 10, costAmount: 0.1 }));
});
test("11. currency without cost amount rejected", () => {
  assert.throws(() => createImportedTokenCostEvidence({ scope: "session", totalTokens: 10, currency: "USD" }));
});
test("12. measured confidence without token values rejected", () => {
  assert.throws(() => createMeasuredTokenCostEvidence({ scope: "session" }));
});
test("13. unavailable with numeric token values rejected (via validate)", () => {
  const e = createUnavailableTokenCostEvidence("x");
  (e.tokens as { inputTokens: number | null }).inputTokens = 5; // tamper
  assert.equal(validateTokenCostEvidence(e).valid, false);
  assert.ok(validateTokenCostEvidence(e).reasons.includes("unavailable_with_numeric_tokens"));
});
test("14. canUseForSavingsClaim is always false", () => {
  for (const e of [createUnavailableTokenCostEvidence("x"), createMeasuredTokenCostEvidence({ scope: "session", totalTokens: 1 }), createEstimatedTokenCostEvidence({ scope: "session", totalTokens: 1 })]) {
    assert.equal(e.labels.canUseForSavingsClaim, false);
  }
});

// ---------- Import ----------
test("15. sanitized import accepted", () => {
  const r = importTokenCostEvidence({ source: "imported_cli_usage", inputTokens: 10, outputTokens: 5, confidence: "imported" });
  assert.equal(r.ok, true);
});
for (const [n, field] of [["16", "prompt"], ["17", "messages"], ["18", "transcript"], ["19", "sourceCode"], ["20", "diff"], ["21", "env"], ["22", "secret"], ["23", "stdout"]] as [string, string][]) {
  test(`${n}. import with ${field} rejected`, () => {
    const r = importTokenCostEvidence({ inputTokens: 1, [field]: `bad ${TOK}` });
    assert.equal(r.ok, false);
    if (r.ok === false) assert.ok(r.rejectedFields.map(s => s.toLowerCase()).includes(field.toLowerCase()));
  });
}
test("24. rejected import error does not include raw forbidden value", () => {
  const r = importTokenCostEvidence({ prompt: `leak ${TOK}`, transcript: "secret stuff" });
  assert.equal(ser(r).includes(TOK), false);
  assert.equal(ser(r).includes("secret stuff"), false);
});

// ---------- Summary ----------
test("25. summary totals measured/imported tokens", () => {
  const s = summarizeTokenCostEvidence([
    createMeasuredTokenCostEvidence({ scope: "session", inputTokens: 100, outputTokens: 50 }),
    createImportedTokenCostEvidence({ scope: "session", inputTokens: 200, outputTokens: 100 }),
  ]);
  assert.equal(s.totalInputTokens, 300);
  assert.equal(s.totalOutputTokens, 150);
});
test("26. unavailable entries counted separately, not as zero", () => {
  const s = summarizeTokenCostEvidence([createUnavailableTokenCostEvidence("no_meter"), createMeasuredTokenCostEvidence({ scope: "session", totalTokens: 10 })]);
  assert.equal(s.unavailableCount, 1);
  assert.equal(s.totalTokens, 10); // unavailable did not add a 0
});
test("27. mixed currency handled safely", () => {
  const s = summarizeTokenCostEvidence([
    createImportedTokenCostEvidence({ scope: "session", totalTokens: 10, costAmount: 1, currency: "USD" }),
    createImportedTokenCostEvidence({ scope: "session", totalTokens: 10, costAmount: 2, currency: "EUR" }),
  ]);
  assert.equal(s.mixedCurrency, true);
  assert.equal(s.totalCost, null);
  assert.equal(s.currency, null);
});
test("28. confidence breakdown correct", () => {
  const s = summarizeTokenCostEvidence([createMeasuredTokenCostEvidence({ scope: "session", totalTokens: 1 }), createEstimatedTokenCostEvidence({ scope: "session", totalTokens: 1 }), createUnavailableTokenCostEvidence("x")]);
  assert.equal(s.confidenceBreakdown.measured, 1);
  assert.equal(s.confidenceBreakdown.estimated, 1);
  assert.equal(s.confidenceBreakdown.unavailable, 1);
});
test("29. no savings fields in summary", () => {
  const s = summarizeTokenCostEvidence([createMeasuredTokenCostEvidence({ scope: "session", totalTokens: 1 })]);
  assert.equal(s.canUseForSavingsClaim, false); // explicit guard (false) is allowed; actual claim fields are not
  const str = ser(s).toLowerCase();
  for (const claim of ["savingsamount", "savedtokens", "tokenssaved", "avoidedcost", "costavoided", "\"roi\"", "savingspercent"]) {
    assert.equal(str.includes(claim), false, `summary must not contain ${claim}`);
  }
});
test("30. no percent reduction fields in summary", () => {
  const s = summarizeTokenCostEvidence([createMeasuredTokenCostEvidence({ scope: "session", totalTokens: 1 })]);
  assert.equal(/percent|reduction|improvement|before|after/.test(ser(s).toLowerCase()), false);
});

// ---------- Receipts / projection ----------
test("31. evidence validates as redacted/safe", () => {
  assert.equal(validateTokenCostEvidence(createMeasuredTokenCostEvidence({ scope: "session", totalTokens: 10 })).valid, true);
});
test("32. projection is metadata-only", () => {
  const proj = buildTokenCostEvidenceSyncMetadata(createMeasuredTokenCostEvidence({ scope: "session", inputTokens: 10, outputTokens: 5 }));
  const o = proj as unknown as Record<string, unknown>;
  for (const k of ["safety", "labels", "notes", "model", "relatedIds"]) assert.equal(o[k], undefined);
  assert.equal(proj.contract, "avorelo.tokenCostEvidence.sync.v1");
});
test("33. projection excludes content fields", () => {
  const proj = buildTokenCostEvidenceSyncMetadata(createImportedTokenCostEvidence({ scope: "session", totalTokens: 10, provider: "x", modelName: "y" }));
  const s = ser(proj);
  for (const leak of ["prompt", "transcript", "messages", "sourceCode", "diff"]) assert.equal(s.includes(leak), false);
});
test("34. serialized projection contains no raw secret", () => {
  const r = importTokenCostEvidence({ source: "imported_provider_usage", totalTokens: 10, confidence: "imported" });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(ser(buildTokenCostEvidenceSyncMetadata(r.evidence)).includes(TOK), false);
});
test("35. serialized evidence contains no raw prompt/secret", () => {
  // notes are redacted by the builder
  const e = createMeasuredTokenCostEvidence({ scope: "session", totalTokens: 10, notes: [`note with ${TOK}`] });
  assert.equal(ser(e).includes(TOK), false);
});
test("36. unsafe import is not persisted (returns ok:false)", () => {
  assert.equal(importTokenCostEvidence({ prompt: "x", totalTokens: 1 }).ok, false);
});

// ---------- Integration ----------
test("42. context budget can create estimated evidence but not measured", () => {
  const e = createEstimatedTokenCostEvidence({ scope: "context_packet", totalTokens: 500 });
  assert.equal(e.confidence, "estimated");
  assert.notEqual(e.confidence, "measured");
  assert.equal(e.source, "estimated_context_budget");
});
test("43. continuity can reference evidence id, not embed raw values", () => {
  const e = createMeasuredTokenCostEvidence({ scope: "continuity_packet", totalTokens: 10, relatedIds: { continuityPacketId: "cont_1" } });
  assert.equal(e.relatedIds?.continuityPacketId, "cont_1");
  assert.ok(e.evidenceId.startsWith("tce_"));
});
test("44. Secret Boundary risk blocks unsafe import (forbidden raw field)", () => {
  assert.equal(importTokenCostEvidence({ totalTokens: 10, rawToolOutput: `dump ${TOK}` }).ok, false);
});
test("45. token/cost evidence carries no proof/approval/risk fields (cannot lower them)", () => {
  const e = createMeasuredTokenCostEvidence({ scope: "session", totalTokens: 10 });
  const o = e as unknown as Record<string, unknown>;
  assert.equal(o.proofTier, undefined);
  assert.equal(o.approvalPolicy, undefined);
  assert.equal(o.riskClass, undefined);
});
