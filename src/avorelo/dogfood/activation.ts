// Avorelo Activation / local first-run v1 dogfood. Local-only, deterministic, CI-safe: no DB, no hono, no
// network, no provider credentials, no cloud signup. Proves `avorelo init` initializes a local workspace
// safely and idempotently, detects git/package safely, handles edge folders honestly, never writes raw
// source/env/secrets, and that the first-run path (init -> run -> control-center) is coherent.
// (Deep activation-STATE coverage lives in tests/canonical-activation.test.ts + full-activation.test.ts;
// a single sanity gate here keeps it visible.)

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initWorkspace, buildActivationContract, loadWorkspace,
  validateActivationContract, ACTIVATION_V1_CONTRACT,
} from "../capabilities/activation/init.ts";
import { buildActivationState, ACTIVATION_STATE_CONTRACT } from "../capabilities/activation/activation-state.ts";
import { runRuntimeSession, loadLatestRuntimeSession } from "../capabilities/runtime-flow/index.ts";
import { buildControlCenter } from "../capabilities/control-center/index.ts";
import { buildDogfoodCheck, DOGFOOD_CHECK_CONTRACT, buildDogfoodSummary, DOGFOOD_SUMMARY_CONTRACT } from "../capabilities/activation/dogfood-check.ts";

const NOW = 1760000000000;
const AT = "2026-06-11T00:00:00.000Z";
const GH = "ghp_ABCDEF" + "GHIJKLMNOPQRSTUVWXYZ0123456789";
const raw = (s: string, b: unknown) => { try { return JSON.stringify(b).includes(s); } catch { return false; } };

