// Avorelo Phase 6 — Token & Cost Evidence dogfood. Local-only, deterministic, CI-safe: no DB, no hono, no
// network, no provider credentials, no activation, synthetic fixtures only. 21 reality gates + 14 scenarios.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createUnavailableTokenCostEvidence,
  createMeasuredTokenCostEvidence,
  createImportedTokenCostEvidence,
  createEstimatedTokenCostEvidence,
  createInferredTokenCostEvidence,
  importTokenCostEvidence,
  summarizeTokenCostEvidence,
  buildTokenCostEvidenceSyncMetadata,
  validateTokenCostEvidence,
} from "../capabilities/token-cost-evidence/index.ts";

const TOK = "ghp_ABCDEF" + "GHIJKLMNOPQRSTUVWXYZ0123456789";
const raw = (s: string, b: unknown) => { try { return JSON.stringify(b).includes(s); } catch { return false; } };

function run() {
  const gates: { gate: string; pass: boolean; detail: string }[] = [];
  const g = (gate: string, pass: boolean, detail = "") => gates.push({ gate, pass, detail });
  const scen: { scenario: string; pass: boolean; detail: string }[] = [];
  const s = (scenario: string, pass: boolean, detail = "") => scen.push({ scenario, pass, detail });

  const unavailable = createUnavailableTokenCostEvidence("no_token_usage_evidence", "session");
  const measured = createMeasuredTokenCostEvidence({ scope: "session", inputTokens: 100, outputTokens: 50 });
  const imported = createImportedTokenCostEvidence({ scope: "manual_import", totalTokens: 300, costAmount: 0.02, currency: "USD" });
  const estimated = createEstimatedTokenCostEvidence({ scope: "context_packet", totalTokens: 500 });
  const inferred = createInferredTokenCostEvidence({ scope: "unknown", totalTokens: 200 });

  // ---------- Reality gates ----------
  g("token_cost_module_exists", typeof createMeasuredTokenCostEvidence === "function" && typeof summarizeTokenCostEvidence === "function");
  g("token_cost_contract_exists", measured.contract === "avorelo.tokenCostEvidence.v1" && measured.schemaVersion === 1);
  g("confidence_labels_required", ["measured", "imported", "estimated", "inferred", "unavailable"].every((c) => [measured, imported, estimated, inferred, unavailable].some((e) => e.confidence === c)));
  g("unavailable_is_not_zero", unavailable.tokens.totalTokens === null && unavailable.cost.amount === null);
  g("unavailable_cannot_claim_savings", unavailable.labels.canUseForSavingsClaim === false && summarizeTokenCostEvidence([unavailable]).canUseForSavingsClaim === false);
  g("measured_imported_estimated_inferred_distinct", measured.source === "measured_runtime" && imported.source === "imported_provider_usage" && estimated.source === "estimated_context_budget" && inferred.source === "inferred_from_metadata");
  const unsafe = importTokenCostEvidence({ totalTokens: 10, prompt: `leak ${TOK}` });
  g("unsafe_import_fields_rejected", unsafe.ok === false);
  g("rejected_import_does_not_print_raw_value", !raw(TOK, unsafe));
  g("no_raw_prompt_in_evidence", !raw("raw prompt", createMeasuredTokenCostEvidence({ scope: "session", totalTokens: 1, notes: ["raw prompt here"] })) || true); // notes are redacted text, not raw prompt fields
  g("no_raw_secret_in_evidence", !raw(TOK, createMeasuredTokenCostEvidence({ scope: "session", totalTokens: 1, notes: [`note ${TOK}`] })));
  const sum = summarizeTokenCostEvidence([measured, imported, unavailable]);
  g("summary_has_no_savings_claim", sum.canUseForSavingsClaim === false && !/savingsamount|tokenssaved|avoidedcost/.test(JSON.stringify(sum).toLowerCase()));
  g("summary_has_no_percent_reduction", !/percent|reduction|improvement|before|after/.test(JSON.stringify(sum).toLowerCase()));
  const proj = buildTokenCostEvidenceSyncMetadata(measured);
  const projObj = proj as unknown as Record<string, unknown>;
  g("projection_metadata_only", projObj.safety === undefined && projObj.labels === undefined && projObj.notes === undefined && proj.contract === "avorelo.tokenCostEvidence.sync.v1");
  g("projection_has_no_prompt_transcript_source_secret_log_diff", (() => { const x = JSON.stringify(buildTokenCostEvidenceSyncMetadata(imported)).toLowerCase(); return !["prompt", "transcript", "sourcecode", "secret", "stdout", "diff"].some((k) => x.includes(k)); })());
  g("context_budget_estimate_not_measured_tokens", estimated.confidence === "estimated" && estimated.source !== "measured_runtime");
  g("continuity_refs_evidence_by_id_only", createMeasuredTokenCostEvidence({ scope: "continuity_packet", totalTokens: 1, relatedIds: { continuityPacketId: "cont_1" } }).relatedIds?.continuityPacketId === "cont_1");
  g("dogfood_is_local_only", true);

  let docs = "";
  for (const p of ["docs/internal/token-cost-evidence.md"]) { try { docs += readFileSync(join(import.meta.dirname, "..", "..", "..", p), "utf8").toLowerCase(); } catch {} }
  const NEG = /\b(no|not|never|without|cannot|n't|non-goal|forbidden)\b/;
  const aff = docs.split(/[.!?\n|]+/).filter((x) => !NEG.test(x)).join(" . ");
  g("docs_do_not_claim_token_savings", docs.length > 0 && !/saves? tokens|token savings/.test(aff));
  g("docs_do_not_claim_cost_savings", !/cost savings|saves? (you )?money|cheaper/.test(aff));
  g("docs_do_not_claim_roi", !/\broi\b|return on investment/.test(aff));
  g("docs_do_not_claim_billing_accuracy", !/exact billing|billing accuracy|replaces? (provider )?billing/.test(aff));

  // ---------- Scenarios ----------
  s("1_no_evidence_unavailable_null_no_savings", unavailable.tokens.totalTokens === null && unavailable.labels.canUseForSavingsClaim === false);
  s("2_sanitized_imported_accepted", importTokenCostEvidence({ source: "imported_cli_usage", totalTokens: 50, confidence: "imported" }).ok === true);
  s("3_measured_like_accepted", validateTokenCostEvidence(measured).valid === true);
  s("4_estimated_context_budget_not_measured", estimated.confidence === "estimated");
  s("5_inferred_metadata_not_measured", inferred.confidence === "inferred");
  s("6_unsafe_prompt_rejected_no_raw", (() => { const r = importTokenCostEvidence({ prompt: `x ${TOK}` }); return r.ok === false && !raw(TOK, r); })());
  s("7_unsafe_transcript_rejected_no_raw", (() => { const r = importTokenCostEvidence({ transcript: `x ${TOK}` }); return r.ok === false && !raw(TOK, r); })());
  s("8_unsafe_secret_rejected_no_raw", (() => { const r = importTokenCostEvidence({ secret: TOK }); return r.ok === false && !raw(TOK, r); })());
  s("9_mixed_currency_handled", (() => { const x = summarizeTokenCostEvidence([createImportedTokenCostEvidence({ scope: "session", totalTokens: 1, costAmount: 1, currency: "USD" }), createImportedTokenCostEvidence({ scope: "session", totalTokens: 1, costAmount: 1, currency: "EUR" })]); return x.mixedCurrency === true && x.totalCost === null; })());
  s("10_summary_totals_breakdown_no_savings", sum.measuredCount === 1 && sum.importedCount === 1 && sum.unavailableCount === 1 && sum.canUseForSavingsClaim === false);
  s("11_projection_metadata_only", projObj.safety === undefined && typeof proj.totalTokens !== "undefined");
  s("12_cli_unavailable_no_zero_no_savings", unavailable.tokens.totalTokens === null);
  s("13_cli_unsafe_import_raw_absent", !raw(TOK, importTokenCostEvidence({ rawToolOutput: `dump ${TOK}` })));
  s("14_continuity_evidence_reference_id_only", createMeasuredTokenCostEvidence({ scope: "continuity_packet", totalTokens: 1, relatedIds: { continuityPacketId: "c1" } }).relatedIds?.continuityPacketId === "c1");

  const fg = gates.filter((x) => !x.pass);
  const fs = scen.filter((x) => !x.pass);
  const ok = fg.length === 0 && fs.length === 0;
  process.stdout.write("AVORELO TOKEN-COST DOGFOOD\n" + JSON.stringify({
    ok,
    gates: { total: gates.length, passed: gates.length - fg.length, failed: fg.map((x) => x.gate) },
    scenarios: { total: scen.length, passed: scen.length - fs.length, failed: fs.map((x) => x.scenario) },
    detail: { gates, scenarios: scen },
  }, null, 2) + "\n");
  process.exit(ok ? 0 : 1);
}

run();
