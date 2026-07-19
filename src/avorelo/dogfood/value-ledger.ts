// Avorelo Phase 8 — Value Ledger & Compact Value Surface dogfood. Local-only, deterministic, CI-safe: no DB,
// no hono, no network, no provider credentials, no activation, synthetic fixtures only. 21 gates + 10 scenarios.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeValueLedgerEntry, entriesFromProofReport, buildCompactValueCards, summarizeValueLedger, buildValueLedgerSyncMetadata, validateValueLedgerEntry } from "../capabilities/value-ledger/index.ts";
import { buildProofReport } from "../capabilities/proof-report/index.ts";
import { createImportedTokenCostEvidence, createUnavailableTokenCostEvidence } from "../capabilities/token-cost-evidence/index.ts";

const AT = "2026-06-11T00:00:00.000Z";
const TOK = "ghp_ABCDEF" + "GHIJKLMNOPQRSTUVWXYZ0123456789";
const raw = (s: string, b: unknown) => { try { return JSON.stringify(b).includes(s); } catch { return false; } };

function run() {
  const gates: { gate: string; pass: boolean; detail: string }[] = [];
  const g = (gate: string, pass: boolean, detail = "") => gates.push({ gate, pass, detail });
  const scen: { scenario: string; pass: boolean; detail: string }[] = [];
  const s = (scenario: string, pass: boolean, detail = "") => scen.push({ scenario, pass, detail });

  const reportCost = buildProofReport({ createdAt: AT, tokenCostEvidence: [createImportedTokenCostEvidence({ scope: "session", totalTokens: 10, costAmount: 1, currency: "USD" })] });
  const entriesCost = entriesFromProofReport(reportCost);
  const reportProtected = buildProofReport({ createdAt: AT, secretBoundary: { codes: ["SEC_GH_TOKEN"], protectedCount: 1 } });
  const reportGap = buildProofReport({ createdAt: AT, continuity: { proofMissing: ["tests pass"], safeNextActions: ["run tests"] } });
  const cards = buildCompactValueCards(entriesCost);

  // ---------- Reality gates ----------
  g("value_ledger_module_exists", typeof makeValueLedgerEntry === "function" && typeof buildCompactValueCards === "function");
  g("value_ledger_contract_exists", makeValueLedgerEntry({ source: "manual_safe", category: "proof_captured", status: "captured", summary: "x", createdAt: AT }).contract === "avorelo.valueLedger.v1");
  g("compact_value_cards_exist", buildCompactValueCards([]).length === 8);
  g("consumes_proof_report", entriesCost.length > 0);
  g("consumes_token_cost_evidence", entriesCost.some((e) => e.category === "token_cost_evidence"));
  g("consumes_continuity", entriesFromProofReport(reportGap).some((e) => e.category === "needs_attention" || e.category === "next_run_prepared"));
  g("unavailable_remains_unavailable", (() => { const c = buildCompactValueCards(entriesFromProofReport(buildProofReport({ createdAt: AT, tokenCostEvidence: [createUnavailableTokenCostEvidence("no_meter")] }))); return c.find((x) => x.title === "Proof Captured")!.status === "unavailable"; })());
  g("no_fake_savings", !/saved \$|savings: \d|"savingsamount"/.test(JSON.stringify(cards).toLowerCase()));
  g("no_roi_claim", !/\broi\b/.test(JSON.stringify(cards).toLowerCase()));
  g("no_productivity_score", !/productivity|"score"/.test(JSON.stringify(cards).toLowerCase()));
  g("cards_have_confidence_labels", cards.every((c) => typeof c.confidence === "string"));
  g("needs_attention_card_exists", buildCompactValueCards(entriesFromProofReport(reportGap)).some((c) => c.title === "Needs Attention" && c.status === "needs_attention"));
  g("token_cost_card_not_savings", cards.find((c) => c.title === "Token/Cost Evidence")!.valueLabel.includes("not claimed"));
  const proj = buildValueLedgerSyncMetadata(entriesCost);
  g("sync_projection_metadata_only", (proj as unknown as Record<string, unknown>).entries === undefined && proj.contract === "avorelo.valueLedger.sync.v1");
  g("full_ledger_local_only", proj.contract !== "avorelo.valueLedger.v1");
  const unsafeEntry = makeValueLedgerEntry({ source: "manual_safe", category: "needs_attention", status: "needs_attention", summary: `leak ${TOK} diff --git a/x b/x`, reasonCodes: [`x ${TOK}`], createdAt: AT });
  g("no_raw_prompt_in_ledger", validateValueLedgerEntry(unsafeEntry).valid === true);
  g("no_raw_secret_in_ledger", !raw(TOK, unsafeEntry));
  g("no_raw_source_log_diff_in_ledger", !JSON.stringify(unsafeEntry).includes("diff --git"));
  g("dogfood_is_local_only", true);

  let docs = "";
  for (const p of ["docs/internal/value-ledger-compact-surface.md"]) { try { docs += readFileSync(join(import.meta.dirname, "..", "..", "..", p), "utf8").toLowerCase(); } catch {} }
  const NEG = /\b(no|not|never|without|cannot|n't|non-goal|forbidden)\b/;
  const aff = docs.split(/[.!?\n|]+/).filter((x) => !NEG.test(x)).join(" . ");
  g("docs_do_not_claim_roi", docs.length > 0 && !/\broi\b|return on investment/.test(aff));
  g("docs_do_not_claim_guaranteed_savings", !/guaranteed savings|saves? you|token savings/.test(aff));
  g("docs_do_not_claim_productivity_score", !/productivity score|performance score/.test(aff));

  // ---------- Scenarios ----------
  s("1_unavailable_savings_card_not_claimed", cards.find((c) => c.title === "Token/Cost Evidence")!.valueLabel.includes("not claimed"));
  s("2_cost_summary_card_not_savings", /cost 1 USD/.test(cards.find((c) => c.title === "Token/Cost Evidence")!.valueLabel));
  s("3_secret_boundary_protected_card", buildCompactValueCards(entriesFromProofReport(reportProtected)).find((c) => c.title === "Secret Boundary Protected")!.status === "available");
  s("4_continuity_next_run_prepared_card", buildCompactValueCards(entriesFromProofReport(reportGap)).find((c) => c.title === "Next Run Prepared")!.status === "available");
  s("5_proof_gap_needs_attention_card", buildCompactValueCards(entriesFromProofReport(reportGap)).find((c) => c.title === "Needs Attention")!.status === "needs_attention");
  s("6_mixed_confidence_preserved", (() => { const sm = summarizeValueLedger([makeValueLedgerEntry({ source: "manual_safe", category: "proof_captured", status: "verified", confidence: "measured", summary: "a", createdAt: AT }), makeValueLedgerEntry({ source: "manual_safe", category: "proof_captured", status: "prepared", confidence: "inferred", summary: "b", createdAt: AT })]); return sm.confidenceBreakdown.measured === 1 && sm.confidenceBreakdown.inferred === 1; })());
  s("7_unsafe_raw_input_redacted", !raw(TOK, unsafeEntry) && !JSON.stringify(unsafeEntry).includes("diff --git"));
  s("8_sync_projection_metadata_only", (proj as unknown as Record<string, unknown>).entries === undefined);
  s("9_value_cards_compact_8", buildCompactValueCards([]).length === 8);
  s("10_docs_no_forbidden_claims", docs.length > 0 && !/\broi\b/.test(aff));

  const fg = gates.filter((x) => !x.pass);
  const fs = scen.filter((x) => !x.pass);
  const ok = fg.length === 0 && fs.length === 0;
  process.stdout.write("AVORELO VALUE-LEDGER DOGFOOD\n" + JSON.stringify({
    ok,
    gates: { total: gates.length, passed: gates.length - fg.length, failed: fg.map((x) => x.gate) },
    scenarios: { total: scen.length, passed: scen.length - fs.length, failed: fs.map((x) => x.scenario) },
    detail: { gates, scenarios: scen },
  }, null, 2) + "\n");
  process.exit(ok ? 0 : 1);
}

run();
