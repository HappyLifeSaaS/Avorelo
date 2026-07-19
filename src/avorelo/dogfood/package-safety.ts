// Avorelo Package Safety Dogfood. Proves the built tarball installs cleanly and all secret-boundary-related
// CLI commands work from the installed package with no src/ dependency. Synthetic fixtures only, no network.
//
// Run: npm run dogfood:package-safety
// Requires: npm run build to have been run (prepack handles this during npm pack).

import { execSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const LOCAL_NPM_CACHE = join(ROOT, ".npm-cache");
const FX_GH = "ghp_ABCDEF" + "GHIJKLMNOPQRSTUVWXYZ0123456789";
const FX_PRIV = "-----BEGIN RSA " + "PRIVATE KEY-----\\nMIIEowIBAAKCAQEAfake\\n-----END RSA PRIVATE KEY-----";

function run() {
  const gates: { gate: string; pass: boolean; detail: string }[] = [];
  const g = (gate: string, pass: boolean, detail = "") => gates.push({ gate, pass, detail });

  const tmpBase = join(tmpdir(), `avorelo-pkg-safety-${Date.now()}`);
  mkdirSync(tmpBase, { recursive: true });
  mkdirSync(LOCAL_NPM_CACHE, { recursive: true });
  const npmEnv = {
    ...process.env,
    npm_config_cache: LOCAL_NPM_CACHE,
    NPM_CONFIG_CACHE: LOCAL_NPM_CACHE,
    NODE_NO_WARNINGS: "1",
  };

  try {
    // 1. npm pack
    const packOut = execSync("npm pack --json", { cwd: ROOT, encoding: "utf8", timeout: 60000, env: npmEnv });
    const packInfo = JSON.parse(packOut);
    const tgzName = Array.isArray(packInfo) ? packInfo[0].filename : packInfo.filename;
    const tgzPath = join(ROOT, tgzName);
    g("npm_pack_succeeds", existsSync(tgzPath), tgzName);

    // 2. Install into clean temp project
    execSync("npm init -y", { cwd: tmpBase, encoding: "utf8", timeout: 30000, env: npmEnv });
    execSync(`npm install "${tgzPath}" --no-audit --fund=false`, { cwd: tmpBase, encoding: "utf8", timeout: 120000, env: npmEnv });
    g("tarball_installs_cleanly", existsSync(join(tmpBase, "node_modules", "avorelo")));

    // 3. No src/ TS files in installed package
    const installedFiles = readdirSync(join(tmpBase, "node_modules", "avorelo"), { recursive: true }) as string[];
    const hasSrcTs = installedFiles.some(f => String(f).includes("src") && String(f).endsWith(".ts"));
    g("no_src_ts_in_installed_package", !hasSrcTs);

    // Helper to run CLI command and capture output
    const cli = (cmd: string, expectFail = false): { stdout: string; stderr: string; ok: boolean } => {
      try {
        const stdout = execSync(`npx avorelo ${cmd}`, { cwd: tmpBase, encoding: "utf8", timeout: 30000, env: npmEnv });
        return { stdout, stderr: "", ok: true };
      } catch (e: any) {
        return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", ok: false };
      }
    };

    // 4. secret-boundary scan — detects + redacts
    const scan = cli(`secret-boundary scan --content "${FX_GH}" --json`);
    g("scan_command_exists", scan.ok || scan.stdout.includes("decision"));
    g("scan_detects_token", scan.stdout.includes("SEC_GH_TOKEN"));
    g("scan_no_raw_secret_in_stdout", !scan.stdout.includes(FX_GH));

    // 5. secret-boundary remediate
    const remediate = cli(`secret-boundary remediate --content "${FX_GH}" --json`);
    g("remediate_command_exists", remediate.ok || remediate.stdout.includes("remediation"));
    g("remediate_no_auto_rotation", remediate.stdout.includes('"autoRotation":false') || remediate.stdout.includes('"autoRotation": false'));
    g("remediate_no_raw_secret_in_stdout", !remediate.stdout.includes(FX_GH));

    // 6. run "print my env vars" — blocked
    const runPrint = cli('run "print my env vars" --target .', true);
    g("run_print_env_blocked", !runPrint.ok || runPrint.stderr.includes("blocked") || runPrint.stderr.includes("Blocked"));

    // 7. context compile with synthetic token
    const ctxCompile = cli('context compile "add ghp_FAKE_TOKEN to config" --target . --json');
    g("context_compile_exists", ctxCompile.ok || ctxCompile.stdout.includes("contextPacket"));
    g("context_compile_containsRawSecret_false", ctxCompile.stdout.includes('"containsRawSecret":false') || ctxCompile.stdout.includes('"containsRawSecret": false'));

    // 8. continuity prepare with secret-like input
    const contPrep = cli(`continuity prepare --task "store ${FX_GH} in .env" --target . --json`);
    g("continuity_prepare_exists", contPrep.ok || contPrep.stdout.includes("continuity"));
    g("continuity_prepare_no_raw_secret", !contPrep.stdout.includes(FX_GH));
    g("continuity_prepare_redacted", contPrep.stdout.includes("[REDACTED:"));

    // 9. continuity show
    const contShow = cli("continuity show --target . --json");
    g("continuity_show_exists", contShow.ok || contShow.stdout.includes("continuity") || contShow.stderr.includes("No continuity"));
    g("continuity_show_no_raw_secret", !contShow.stdout.includes(FX_GH));

    // 10. report build
    const reportBuild = cli("report build --target . --json");
    g("report_build_exists", reportBuild.ok || reportBuild.stdout.includes("proofReport"));
    g("report_no_savings_claim", reportBuild.stdout.includes('"savingsClaimAllowed":false') || reportBuild.stdout.includes('"savingsClaimAllowed": false') || reportBuild.stdout.includes("unavailable"));
    g("report_no_raw_secret", !reportBuild.stdout.includes(FX_GH));

    // 11. value cards
    const valueCards = cli("value cards --target . --json");
    g("value_cards_exists", valueCards.ok || valueCards.stdout.includes("card"));
    g("value_cards_no_raw_secret", !valueCards.stdout.includes(FX_GH));

    // --- Global CLI parity: the INSTALLED package's CLI must expose the same surface as the worktree CLI ---
    // (this is the gate against "global avorelo lags the canonical checkout").

    // P1. --version reports the package version (proves the bundled bin resolves package.json correctly)
    const pkgVersion = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version;
    const ver = cli("--version");
    g("version_command_works", ver.ok && ver.stdout.includes("avorelo"));
    g("version_matches_package_json", ver.stdout.includes(pkgVersion));

    // P2. --help lists the current command surface, including the newest commands (no stale banner)
    const help = cli("--help");
    g("help_lists_init", help.stdout.includes("init"));
    g("help_lists_run", help.stdout.includes("run \"<task>\"") || help.stdout.includes("run \""));
    g("help_lists_control_center", help.stdout.includes("control-center"));
    g("help_lists_readiness", help.stdout.includes("readiness"));

    // P2b. `init` (Activation v1) works from the installed package — local-first, no cloud, no network.
    const init = cli("init --target . --json");
    g("init_command_exists", init.ok || init.stdout.includes("avorelo.activation.v1"));
    g("init_local_only_not_cloud_claimed", init.stdout.includes('"localOnly": true') && init.stdout.includes('"cloudClaimed": false'));
    g("init_no_raw_secret", !init.stdout.includes(FX_GH));

    // P2c. `dogfood-check` (External Dogfood Prep) works from the installed package — read-only, local-only.
    const dfc = cli("dogfood-check --target . --json");
    g("dogfood_check_command_exists", dfc.ok || dfc.stdout.includes("avorelo.dogfoodCheck.v1"));
    g("dogfood_check_local_only", dfc.stdout.includes('"localOnly": true') && dfc.stdout.includes('"cloudClaimed": false'));
    g("dogfood_check_no_raw_secret", !dfc.stdout.includes(FX_GH));

    // P2d. `dogfood-summary` (First External Dogfood Run prep) — read-only, local-only, safe pre-send summary.
    const dfs = cli("dogfood-summary --target . --json");
    g("dogfood_summary_command_exists", dfs.ok || dfs.stdout.includes("avorelo.dogfoodSummary.v1"));
    g("dogfood_summary_local_only", dfs.stdout.includes('"localOnly": true') && dfs.stdout.includes('"cloudClaimed": false'));
    g("dogfood_summary_no_raw_secret", !dfs.stdout.includes(FX_GH));

    // P3. `run` performs the Runtime Product Flow (Track 2) from the installed package
    const runFlow = cli('run "update the docs index wording" --target . --json');
    g("run_flow_exists", runFlow.ok || runFlow.stdout.includes("runtimeSession"));
    g("run_flow_no_savings_claim", !runFlow.stdout.includes('"canShowSavings":true') && !runFlow.stdout.includes('"canShowSavings": true'));
    g("run_flow_no_raw_secret", !runFlow.stdout.includes(FX_GH));

    // P4. `control-center` (Track 4) read-only surface works from the installed package
    const cc = cli("control-center --target . --format json");
    g("control_center_exists", cc.ok || cc.stdout.includes("controlCenter"));
    g("control_center_no_raw_secret", !cc.stdout.includes(FX_GH));

    // 12. Verify no raw secret leaked into any generated receipt/artifact in temp dir
    const avoreloDir = join(tmpBase, ".avorelo");
    let anyRawLeak = false;
    if (existsSync(avoreloDir)) {
      const walk = (dir: string): string[] => {
        const out: string[] = [];
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          if (e.isDirectory()) out.push(...walk(p));
          else out.push(p);
        }
        return out;
      };
      for (const f of walk(avoreloDir)) {
        try {
          const content = readFileSync(f, "utf8");
          if (content.includes(FX_GH) || content.includes("MIIEowIBAAKCAQEAfake") || content.includes("hunter2pwd")) {
            anyRawLeak = true;
            break;
          }
        } catch {}
      }
    }
    g("no_raw_secret_in_generated_artifacts", !anyRawLeak);

    // Clean up tgz
    try { rmSync(tgzPath); } catch {}

  } finally {
    // Clean temp dir
    try { rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  }

  const failedGates = gates.filter(x => !x.pass);
  const ok = failedGates.length === 0;
  const summary = {
    ok,
    gates: { total: gates.length, passed: gates.length - failedGates.length, failed: failedGates.map(x => x.gate) },
    detail: { gates },
  };
  process.stdout.write("AVORELO PACKAGE-SAFETY DOGFOOD\n" + JSON.stringify(summary, null, 2) + "\n");
  process.exit(ok ? 0 : 1);
}

run();