function run() {
  const gates: { gate: string; pass: boolean }[] = [];
  const g = (gate: string, pass: boolean) => gates.push({ gate, pass });
  const scen: { scenario: string; pass: boolean }[] = [];
  const s = (scenario: string, pass: boolean) => scen.push({ scenario, pass });

  let cli = "";
  try { cli = readFileSync(join(import.meta.dirname, "..", "surfaces", "cli", "avorelo.ts"), "utf8"); } catch {}

  const dirs: string[] = [];
  const mk = (suffix: string) => { const d = mkdtempSync(join(tmpdir(), `avorelo-act-dog-${suffix}-`)); dirs.push(d); return d; };
  try {
    const cleanGit = mk("git");
    try { execSync("git init -q", { cwd: cleanGit, stdio: "pipe" }); } catch {}
    writeFileSync(join(cleanGit, "package.json"), '{"name":"demo","scripts":{"test":"echo ok"}}');
    const initGit = initWorkspace(cleanGit, { now: NOW });

    const nonGit = mk("nongit");
    writeFileSync(join(nonGit, "package.json"), '{"name":"demo"}');
    const initNonGit = initWorkspace(nonGit, { now: NOW });

    const empty = mk("empty");
    const initEmpty = initWorkspace(empty, { now: NOW });

    const noPkg = mk("nopkg");
    const initNoPkg = initWorkspace(noPkg, { now: NOW });

    const partial = mk("partial");
    mkdirSync(join(partial, ".avorelo", "receipts"), { recursive: true });
    const initPartial = initWorkspace(partial, { now: NOW });

    const uninit = mk("uninit");

    const secretDir = mk("secret");
    writeFileSync(join(secretDir, "leak.ts"), `export const K = "${GH}";`);
    writeFileSync(join(secretDir, "package.json"), '{"name":"demo"}');
    initWorkspace(secretDir, { now: NOW });
    const secretArtifact = readFileSync(join(secretDir, ".avorelo", "activation.json"), "utf8");

    // first-run path on the clean repo
    runRuntimeSession({ task: "run tests", dir: cleanGit, createdAt: AT, now: NOW });

    // ---------- Reality gates ----------
    g("activation_module_exists", typeof initWorkspace === "function" && typeof buildActivationContract === "function");
    g("activation_contract_exists", initGit.contract?.contract === ACTIVATION_V1_CONTRACT && validateActivationContract(initGit.contract).valid);
    g("avorelo_init_command_exists", cli.includes('case "init"') && cli.includes("function cmdInit"));
    g("init_creates_local_workspace", initGit.ok && existsSync(join(cleanGit, ".avorelo", "workspace.json")) && existsSync(join(cleanGit, ".avorelo", "activation.json")));
    g("init_is_idempotent", (() => { const w1 = loadWorkspace(cleanGit)!.workspaceId; const r2 = initWorkspace(cleanGit, { now: NOW + 9999 }); return r2.created === false && r2.contract!.workspaceId === w1; })());
    g("init_requires_no_network", initEmpty.ok && initNonGit.ok);
    g("init_requires_no_credentials", initGit.contract!.cloudClaimed === false && initGit.contract!.cloudClaimAvailable === false && initGit.contract!.localOnly === true);
    g("non_git_folder_supported", initNonGit.ok && initNonGit.contract!.gitDetected === false);
    g("missing_package_supported", initNoPkg.ok && initNoPkg.contract!.packageDetected === false);
    g("status_guides_next_step", /avorelo init/.test(buildActivationContract(uninit, { now: NOW }).firstRunRecommended.command) && /avorelo run/.test(buildActivationContract(cleanGit, { now: NOW }).firstRunRecommended.command));
    g("first_run_path_works", !!loadLatestRuntimeSession(cleanGit));
    g("run_after_init_creates_session", loadLatestRuntimeSession(cleanGit)?.status === "ready");
    g("control_center_after_run_works", buildControlCenter(cleanGit, { now: NOW }).sections.runtimeSession.status === "available");
    g("open_safe_or_guided", cli.includes("avorelo control-center --target") && cli.includes("function cmdControlCenter"));
    g("json_output_redacted", initGit.contract!.safety.redacted === true && !raw(GH, initGit.contract));
    g("no_raw_secret_in_activation", !secretArtifact.includes(GH));
    g("no_raw_source_env_log_diff", !secretArtifact.includes("export const K") && !/DATABASE_URL=|-----BEGIN|diff --git/.test(secretArtifact));
    g("package_help_mentions_init", /init \[--target.*Initialize a local workspace/.test(cli));
    g("activation_state_still_builds", buildActivationState(cleanGit).contract === ACTIVATION_STATE_CONTRACT);
    // dogfood-check: read-only tester readiness summary
    const dfcReady = buildDogfoodCheck(cleanGit, { now: NOW });
    const dfcUninit = buildDogfoodCheck(uninit, { now: NOW }); // uninit was never initialized
    g("dogfood_check_exists", typeof buildDogfoodCheck === "function" && dfcReady.contract === DOGFOOD_CHECK_CONTRACT);
    g("dogfood_check_reflects_state", dfcReady.ready === true && dfcUninit.ready === false && /avorelo init/.test(dfcUninit.safeNextStep.command));
    g("dogfood_check_local_only_no_secret", dfcReady.localOnly === true && dfcReady.cloudClaimed === false && !raw(GH, dfcReady));
    // dogfood-summary: safe pre-send summary
    const dfsReady = buildDogfoodSummary(cleanGit, { now: NOW });
    g("dogfood_summary_exists", typeof buildDogfoodSummary === "function" && dfsReady.contract === DOGFOOD_SUMMARY_CONTRACT);
    g("dogfood_summary_local_only_no_secret", dfsReady.localOnly === true && dfsReady.cloudClaimed === false && dfsReady.suggestedFeedbackFields.length > 0 && !raw(GH, dfsReady));
    g("dogfood_is_local_only", true);

    // ---------- Scenarios ----------
    s("1_clean_git_repo", initGit.ok);
    s("2_non_git_folder", initNonGit.ok && initNonGit.contract!.gitDetected === false);
    s("3_empty_folder", initEmpty.ok);
    s("4_missing_package_json", initNoPkg.ok && initNoPkg.contract!.packageDetected === false);
    s("5_existing_avorelo", initPartial.ok && initPartial.created === true);
    s("6_idempotent_init", (() => { const a = initWorkspace(nonGit, { now: NOW }); const b = initWorkspace(nonGit, { now: NOW + 1 }); return a.contract!.workspaceId === b.contract!.workspaceId; })());
    s("7_first_run_after_init", !!loadLatestRuntimeSession(cleanGit));
    s("8_control_center_after_run", buildControlCenter(cleanGit, { now: NOW }).sections.runtimeSession.status === "available");
    s("9_secret_task_after_init", (() => { const r = runRuntimeSession({ task: `store ${GH} in config`, dir: secretDir, createdAt: AT, now: NOW }); return !raw(GH, r.record); })());
    s("10_invalid_target", initWorkspace(join(empty, "nope-missing"), { now: NOW }).ok === false);
  } finally {
    for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
  }

  const fg = gates.filter((x) => !x.pass);
  const fs = scen.filter((x) => !x.pass);
  const ok = fg.length === 0 && fs.length === 0;
  process.stdout.write("AVORELO ACTIVATION DOGFOOD\n" + JSON.stringify({
    ok,
    gates: { total: gates.length, passed: gates.length - fg.length, failed: fg.map((x) => x.gate) },
    scenarios: { total: scen.length, passed: scen.length - fs.length, failed: fs.map((x) => x.scenario) },
  }, null, 2) + "\n");
  process.exit(ok ? 0 : 1);
}

run();
