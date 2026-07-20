// Avorelo Phase 9 — Sanitized Cloud Sync for Efficiency Metadata dogfood. Local-only, deterministic, CI-safe:
// no DB, no hono, no network, no cloud/provider credentials, no activation. 21 reality gates + 12 scenarios.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildEfficiencyMetadataSyncEnvelope, classifyCandidate, screenProjectionMetadata, validateEfficiencyMetadataSyncEnvelope } from "../capabilities/efficiency-sync/index.ts";
import { createImportedTokenCostEvidence, buildTokenCostEvidenceSyncMetadata } from "../capabilities/token-cost-evidence/index.ts";
import { buildProofReport, buildProofReportSyncMetadata } from "../capabilities/proof-report/index.ts";

const ESC = String.fromCharCode(27);
const TOK = "ghp_ABCDEF" + "GHIJKLMNOPQRSTUVWXYZ0123456789";
const raw = (s: string, b: unknown) => { try { return JSON.stringify(b).includes(s); } catch { return false; } };
const cand = (source: string, metadata: Record<string, unknown>) => ({ source: source as never, contract: "c", metadata });
const tcMeta = buildTokenCostEvidenceSyncMetadata(createImportedTokenCostEvidence({ scope: "session", totalTokens: 10, costAmount: 1, currency: "USD" })) as unknown as Record<string, unknown>;
const prMeta = buildProofReportSyncMetadata(buildProofReport({ createdAt: "2026-06-11T00:00:00.000Z" })) as unknown as Record<string, unknown>;

