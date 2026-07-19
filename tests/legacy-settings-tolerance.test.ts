// Pre-D correction: Community Edition has no automatic-update setting (update checking is
// explicit-only). Old local settings files that still carry an `update` / auto-update block
// (or `learning` / `killSwitch`) must be tolerated on read, ignored, and never copied into
// newly written settings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadSettings, ensureSettings, resetSettings, writeSettings, buildDefaultSettings, renderSettings, ALPHA_NOTICE,
} from "../src/avorelo/capabilities/settings/index.ts";

function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "avorelo-settings-"));
  mkdirSync(join(dir, ".avorelo"), { recursive: true });
  return dir;
}
function cleanup(dir: string) { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); }

const LEGACY = {
  contract: "avorelo.settings.v1",
  schemaVersion: 1,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
  workspaceId: "ws_legacy",
  alphaParticipation: { termsVersion: "old", privacyVersion: "old", noticeShownAt: null, model: "terms-governed-private-alpha" },
  update: { enabled: false, channel: "stable", checkOnRun: true, applyMode: "auto-when-safe", currentVersion: "0.0.1" },
  learning: { enabled: true, mode: "sanitized-dogfood" },
  killSwitch: { updateDisabledReason: "disabled_by_user", learningDisabledReason: null },
  privacy: { localFirst: true, sendsSource: false, sendsSecrets: false, sendsLogs: false, sendsDiffs: false, sendsEnv: false, sendsPrompts: false, sendsRepoNames: false, sendsRepoPaths: false, sendsFilenames: false, sendsFullArtifacts: false },
};

function writeLegacy(dir: string) {
  writeFileSync(join(dir, ".avorelo", "settings.json"), JSON.stringify(LEGACY, null, 2));
}

test("new settings schema has no update/auto-update/killSwitch fields", () => {
  const s = buildDefaultSettings({ workspaceId: "ws_1" }) as Record<string, unknown>;
  assert.ok(!("update" in s), "no update block");
  assert.ok(!("learning" in s), "no learning block");
  assert.ok(!("killSwitch" in s), "no killSwitch block");
  assert.ok("privacy" in s && "alphaParticipation" in s, "keeps privacy + alpha participation");
});

test("loadSettings tolerates and drops a legacy update/auto-update block", () => {
  const dir = sandbox();
  try {
    writeLegacy(dir);
    const s = loadSettings(dir) as Record<string, unknown>;
    assert.ok(s, "legacy settings load without crashing");
    assert.equal(s.contract, "avorelo.settings.v1");
    assert.ok(!("update" in s), "legacy update block dropped");
    assert.ok(!("learning" in s), "legacy learning block dropped");
    assert.ok(!("killSwitch" in s), "legacy killSwitch dropped");
    assert.equal(s.workspaceId, "ws_legacy", "preserves workspace identity");
  } finally { cleanup(dir); }
});

test("legacy update fields are not copied into newly written settings", () => {
  const dir = sandbox();
  try {
    writeLegacy(dir);
    const s = loadSettings(dir)!;
    writeSettings(dir, s);
    const onDisk = readFileSync(join(dir, ".avorelo", "settings.json"), "utf8");
    assert.ok(!onDisk.includes("\"update\""), "no update block persisted");
    assert.ok(!onDisk.includes("auto-when-safe"), "no auto-update preference persisted");
    assert.ok(!onDisk.includes("killSwitch"), "no killSwitch persisted");
    assert.ok(!onDisk.includes("checkOnRun"), "no automatic-check preference persisted");
  } finally { cleanup(dir); }
});

test("ensureSettings on a legacy file returns the normalized schema (no update)", () => {
  const dir = sandbox();
  try {
    writeLegacy(dir);
    const s = ensureSettings(dir) as Record<string, unknown>;
    assert.ok(!("update" in s), "ensureSettings drops legacy update block");
  } finally { cleanup(dir); }
});

test("reset writes only the current schema", () => {
  const dir = sandbox();
  try {
    writeLegacy(dir);
    const r = resetSettings(dir) as Record<string, unknown>;
    assert.ok(!("update" in r) && !("killSwitch" in r), "reset has no update/killSwitch");
    const onDisk = readFileSync(join(dir, ".avorelo", "settings.json"), "utf8");
    assert.ok(!onDisk.includes("checkOnRun"), "reset persists no auto-update preference");
  } finally { cleanup(dir); }
});

test("settings surfaces present no automatic-update state", () => {
  const s = buildDefaultSettings({ workspaceId: "ws_1" });
  const rendered = renderSettings(s);
  assert.ok(!/auto-update|automatic update|check on run|apply mode/i.test(rendered), "render shows no automatic-update state");
  assert.ok(rendered.includes("explicit only"), "render states update is explicit");
  assert.ok(!/auto-update/i.test(ALPHA_NOTICE), "alpha notice mentions no auto-update");
  assert.ok(ALPHA_NOTICE.includes("avorelo update check"), "alpha notice points to explicit check");
});
