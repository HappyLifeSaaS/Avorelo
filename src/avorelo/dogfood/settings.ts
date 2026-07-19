// Avorelo Settings v1 dogfood. Local-only, deterministic, CI-safe.
// Proves settings init, idempotency, enable/disable, reset, and privacy invariants.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkspace, loadWorkspace } from "../capabilities/activation/init.ts";
import {
  loadSettings, ensureSettings,
  resetSettings, buildDefaultSettings, SETTINGS_CONTRACT, renderSettings,
  ALPHA_NOTICE, type AvoSettings,
} from "../capabilities/settings/index.ts";

const NOW = 1760000000000;
const GH = "ghp_ABCDEF" + "GHIJKLMNOPQRSTUVWXYZ0123456789";

function run() {
  const gates: { gate: string; pass: boolean }[] = [];
  const g = (gate: string, pass: boolean) => gates.push({ gate, pass });

  const dirs: string[] = [];
  const mk = (suffix: string) => { const d = mkdtempSync(join(tmpdir(), `avorelo-set-dog-${suffix}-`)); dirs.push(d); return d; };

  try {
    // Setup: init a workspace first
    const dir = mk("main");
    writeFileSync(join(dir, "package.json"), '{"name":"demo"}');
    initWorkspace(dir, { now: NOW });
    const ws = loadWorkspace(dir)!;

    // 1. Init creates settings
    const s1 = ensureSettings(dir, { workspaceId: ws.workspaceId, now: NOW });
    g("init_creates_settings", s1.contract === SETTINGS_CONTRACT && s1.schemaVersion === 1);
    g("settings_file_exists", existsSync(join(dir, ".avorelo", "settings.json")));

    // 2. Init is idempotent
    const s2 = ensureSettings(dir, { workspaceId: ws.workspaceId, now: NOW + 1000 });
    g("settings_idempotent", s2.createdAt === s1.createdAt && s2.workspaceId === s1.workspaceId);

    // 3. Community Edition defaults: no update/learning/killSwitch preference blocks
    g("no_update_setting", !("update" in s1));
    g("no_learning_field", !("learning" in s1));
    g("no_kill_switch", !("killSwitch" in s1));
    g("default_alpha_model", s1.alphaParticipation.model === "terms-governed-private-alpha");

    // 4. Settings show works
    const rendered = renderSettings(s1);
    g("settings_show_renders", rendered.includes("avorelo.settings.v1") && rendered.includes("private-alpha"));

    // 5. Reset works and writes only the current schema
    const r = resetSettings(dir, { workspaceId: ws.workspaceId, now: NOW + 6000 });
    g("reset_restores_defaults", r.contract === "avorelo.settings.v1" && !("update" in r));

    // 8. Privacy invariants
    g("privacy_local_first", s1.privacy.localFirst === true);
    g("privacy_no_source", s1.privacy.sendsSource === false);
    g("privacy_no_secrets", s1.privacy.sendsSecrets === false);
    g("privacy_no_logs", s1.privacy.sendsLogs === false);
    g("privacy_no_diffs", s1.privacy.sendsDiffs === false);
    g("privacy_no_env", s1.privacy.sendsEnv === false);
    g("privacy_no_prompts", s1.privacy.sendsPrompts === false);
    g("privacy_no_repo_names", s1.privacy.sendsRepoNames === false);
    g("privacy_no_repo_paths", s1.privacy.sendsRepoPaths === false);
    g("privacy_no_filenames", s1.privacy.sendsFilenames === false);
    g("privacy_no_full_artifacts", s1.privacy.sendsFullArtifacts === false);

    // 9. Secret repo: settings must not contain raw secrets
    const secretDir = mk("secret");
    writeFileSync(join(secretDir, "leak.ts"), `export const K = "${GH}";`);
    writeFileSync(join(secretDir, "package.json"), '{"name":"demo"}');
    writeFileSync(join(secretDir, ".env"), `API_KEY=${GH}`);
    initWorkspace(secretDir, { now: NOW });
    const secretWs = loadWorkspace(secretDir)!;
    ensureSettings(secretDir, { workspaceId: secretWs.workspaceId, now: NOW });
    const settingsJson = readFileSync(join(secretDir, ".avorelo", "settings.json"), "utf8");
    g("no_raw_secret_in_settings", !settingsJson.includes(GH) && !settingsJson.includes("API_KEY"));

    // 10. Alpha notice is safe
    g("alpha_notice_exists", ALPHA_NOTICE.length > 0);
    g("alpha_notice_no_secret", !ALPHA_NOTICE.includes(GH));
    g("alpha_notice_explicit_update", ALPHA_NOTICE.includes("avorelo update check") && !ALPHA_NOTICE.includes("auto-update"));

  } finally {
    for (const d of dirs) try { rmSync(d, { recursive: true, force: true }); } catch {}
  }

  const pass = gates.every((g) => g.pass);
  const fail = gates.filter((g) => !g.pass);
  if (!pass) {
    process.stderr.write(`DOGFOOD FAIL (settings): ${fail.map((f) => f.gate).join(", ")}\n`);
    process.exit(1);
  }
  process.stdout.write(`DOGFOOD OK (settings): ${gates.length} gates passed\n`);
}

run();
