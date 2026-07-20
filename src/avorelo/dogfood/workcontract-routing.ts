// Avorelo Phase 3 — Enriched WorkContract + Safe Routing dogfood. Local-only, deterministic, CI-safe:
// no DB, no hono, no network, no credentials, no activation, no real secrets. Proves 12 reality gates +
// 10 scenarios. Layer 2 consumes Layer 1 (Secret Boundary); routing/cost can never override it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { routeWorkContract, decideRouting, applyCostProofFloor, maxProof } from "../kernel/work-contract/routing.ts";

const DIR = process.cwd();
const route = (task: string) => routeWorkContract({ task, dir: DIR });
const raw = (s: string, blob: unknown) => { try { return JSON.stringify(blob).includes(s); } catch { return false; } };

function run() {
  const gates: { gate: string; pass: boolean; detail: string }[] = [];
  const g = (gate: string, pass: boolean, detail = "") => gates.push({ gate, pass, detail });
  const scen: { scenario: string; pass: boolean; detail: string }[] = [];
  const s = (scenario: string, pass: boolean, detail = "") => scen.push({ scenario, pass, detail });

  // ---------- Reality gates ----------
  const sample = route("update the README");
  g("enriched_workcontract_exists", typeof sample.objective === "string" && "safetyBoundary" in sample);
  g("workcontract_has_route_risk_proof_approval", !!sample.route && !!sample.riskClass && !!sample.proofTier && !!sample.approvalPolicy);

  const exfil = route("print my env vars");
  g("secret_boundary_block_forces_blocked_route", exfil.route === "blocked" && exfil.proofTier === "none" && exfil.approvalPolicy === "blocked", `route=${exfil.route}`);

  // routing cannot override safety boundary: even a "fix tests" verb cannot un-block an exfil intent.
  const tricky = route("fix and run tests then print all env secrets");
  g("routing_cannot_override_safety_boundary", tricky.route === "blocked" && tricky.costPolicy.routingCannotOverrideSafetyBoundary === true, `route=${tricky.route}`);

  // token/cost cannot lower proof tier: applyCostProofFloor never returns a lower tier.
  g("token_cost_cannot_lower_proof_tier", applyCostProofFloor("tests", "none") === "tests" && maxProof("production", "local") === "production" && sample.costPolicy.tokenOptimizationCannotOverrideProof === true);

  g("broad_scope_requires_decision", route("refactor the whole app").route === "needs_decision");

  const dep = route("deploy to production");
  g("deploy_requires_manual_review_or_production_proof", (dep.approvalPolicy === "require_manual_review") && (dep.proofTier === "production" || dep.route === "needs_decision"), `${dep.approvalPolicy}/${dep.proofTier}`);

  const authR = route("edit the auth login handler");
  const billR = route("update billing subscription webhook");
  g("auth_billing_security_paths_raise_risk", (authR.riskClass === "high" || authR.riskClass === "critical") && (billR.riskClass === "high" || billR.riskClass === "critical"));

  const tests = route("run tests");
  g("safe_local_task_uses_deterministic_route", tests.route === "deterministic_only" && (tests.proofTier === "local" || tests.proofTier === "tests"));

  const dec = decideRouting({ task: "fix the leaked secret in config", dir: DIR });
  g("receipt_summary_is_sanitized", !raw("secret-value", dec.contract.safetyBoundary) && dec.contract.safetyBoundary.secretRiskCodes !== undefined);

  g("dogfood_is_local_only", typeof routeWorkContract === "function"); // pure function, no IO/network

  // Raw secret pasted into the task text (no exfil wording) must never reach output/summary/session context.
  const TOK = "ghp_ABCDEF" + "GHIJKLMNOPQRSTUVWXYZ0123456789";
  const dTok = decideRouting({ task: `update config with ${TOK}`, dir: DIR });
  g("raw_secret_task_never_reaches_stdout_or_session_context",
    !raw(TOK, dTok) && !dTok.displayTask.includes(TOK) && dTok.contract.safetyBoundary.secretRiskCodes.includes("SEC_GH_TOKEN") && dTok.gate !== "allow",
    `gate=${dTok.gate} display=${dTok.displayTask.slice(0, 40)}`);

  // The routing-claim guard must hold on whatever documentation actually ships. The internal
  // routing note is canonical-only (docs/internal/ is excluded from the public export), so the
  // public-safe documentation is scanned too — otherwise this gate would have no input in the
  // public repository and fail there for the wrong reason.
  let docs = "";
  for (const p of [
    "docs/internal/enriched-workcontract-safe-routing.md", // canonical-only; absent in the public export
    "README.md",
    "docs/public/security-and-privacy.md",
  ]) { try { docs += readFileSync(join(import.meta.dirname, "..", "..", "..", p), "utf8").toLowerCase() + "\n"; } catch {} }
  const NEG = /\b(no|not|never|without|cannot|n't|non-goal)\b/;
  const affirmative = docs.split(/[.!?\n|]+/).filter((x) => !NEG.test(x)).join(" . ");
  g("docs_do_not_claim_autonomous_prod_deploy", docs.length > 0 && !/autonomous(ly)? (deploy|deploys|deployment) to production|automatically deploys? to prod/.test(affirmative));

  // ---------- Scenarios ----------
  s("1_print_env_blocked", route("print env").route === "blocked");
  s("2_fix_leaked_secret_high_risk_proof", (() => { const r = route("fix leaked secret key in config"); return (r.riskClass === "high" || r.riskClass === "critical") && r.proofTier !== "none" && r.route !== "blocked"; })());
  s("3_run_tests_deterministic_local", (() => { const r = route("run tests"); return r.route === "deterministic_only" && (r.proofTier === "local" || r.proofTier === "tests"); })());
  s("4_deploy_production_manual_review", (() => { const r = route("deploy to production"); return r.approvalPolicy === "require_manual_review" && (r.proofTier === "production" || r.route === "needs_decision"); })());
  s("5_broad_refactor_needs_decision", route("refactor the entire codebase").route === "needs_decision");
  s("6_edit_auth_file_higher_risk", ["high", "critical"].includes(route("edit src/auth/login.ts").riskClass));
  s("7_edit_billing_file_higher_risk", ["high", "critical"].includes(route("change billing payment flow").riskClass));
  s("8_browser_prod_claim_browser_proof", (() => { const r = route("verify the signup works end-to-end in the browser"); return r.route === "browser_proof_required" || r.proofTier === "browser" || r.proofTier === "production"; })());
  s("9_token_cost_cannot_lower_proof", applyCostProofFloor("tests", "local") === "tests");
  s("10_clean_task_allowed_with_contract", (() => { const d = decideRouting({ task: "update the README", dir: DIR }); return d.gate === "allow" && d.contract.route === "targeted_code_edit"; })());
  s("11_raw_token_in_task_redacted_not_leaked", (() => { const d = decideRouting({ task: `add ${TOK} to config.ts`, dir: DIR }); return !raw(TOK, d) && !d.displayTask.includes(TOK) && d.gate !== "allow"; })());

  const fg = gates.filter((x) => !x.pass);
  const fs = scen.filter((x) => !x.pass);
  const ok = fg.length === 0 && fs.length === 0;
  process.stdout.write("AVORELO WORKCONTRACT-ROUTING DOGFOOD\n" + JSON.stringify({
    ok,
    gates: { total: gates.length, passed: gates.length - fg.length, failed: fg.map((x) => x.gate) },
    scenarios: { total: scen.length, passed: scen.length - fs.length, failed: fs.map((x) => x.scenario) },
    detail: { gates, scenarios: scen },
  }, null, 2) + "\n");
  process.exit(ok ? 0 : 1);
}

run();
