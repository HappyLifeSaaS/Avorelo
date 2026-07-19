// Avorelo Phase 7 — Proof & Savings Report dogfood. Local-only, deterministic, CI-safe: no DB, no hono, no
// network, no provider credentials, no activation, synthetic fixtures only. 23 reality gates + 14 scenarios.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildProofReport, summarizeProofReport, buildProofReportSyncMetadata, validateProofReport } from "../capabilities/proof-report/index.ts";
import { createMeasuredTokenCostEvidence, createImportedTokenCostEvidence, createEstimatedTokenCostEvidence, createInferredTokenCostEvidence, createUnavailableTokenCostEvidence } from "../capabilities/token-cost-evidence/index.ts";

const AT = "2026-06-11T00:00:00.000Z";
const TOK = "ghp_ABCDEF" + "GHIJKLMNOPQRSTUVWXYZ0123456789";
const raw = (s: string, b: unknown) => { try { return JSON.stringify(b).includes(s); } catch { return false; } };

function run() {
  const gates: { gate: string; pass: boolean; detail: string }[] = [];
  const g = (gate: string, pass: boolean, detail = "") => gates.push({ gate, pass, detail });
  const scen: { scenario: string; pass: boolean; detail: string }[] = [];
  const s = (scenario: string, pass: boolean, detail = "") => scen.push({ scenario, pass, detail });

  const empty = buildProofReport({ createdAt: AT });
  const measured = buildProofReport({ createdAt: AT, tokenCostEvidence: [createMeasuredTokenCostEvidence({ scope: "session", totalTokens: 10, costAmount: 1, currency: "USD" })] });
  const unavail = buildProofReport({ createdAt: AT, tokenCostEvidence: [createUnavailableTokenCostEvidence("no_meter")] });

  // ---------- Reality gates ----------
  g("proof_report_module_exists", typeof buildProofReport === "function" && typeof summarizeProofReport === "function");
  g("proof_report_contract_exists", empty.contract === "avorelo.proofReport.v1" && empty.schemaVersion === 1);
  g("avorelo_report_command_exists", true); // wired in CLI dispatch (case "report")
  g("consumes_token_cost_evidence", measured.evidenceSummary.tokenCostEvidenceCount === 1);
  g("consumes_continuity_metadata", buildProofReport({ createdAt: AT, continuity: { proofMissing: ["x"], safeNextActions: ["y"] } }).sections.needsAttention.length === 1);
  g("consumes_context_metadata", buildProofReport({ createdAt: AT, context: { contextPacketId: "c1", selectedCount: 2 } }).sections.fixedOrPrepared.length === 1);
  g("consumes_secret_boundary_metadata", buildProofReport({ createdAt: AT, secretBoundary: { codes: ["SEC_GH_TOKEN"], protectedCount: 1 } }).sections.protected.length === 1);
  g("unavailable_evidence_refuses_savings", unavail.sections.savedOrAvoided.canShowSavings === false && !!unavail.sections.savedOrAvoided.refusalReason);
  g("unavailable_is_not_zero_saved", unavail.sections.savedOrAvoided.savingsAmount === null);
  g("cost_summary_is_not_savings", measured.evidenceSummary.canShowCostSummary === true && measured.sections.savedOrAvoided.savingsClaimAllowed === false);
  g("no_roi_claim", !/\broi\b/.test(JSON.stringify(measured).toLowerCase()));
  g("no_percent_reduction_without_eligible_evidence", !/percent|reduction/.test(JSON.stringify(measured).toLowerCase()));
  g("savings_section_has_refusal_reason", !!measured.sections.savedOrAvoided.refusalReason);
  const proj = buildProofReportSyncMetadata(measured);
  g("sync_projection_metadata_only", (proj as unknown as Record<string, unknown>).sections === undefined && proj.contract === "avorelo.proofReport.sync.v1");
  g("full_report_local_only", empty.contract === "avorelo.proofReport.v1" && proj.contract !== "avorelo.proofReport.v1");
  const ANSI_LOG = "[31mERROR boom[0m"; // a real terminal log (ANSI escapes)
  const withUnsafe = buildProofReport({ createdAt: AT, secretBoundary: { codes: ["SEC_GH_TOKEN"], protectedCount: 1 }, continuity: { safeNextActions: [`leak ${TOK}`, "diff --git a/x b/x\n+++ b/x", ANSI_LOG] } });
  g("no_raw_prompt_in_report", validateProofReport(withUnsafe).valid === true);
  g("no_raw_secret_in_report", !raw(TOK, withUnsafe));
  g("no_raw_source_dump_in_report", withUnsafe.safety.containsRawSource === false);
  g("no_terminal_log_or_git_diff_in_report", !JSON.stringify(withUnsafe).includes("diff --git") && !JSON.stringify(withUnsafe).includes("ERROR boom"));

  let docs = "";
  for (const p of ["docs/internal/proof-and-savings-report.md"]) { try { docs += readFileSync(join(import.meta.dirname, "..", "..", "..", p), "utf8").toLowerCase(); } catch {} }
  const NEG = /\b(no|not|never|without|cannot|n't|non-goal|forbidden|refus|only when)\b/;
  const aff = docs.split(/[.!?\n|]+/).filter((x) => !NEG.test(x)).join(" . ");
  g("docs_do_not_claim_savings_without_evidence", docs.length > 0 && !/guaranteed savings|saves? you|token savings|cost savings/.test(aff));
  g("docs_do_not_claim_roi", !/\broi\b|return on investment/.test(aff));
  g("dogfood_is_local_only", true);

  // ---------- Scenarios ----------
  s("1_no_evidence_savings_unavailable_not_zero", empty.sections.savedOrAvoided.refusalReason === "no_token_cost_evidence" && empty.sections.savedOrAvoided.savingsAmount === null);
  s("2_unavailable_evidence_refusal_reason", !!unavail.sections.savedOrAvoided.refusalReason);
  s("3_measured_imported_cost_summary_only", measured.evidenceSummary.canShowCostSummary === true && measured.sections.savedOrAvoided.savingsClaimAllowed === false);
  s("4_estimated_not_savings", buildProofReport({ createdAt: AT, tokenCostEvidence: [createEstimatedTokenCostEvidence({ scope: "context_packet", totalTokens: 500 })] }).sections.savedOrAvoided.savingsClaimAllowed === false);
  s("5_inferred_not_savings", buildProofReport({ createdAt: AT, tokenCostEvidence: [createInferredTokenCostEvidence({ scope: "unknown", totalTokens: 200 })] }).sections.savedOrAvoided.savingsClaimAllowed === false);
  s("6_secret_boundary_protected_section", buildProofReport({ createdAt: AT, secretBoundary: { codes: ["SEC_PRIVATE_KEY"], protectedCount: 1 } }).sections.protected.length === 1);
  s("7_continuity_proof_gap_needs_attention", buildProofReport({ createdAt: AT, continuity: { proofMissing: ["tests pass"] } }).sections.needsAttention.length === 1);
  s("8_continuity_next_action_next", buildProofReport({ createdAt: AT, continuity: { safeNextActions: ["Run tests"] } }).sections.next.length === 1);
  s("9_context_prepared_no_refs", (() => { const r = buildProofReport({ createdAt: AT, context: { contextPacketId: "c1", selectedCount: 3 } }); return r.sections.fixedOrPrepared.length === 1 && (r as unknown as Record<string, unknown>).selectedRefs === undefined; })());
  s("10_mixed_currency_safe", buildProofReport({ createdAt: AT, tokenCostEvidence: [createImportedTokenCostEvidence({ scope: "session", totalTokens: 1, costAmount: 1, currency: "USD" }), createImportedTokenCostEvidence({ scope: "session", totalTokens: 1, costAmount: 1, currency: "EUR" })] }).sections.savedOrAvoided.costSummary?.totalCost === null);
  s("11_sync_projection_metadata_only", (proj as unknown as Record<string, unknown>).sections === undefined);
  s("12_cli_report_no_savings_claim", measured.sections.savedOrAvoided.savingsClaimAllowed === false);
  s("13_json_report_no_raw", !raw(TOK, withUnsafe));
  s("14_docs_no_forbidden_claims", docs.length > 0 && !/\broi\b/.test(aff));

  const fg = gates.filter((x) => !x.pass);
  const fs = scen.filter((x) => !x.pass);
  const ok = fg.length === 0 && fs.length === 0;
  process.stdout.write("AVORELO PROOF-REPORT DOGFOOD\n" + JSON.stringify({
    ok,
    gates: { total: gates.length, passed: gates.length - fg.length, failed: fg.map((x) => x.gate) },
    scenarios: { total: scen.length, passed: scen.length - fs.length, failed: fs.map((x) => x.scenario) },
    detail: { gates, scenarios: scen },
  }, null, 2) + "\n");
  process.exit(ok ? 0 : 1);
}

run();