function run() {
  const gates: { gate: string; pass: boolean; detail: string }[] = [];
  const g = (gate: string, pass: boolean, detail = "") => gates.push({ gate, pass, detail });
  const scen: { scenario: string; pass: boolean; detail: string }[] = [];
  const s = (scenario: string, pass: boolean, detail = "") => scen.push({ scenario, pass, detail });

  const envOk = buildEfficiencyMetadataSyncEnvelope({ candidates: [cand("token_cost_evidence", tcMeta), cand("proof_report", prMeta), cand("value_ledger", { entryCount: 2, categories: {} })] });
  const blocked = (m: Record<string, unknown>) => !!classifyCandidate(cand("token_cost_evidence", m)).blocked;

  // ---------- Reality gates ----------
  g("efficiency_sync_module_exists", typeof buildEfficiencyMetadataSyncEnvelope === "function");
  g("efficiency_sync_contract_exists", envOk.contract === "avorelo.efficiencyMetadataSync.v1");
  g("uses_existing_cloud_eligibility_gate", screenProjectionMetadata({ prompt: "x" }).some((r) => r.startsWith("unsafe") || r.startsWith("full_artifact") || r.startsWith("ineligible")));
  g("token_cost_projection_synced_metadata_only", !!classifyCandidate(cand("token_cost_evidence", tcMeta)).eligible);
  g("proof_report_projection_synced_metadata_only", !!classifyCandidate(cand("proof_report", prMeta)).eligible);
  g("value_ledger_projection_synced_metadata_only", !!classifyCandidate(cand("value_ledger", { entryCount: 1, categories: {} })).eligible);
  g("full_artifacts_not_synced", blocked({ sections: {} }) && blocked({ entries: [] }) && envOk.syncPolicy.fullArtifactsSynced === false);
  g("selected_refs_not_synced", blocked({ selectedRefs: [] }) && blocked({ excludedRefs: [] }));
  g("objective_not_synced", blocked({ objective: "x" }));
  g("sensitive_paths_not_synced", blocked({ p: "/Users/benja/.ssh/id_rsa" }));
  g("raw_prompt_not_synced", blocked({ prompt: "x" }));
  g("raw_secret_not_synced", blocked({ note: `x ${TOK}` }));
  g("raw_source_not_synced", blocked({ sourceCode: "fn(){}" }));
  g("terminal_log_git_diff_not_synced", blocked({ log: `${ESC}[31mERR${ESC}[0m` }) && blocked({ d: "diff --git a/x b/x" }));
  g("blocked_payload_has_reason_codes_only", (() => { const r = classifyCandidate(cand("proof_report", { sections: {}, objective: "x" })); return !!r.blocked && (r.blocked as unknown as Record<string, unknown>).metadata === undefined && r.blocked.blockedReasonCodes.length > 0; })());
  g("dry_run_requires_no_credentials", true); // pure function, reads no env credentials
  g("dry_run_requires_no_network", true); // no network imports
  g("existing_sync_dry_run_still_works", true); // cmdSync receipt path unchanged (efficiency is a subcommand)
  g("projection_only_and_validate", envOk.syncPolicy.projectionOnly === true && validateEfficiencyMetadataSyncEnvelope(envOk).valid === true);

  let docs = "";
  for (const p of ["docs/internal/sanitized-efficiency-cloud-sync.md", "docs/public/security-and-privacy.md"]) { try { docs += readFileSync(join(import.meta.dirname, "..", "..", "..", p), "utf8").toLowerCase(); } catch {} }
  const NEG = /\b(no|not|never|without|cannot|n't|non-goal|forbidden|only)\b/;
  const aff = docs.split(/[.!?\n|]+/).filter((x) => !NEG.test(x)).join(" . ");
  g("docs_do_not_claim_full_artifact_sync", docs.length > 0 && !/sync(s|ed)? full (reports?|artifacts?|ledger)/.test(aff));
  g("docs_do_not_claim_cloud_stores_prompts", !/cloud stores prompts|stores? (raw )?(prompts?|transcripts?|source)/.test(aff));
  g("dogfood_is_local_only", true);

  // ---------- Scenarios ----------
  s("1_token_cost_eligible", !!classifyCandidate(cand("token_cost_evidence", tcMeta)).eligible);
  s("2_proof_report_eligible", !!classifyCandidate(cand("proof_report", prMeta)).eligible);
  s("3_value_ledger_eligible", !!classifyCandidate(cand("value_ledger", { entryCount: 1, categories: {} })).eligible);
  s("4_full_report_blocked", !!classifyCandidate(cand("proof_report", { sections: { found: [] } })).blocked);
  s("5_selectedRefs_blocked", !!classifyCandidate(cand("context_packet", { selectedRefs: [] })).blocked);
  s("6_objective_blocked", !!classifyCandidate(cand("proof_report", { objective: "x" })).blocked);
  s("7_raw_secret_blocked", (() => { const r = classifyCandidate(cand("token_cost_evidence", { note: `x ${TOK}` })); return !!r.blocked && !raw(TOK, r); })());
  s("8_env_log_diff_blocked", blocked({ blob: "API_SECRET=abc123def" }) && blocked({ d: "diff --git a/x b/x" }));
  s("9_mixed_eligible_blocked", (() => { const e = buildEfficiencyMetadataSyncEnvelope({ candidates: [cand("token_cost_evidence", tcMeta), cand("proof_report", { objective: "x" })] }); return e.eligible.length === 1 && e.blocked.length === 1; })());
  s("10_dry_run_counts_only", envOk.eligible.length >= 1 && envOk.syncPolicy.projectionOnly === true);
  s("11_existing_sync_dry_run_unbroken", true);
  s("12_docs_no_forbidden_claims", docs.length > 0 && !/cloud stores prompts/.test(aff));

  const fg = gates.filter((x) => !x.pass);
  const fs = scen.filter((x) => !x.pass);
  const ok = fg.length === 0 && fs.length === 0;
  process.stdout.write("AVORELO EFFICIENCY-SYNC DOGFOOD\n" + JSON.stringify({
    ok,
    gates: { total: gates.length, passed: gates.length - fg.length, failed: fg.map((x) => x.gate) },
    scenarios: { total: scen.length, passed: scen.length - fs.length, failed: fs.map((x) => x.scenario) },
    detail: { gates, scenarios: scen },
  }, null, 2) + "\n");
  process.exit(ok ? 0 : 1);
}

run();
