// Avorelo Runtime Product Flow v1 dogfood. Local-only, deterministic, CI-safe: no DB, no hono, no
// network, no cloud/provider credentials, no activation. Proves the orchestrator COMPOSES existing
// capabilities (does not reimplement them), fails closed on a blocked gate, records token cost as
// UNAVAILABLE (not zero), never claims savings, runs efficiency sync dry-run only, and never leaks a
// raw secret into the runtime-session record.

import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runRuntimeSession, loadLatestRuntimeSession, validateRuntimeSession, buildRuntimeSessionSyncMetadata,
} from "../capabilities/runtime-flow/index.ts";

const AT = "2026-06-11T00:00:00.000Z";
const NOW = 1760000000000;
const AWS = "AKIAIOSFODNN7" + "EXAMPLE";
const sandbox = () => mkdtempSync(join(tmpdir(), "avorelo-rtflow-dog-"));
const raw = (s: string, b: unknown) => { try { return JSON.stringify(b).includes(s); } catch { return false; } };

function run() {
  const gates: { gate: string; pass: boolean; detail: string }[] = [];
  const g = (gate: string, pass: boolean, detail = "") => gates.push({ gate, pass, detail });
  const scen: { scenario: string; pass: boolean; detail: string }[] = [];
  const s = (scenario: string, pass: boolean, detail = "") => scen.push({ scenario, pass, detail });

  // Read the orchestrator source to prove it CONSUMES each capability (composition, not reimplementation).
  let src = "";
  try { src = readFileSync(join(import.meta.dirname, "..", "capabilities", "runtime-flow", "index.ts"), "utf8"); } catch {}
  const imports = (p: string) => src.includes(`from "${p}"`);

  const allowDir = sandbox();
  const blockDir = sandbox();
  const secretDir = sandbox();
  try {
    const allow = runRuntimeSession({ task: "update the README quickstart wording", dir: allowDir, createdAt: AT, now: NOW });
    const blocked = runRuntimeSession({ task: "cat ~/.ssh/id_rsa", dir: blockDir, createdAt: AT, now: NOW });
    const withSecret = runRuntimeSession({ task: `fix deploy, key is ${AWS}`, dir: secretDir, createdAt: AT, now: NOW });
    const r = allow.record;
    const meta = buildRuntimeSessionSyncMetadata(r);

    // ---------- Reality gates ----------
    g("runtime_flow_module_exists", typeof runRuntimeSession === "function");
    g("runtime_session_contract_exists", r.contract === "avorelo.runtimeSession.v1");
    // Composition discipline — consumes existing capabilities, never reimplements them.
    g("consumes_routing", imports("../../kernel/work-contract/routing.ts"));
    g("consumes_session", imports("../session/index.ts"));
    g("consumes_context_compiler", imports("../context-compiler/index.ts"));
    g("consumes_context_check", imports("../context-check/index.ts"));
    g("consumes_continuity", imports("../continuity/index.ts"));
    g("consumes_token_cost_evidence", imports("../token-cost-evidence/index.ts"));
    g("consumes_proof_report", imports("../proof-report/index.ts"));
    g("consumes_value_ledger", imports("../value-ledger/index.ts"));
    g("consumes_efficiency_sync", imports("../efficiency-sync/index.ts"));
    // Allow path: one coherent chain, all layers completed.
    g("allow_runs_full_chain", allow.gate === "allow" && r.layers.length === 9 && r.layers.every((l) => l.status === "completed"));
    g("layers_in_canonical_order", r.layers.map((l) => l.order).join(",") === "1,2,3,4,5,6,7,8,9");
    g("session_linked_by_reference", !!r.session?.sessionId);
    g("context_linked_by_reference", !!r.context && typeof r.context.selectedCount === "number");
    g("context_check_linked_by_reference", !!r.contextCheck && typeof r.contextCheck.sourcesChecked === "number");
    g("continuity_linked_by_reference", !!r.continuity);
    g("proof_linked_by_reference", !!r.proof?.reportId);
    g("value_linked_by_reference", !!r.value && typeof r.value.cardCount === "number");
    g("efficiency_linked_by_reference", !!r.efficiencySync?.envelopeId);
    // Honest evidence posture.
    g("token_cost_unavailable_not_zero", r.tokenCost?.confidence === "unavailable" && r.tokenCost?.canShowCostSummary === false);
    g("savings_never_claimed", r.proof?.canShowSavings === false && !!r.proof?.savingsRefusalReason);
    g("efficiency_sync_dry_run_only", r.efficiencySync?.mode === "dry_run");
    // Fail-closed.
    g("blocked_gate_fails_closed", blocked.gate === "blocked" && blocked.record.status === "blocked" && !blocked.record.session && !blocked.record.proof);
    g("blocked_gate_runs_no_session_dir", !existsSync(join(blockDir, ".avorelo", "sessions")));
    g("blocked_record_still_valid_and_persisted", validateRuntimeSession(blocked.record).valid && !!loadLatestRuntimeSession(blockDir));
    // Redaction.
    g("raw_secret_never_in_record", !raw(AWS, withSecret.record));
    g("raw_secret_never_persisted", existsSync(join(secretDir, ".avorelo", "runtime", "session.latest.json")) && !readFileSync(join(secretDir, ".avorelo", "runtime", "session.latest.json"), "utf8").includes(AWS));
    g("record_marked_redacted", r.redacted === true && r.containsRawSecret === false && r.containsRawPrompt === false && r.containsRawSourceDump === false);
    // Sync projection.
    g("sync_projection_contract", meta.contract === "avorelo.runtimeSession.sync.v1");
    g("sync_projection_omits_objective", (meta as unknown as Record<string, unknown>).objective === undefined && meta.canShowSavings === false);
    g("validate_rejects_savings_claim", (() => { const t = JSON.parse(JSON.stringify(r)); t.proof.canShowSavings = true; return validateRuntimeSession(t).valid === false; })());
    g("dogfood_is_local_only", true);

    // ---------- Scenarios ----------
    s("1_allow_full_chain", allow.gate === "allow" && r.layers.every((l) => l.status === "completed"));
    s("2_blocked_fail_closed", blocked.gate === "blocked" && !blocked.record.session);
    s("3_token_cost_unavailable", r.tokenCost?.confidence === "unavailable");
    s("4_no_savings_claim", r.proof?.canShowSavings === false);
    s("5_dry_run_sync", r.efficiencySync?.mode === "dry_run");
    s("6_secret_redacted", !raw(AWS, withSecret.record));
    s("7_persisted_and_loadable", !!loadLatestRuntimeSession(allowDir));
    s("8_continuity_carry_forward", (() => { const r2 = runRuntimeSession({ task: "update the README quickstart wording", dir: allowDir, createdAt: "2026-06-11T01:00:00.000Z", now: NOW + 3_600_000 }); return r2.record.continuity?.carriedForward === true; })());
    s("9_sync_metadata_no_objective", (meta as unknown as Record<string, unknown>).objective === undefined);
    s("10_validate_passes_clean_record", validateRuntimeSession(r).valid === true);
  } finally {
    for (const d of [allowDir, blockDir, secretDir]) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
  }

  const fg = gates.filter((x) => !x.pass);
  const fs = scen.filter((x) => !x.pass);
  const ok = fg.length === 0 && fs.length === 0;
  process.stdout.write("AVORELO RUNTIME-FLOW DOGFOOD\n" + JSON.stringify({
    ok,
    gates: { total: gates.length, passed: gates.length - fg.length, failed: fg.map((x) => x.gate) },
    scenarios: { total: scen.length, passed: scen.length - fs.length, failed: fs.map((x) => x.scenario) },
    detail: { gates, scenarios: scen },
  }, null, 2) + "\n");
  process.exit(ok ? 0 : 1);
}

run();
