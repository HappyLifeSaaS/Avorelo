// Avorelo Phase 9 — Sanitized Cloud Sync for Efficiency Metadata tests (node:test, zero-dep). No net/DB/secrets.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEfficiencyMetadataSyncEnvelope, classifyCandidate, screenProjectionMetadata, validateEfficiencyMetadataSyncEnvelope } from "../src/avorelo/capabilities/efficiency-sync/index.ts";
import { createImportedTokenCostEvidence, buildTokenCostEvidenceSyncMetadata } from "../src/avorelo/capabilities/token-cost-evidence/index.ts";
import { buildProofReport, buildProofReportSyncMetadata } from "../src/avorelo/capabilities/proof-report/index.ts";

const ser = (b: unknown) => { try { return JSON.stringify(b); } catch { return ""; } };
const TOK = "ghp_ABCDEF" + "GHIJKLMNOPQRSTUVWXYZ0123456789";
const cand = (source: string, metadata: Record<string, unknown>) => ({ source: source as never, contract: "c", metadata });

const tcMeta = buildTokenCostEvidenceSyncMetadata(createImportedTokenCostEvidence({ scope: "session", totalTokens: 10, costAmount: 1, currency: "USD" }));
const prMeta = buildProofReportSyncMetadata(buildProofReport({ createdAt: "2026-06-11T00:00:00.000Z" }));

test("1. sync envelope contract exists", () => {
  const env = buildEfficiencyMetadataSyncEnvelope({ candidates: [] });
  assert.equal(env.contract, "avorelo.efficiencyMetadataSync.v1");
  assert.equal(env.schemaVersion, 1);
});
test("2. token-cost projection accepted when metadata-only", () => {
  assert.ok(classifyCandidate(cand("token_cost_evidence", tcMeta as never)).eligible);
});
test("3. proof-report projection accepted when metadata-only", () => {
  assert.ok(classifyCandidate(cand("proof_report", prMeta as never)).eligible);
});
test("4. value-ledger projection accepted (counts/codes only)", () => {
  assert.ok(classifyCandidate(cand("value_ledger", { entryCount: 3, categories: { proof_captured: 2 } })).eligible);
});
test("5/6. context/continuity projection accepted only if metadata-only", () => {
  assert.ok(classifyCandidate(cand("continuity", { status: "prepared", route: "deterministic_only", decisionsCount: 1 })).eligible);
});
test("7. full proof report rejected (sections present)", () => {
  assert.ok(classifyCandidate(cand("proof_report", { sections: { found: [] } })).blocked);
});
test("8. full value ledger rejected (entries present)", () => {
  assert.ok(classifyCandidate(cand("value_ledger", { entries: [{ x: 1 }] })).blocked);
});
test("9/10. full context/continuity packet rejected (objective/selectedRefs)", () => {
  assert.ok(classifyCandidate(cand("context_packet", { objective: "do x", selectedRefs: [] })).blocked);
});
test("11. selectedRefs rejected", () => assert.ok(classifyCandidate(cand("context_packet", { selectedRefs: [{ label: "a" }] })).blocked));
test("12. excludedRefs rejected", () => assert.ok(classifyCandidate(cand("context_packet", { excludedRefs: [{ label: "b" }] })).blocked));
test("13. objective/task text rejected", () => assert.ok(classifyCandidate(cand("proof_report", { objective: "secret task" })).blocked));
test("14. raw prompt rejected", () => assert.ok(classifyCandidate(cand("token_cost_evidence", { prompt: "do the thing" })).blocked));
test("15. raw secret rejected", () => {
  const r = classifyCandidate(cand("token_cost_evidence", { note: `x ${TOK}`, count: 1 }));
  assert.ok(r.blocked);
  assert.equal(ser(r).includes(TOK), false);
});
test("16. raw source rejected", () => assert.ok(classifyCandidate(cand("value_ledger", { sourceCode: "function(){}" })).blocked));
test("17. env value rejected", () => assert.ok(classifyCandidate(cand("token_cost_evidence", { blob: "SECRET_KEY=abc123def" })).blocked));
test("18. terminal log rejected", () => assert.ok(classifyCandidate(cand("token_cost_evidence", { log: "[31mERR[0m" })).blocked));
test("19. git diff rejected", () => assert.ok(classifyCandidate(cand("token_cost_evidence", { d: "diff --git a/x b/x" })).blocked));
test("20. sensitive path labels rejected", () => assert.ok(classifyCandidate(cand("context_packet", { p: "/Users/benja/.ssh/id_rsa" })).blocked));
test("21. blocked projection includes reason codes only (no payload)", () => {
  const r = classifyCandidate(cand("proof_report", { sections: { found: [] }, objective: "x" }));
  assert.ok(r.blocked && r.blocked.blockedReasonCodes.length > 0);
  assert.equal((r.blocked as unknown as Record<string, unknown>).metadata, undefined);
});
test("22/23. envelope projectionOnly true + fullArtifactsSynced false", () => {
  const env = buildEfficiencyMetadataSyncEnvelope({ candidates: [cand("token_cost_evidence", tcMeta as never)] });
  assert.equal(env.syncPolicy.projectionOnly, true);
  assert.equal(env.syncPolicy.fullArtifactsSynced, false);
});
test("24. envelope serialization contains no raw unsafe values", () => {
  const env = buildEfficiencyMetadataSyncEnvelope({ candidates: [cand("token_cost_evidence", { note: `x ${TOK}` }), cand("token_cost_evidence", tcMeta as never)] });
  assert.equal(ser(env).includes(TOK), false);
});
test("28. no projection can bypass evaluateReceiptSafety (screen returns reasons)", () => {
  assert.ok(screenProjectionMetadata({ prompt: "x" }).length > 0);
  assert.equal(screenProjectionMetadata(tcMeta).length, 0);
});
test("29. projection helper failure does not fallback to full artifact (blocked, no payload)", () => {
  const env = buildEfficiencyMetadataSyncEnvelope({ candidates: [cand("proof_report", { sections: {} })] });
  assert.equal(env.eligible.length, 0);
  assert.equal(env.blocked.length, 1);
  assert.equal((env.blocked[0] as unknown as Record<string, unknown>).metadata, undefined);
});
test("validate envelope passes for clean, fails for tampered", () => {
  const env = buildEfficiencyMetadataSyncEnvelope({ candidates: [cand("token_cost_evidence", tcMeta as never)] });
  assert.equal(validateEfficiencyMetadataSyncEnvelope(env).valid, true);
  const tampered = { ...env, syncPolicy: { ...env.syncPolicy, fullArtifactsSynced: true as unknown as false } };
  assert.equal(validateEfficiencyMetadataSyncEnvelope(tampered as never).valid, false);
});
test("mixed eligible + blocked", () => {
  const env = buildEfficiencyMetadataSyncEnvelope({ candidates: [cand("token_cost_evidence", tcMeta as never), cand("proof_report", { objective: "x" })] });
  assert.equal(env.eligible.length, 1);
  assert.equal(env.blocked.length, 1);
});
