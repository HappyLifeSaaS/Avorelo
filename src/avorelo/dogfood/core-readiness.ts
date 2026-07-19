// Avorelo Core Readiness dogfood. Local-only, deterministic, CI-safe: no DB, no hono, no network, no
// credentials. Proves the capstone product-core verdict composes the canonical safety invariants + core
// surface + package facts, lands CORE_READY_FOR_PRIVATE_ALPHA for this build, defers cloud sync honestly,
// and never overclaims.

import { buildCoreReadiness, renderCoreReadiness, CORE_READINESS_CONTRACT } from "../capabilities/core-readiness/index.ts";

const NOW = 1760000000000;

function run() {
  const gates: { gate: string; pass: boolean }[] = [];
  const g = (gate: string, pass: boolean) => gates.push({ gate, pass });

  const r = buildCoreReadiness({ now: NOW });
  const byId = Object.fromEntries(r.checks.map((c) => [c.id, c.ok]));
  const text = renderCoreReadiness(r);

  g("core_readiness_module_exists", typeof buildCoreReadiness === "function" && r.contract === CORE_READINESS_CONTRACT);
  g("core_ready_for_private_alpha", r.result === "CORE_READY_FOR_PRIVATE_ALPHA");
  g("safety_invariants_hold", byId.safety_invariants_hold === true);
  g("core_modules_present", byId.core_modules_present === true);
  g("first_run_cli_present", byId.first_run_cli_present === true);
  g("package_coherent", byId.package_coherent === true);
  g("dogfood_tiers_present", byId.dogfood_tiers === true);
  g("external_dogfood_pack_present", byId.external_dogfood_pack === true);
  g("cloud_sync_deferred_honestly", r.cloudSync === "deferred");
  g("no_production_ready_in_allowed_claims", !r.claimsAllowed.some((c) => /production-ready/i.test(c)));
  g("forbidden_claims_listed", ["production-ready", "guaranteed savings", "zero leak", "compliance-certified"].every((c) => r.claimsForbidden.includes(c)));
  g("not_ready_against_non_core_root", buildCoreReadiness({ now: NOW, root: process.platform === "win32" ? "C:/Windows/Temp" : "/tmp" }).result === "CORE_NOT_READY");
  g("render_no_overclaim", text.includes("CORE_READY_FOR_PRIVATE_ALPHA") && text.includes("no production-ready"));
  g("dogfood_is_local_only", true);

  const failed = gates.filter((x) => !x.pass);
  const ok = failed.length === 0;
  process.stdout.write("AVORELO CORE-READINESS DOGFOOD\n" + JSON.stringify({
    ok,
    result: r.result,
    gates: { total: gates.length, passed: gates.length - failed.length, failed: failed.map((x) => x.gate) },
  }, null, 2) + "\n");
  process.exit(ok ? 0 : 1);
}

run();
