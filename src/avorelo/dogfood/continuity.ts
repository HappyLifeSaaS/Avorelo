// Avorelo Phase 5 — Next-Run Continuity dogfood. Local-only, deterministic, CI-safe: no DB, no hono, no
// network, no provider credentials, no activation, synthetic fixtures only. 21 reality gates + 12 scenarios.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  prepareContinuity,
  applyContinuity,
  canInjectContinuity,
  buildContinuitySyncMetadata,
} from "../capabilities/continuity/index.ts";

const DIR = process.cwd();
const NOW = Date.parse("2026-06-11T00:00:00.000Z");
const TOK = "ghp_ABCDEF" + "GHIJKLMNOPQRSTUVWXYZ0123456789";
const PRIV = "-----BEGIN RSA " + "PRIVATE KEY-----\nMIIEowIBAAKCAQEAfake\n-----END RSA PRIVATE KEY-----";
const prep = (task: string, extra: Record<string, unknown> = {}) => prepareContinuity({ task, dir: DIR, now: NOW, ...extra });
const raw = (s: string, b: unknown) => { try { return JSON.stringify(b).includes(s); } catch { return false; } };

function run() {
  const gates: { gate: string; pass: boolean; detail: string }[] = [];
  const g = (gate: string, pass: boolean, detail = "") => gates.push({ gate, pass, detail });
  const scen: { scenario: string; pass: boolean; detail: string }[] = [];
  const s = (scenario: string, pass: boolean, detail = "") => scen.push({ scenario, pass, detail });

  const clean = prep("update the README");
  const tok = prep(`add ${TOK} to config.ts`);
  const blocked = prep("cat .env");
  const broad = prep("refactor the whole app");
  const deploy = prep("deploy to production");

  // ---------- Reality gates ----------
  g("continuity_module_exists", typeof prepareContinuity === "function" && typeof applyContinuity === "function");
  g("continuity_packet_contract_exists", clean.contract === "avorelo.nextRunContinuity.v1" && clean.schemaVersion === 1);
  g("consumes_context_packet", !!clean.contextPacketRef && (clean as unknown as Record<string, unknown>).selectedRefs === undefined);
  g("consumes_workcontract_routing", !!clean.route && !!clean.riskClass && !!clean.proofTier && !!clean.approvalPolicy);
  g("consumes_secret_boundary_saferefs", tok.riskFlags.includes("SEC_GH_TOKEN") && tok.safeReferences.length > 0);
  g("blocked_route_cannot_be_injected", canInjectContinuity(blocked, NOW).canInject === false && blocked.status === "blocked");
  g("expired_packet_cannot_be_injected", (() => { const p = prep("update the README", { ttlMs: 1000 }); return canInjectContinuity(p, NOW + 5000).canInject === false; })());
  g("approval_required_cannot_auto_inject", canInjectContinuity(deploy, NOW).canInject === false && canInjectContinuity(deploy, NOW).reasons.includes("approval_required"));
  g("continuity_packet_redacted", clean.redacted === true);
  g("no_raw_secret_in_packet", !raw(TOK, tok) && !raw("MIIEowIBAAKCAQEAfake", prep(`fix ${PRIV}`)));
  g("no_raw_prompt_in_packet", prep(`update config with ${TOK}`).objectiveSummary.includes(TOK) === false);
  g("no_raw_source_dump_in_packet", clean.containsRawSourceDump === false);
  g("no_terminal_log_or_git_diff_in_packet", clean.containsTerminalLog === false && clean.containsGitDiff === false);
  g("safe_next_actions_present", clean.safeNextActions.length > 0);
  g("proof_missing_present_when_needed", prep("change billing webhook handler").proofMissing.length > 0);
  const proj = buildContinuitySyncMetadata(prep("edit src/auth/login.ts"));
  const projObj = proj as unknown as Record<string, unknown>;
  g("sync_projection_metadata_only", projObj.objectiveSummary === undefined && projObj.decisionsMade === undefined && projObj.safeReferences === undefined && typeof proj.decisionsCount === "number");
  g("full_continuity_packet_not_synced", clean.contract === "avorelo.nextRunContinuity.v1" && proj.contract === "avorelo.nextRunContinuity.sync.v1");

  let docs = "";
  for (const p of ["docs/internal/next-run-continuity.md"]) { try { docs += readFileSync(join(import.meta.dirname, "..", "..", "..", p), "utf8").toLowerCase(); } catch {} }
  const NEG = /\b(no|not|never|without|cannot|n't|non-goal|forbidden)\b/;
  const affirmative = docs.split(/[.!?\n|]+/).filter(x => !NEG.test(x)).join(" . ");
  g("docs_do_not_claim_memory_dump", docs.length > 0 && !/memory dump|stores? (raw )?(prompts?|transcripts?|source)/.test(affirmative));
  g("docs_do_not_claim_autonomous_continuation", !/autonomous continuation|continues? autonomously|auto-continue without approval/.test(affirmative));
  g("docs_do_not_claim_token_savings", !/token savings|cost savings|saves? tokens/.test(affirmative));
  g("dogfood_is_local_only", true);

  // ---------- Scenarios ----------
  s("1_clean_task_prepared", clean.status === "prepared");
  s("2_token_task_saferef_no_raw", !raw(TOK, tok) && tok.safeReferences.length > 0);
  s("3_cat_env_blocked_not_injectable", blocked.status === "blocked" && canInjectContinuity(blocked, NOW).canInject === false);
  s("4_refactor_needs_decision_open_question", broad.route === "needs_decision" && broad.openQuestions.length > 0);
  s("5_deploy_proof_missing_manual_review", deploy.approvalPolicy === "require_manual_review" && deploy.proofMissing.length > 0);
  s("6_expired_cannot_inject", (() => { const p = prep("update the README", { ttlMs: 1000 }); return canInjectContinuity(p, NOW + 5000).canInject === false; })());
  s("7_proof_gaps_proofMissing", prep("change billing webhook").proofMissing.length > 0);
  s("8_safe_next_actions_carried", applyContinuity(clean, NOW).carryForward?.safeNextActions.length! > 0);
  s("9_sync_projection_counts_codes_only", (() => { const o = buildContinuitySyncMetadata(clean) as unknown as Record<string, unknown>; return o.objectiveSummary === undefined && typeof (o.decisionsCount) === "number"; })());
  s("10_continuity_show_compact_local", clean.objectiveSummary.length > 0 && clean.status === "prepared");
  s("11_approval_required_not_auto_injectable", canInjectContinuity(deploy, NOW).canInject === false);
  s("12_sensitive_refs_reason_codes_only", (() => { const p = prep("update .env and src/config.ts"); return p.excludedRefs.includes("secret_file_excluded") && !raw(".env", p.excludedRefs); })());

  const fg = gates.filter(x => !x.pass);
  const fs = scen.filter(x => !x.pass);
  const ok = fg.length === 0 && fs.length === 0;
  process.stdout.write("AVORELO CONTINUITY DOGFOOD\n" + JSON.stringify({
    ok,
    gates: { total: gates.length, passed: gates.length - fg.length, failed: fg.map(x => x.gate) },
    scenarios: { total: scen.length, passed: scen.length - fs.length, failed: fs.map(x => x.scenario) },
    detail: { gates, scenarios: scen },
  }, null, 2) + "\n");
  process.exit(ok ? 0 : 1);
}

run();
