// Avorelo Settings v1 — `avorelo.settings.v1`.
//
// Local-first settings. Persisted to `.avorelo/settings.json`. No network at rest,
// no raw data, no learning uplink, and no automatic update. Update checking is an
// explicit user action (`avorelo update check`), so there is no update preference.
// Legacy fields from older builds (update / learning / killSwitch) are tolerated on
// read and dropped — never copied into newly written settings.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export const SETTINGS_CONTRACT = "avorelo.settings.v1";

export type AvoSettings = {
  contract: typeof SETTINGS_CONTRACT;
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  workspaceId: string;
  alphaParticipation: {
    termsVersion: string;
    privacyVersion: string;
    noticeShownAt: string | null;
    model: "terms-governed-private-alpha";
  };
  privacy: {
    localFirst: true;
    sendsSource: false;
    sendsSecrets: false;
    sendsLogs: false;
    sendsDiffs: false;
    sendsEnv: false;
    sendsPrompts: false;
    sendsRepoNames: false;
    sendsRepoPaths: false;
    sendsFilenames: false;
    sendsFullArtifacts: false;
  };
};

const SETTINGS_PATH = ".avorelo/settings.json";

export function buildDefaultSettings(opts: { workspaceId: string; now?: number }): AvoSettings {
  const now = opts.now ?? Date.now();
  const ts = new Date(now).toISOString();
  return {
    contract: SETTINGS_CONTRACT,
    schemaVersion: 1,
    createdAt: ts,
    updatedAt: ts,
    workspaceId: opts.workspaceId,
    alphaParticipation: {
      termsVersion: "2025-06-11-draft",
      privacyVersion: "2025-06-11-draft",
      noticeShownAt: null,
      model: "terms-governed-private-alpha",
    },
    privacy: {
      localFirst: true,
      sendsSource: false,
      sendsSecrets: false,
      sendsLogs: false,
      sendsDiffs: false,
      sendsEnv: false,
      sendsPrompts: false,
      sendsRepoNames: false,
      sendsRepoPaths: false,
      sendsFilenames: false,
      sendsFullArtifacts: false,
    },
  };
}

// Return only current-schema fields, dropping any legacy keys (update / learning /
// killSwitch) so they are ignored and never written back.
function normalize(raw: Record<string, unknown>): AvoSettings {
  const base = buildDefaultSettings({ workspaceId: String(raw.workspaceId ?? "ws_unknown") });
  return {
    ...base,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : base.createdAt,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : base.updatedAt,
    alphaParticipation: { ...base.alphaParticipation, ...(raw.alphaParticipation as object ?? {}) },
    privacy: { ...base.privacy },
  };
}

export function loadSettings(dir: string): AvoSettings | null {
  const p = join(dir, SETTINGS_PATH);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    return raw.contract === SETTINGS_CONTRACT ? normalize(raw) : null;
  } catch { return null; }
}

export function writeSettings(dir: string, settings: AvoSettings): void {
  const p = join(dir, SETTINGS_PATH);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(settings, null, 2));
}

export function ensureSettings(dir: string, opts?: { workspaceId?: string; now?: number }): AvoSettings {
  const existing = loadSettings(dir);
  if (existing) return existing;
  const workspaceId = opts?.workspaceId ?? "ws_unknown";
  const settings = buildDefaultSettings({ workspaceId, now: opts?.now });
  writeSettings(dir, settings);
  return settings;
}

export function resetSettings(dir: string, opts?: { workspaceId?: string; now?: number }): AvoSettings {
  const old = loadSettings(dir);
  const workspaceId = opts?.workspaceId ?? old?.workspaceId ?? "ws_unknown";
  const settings = buildDefaultSettings({ workspaceId, now: opts?.now });
  writeSettings(dir, settings);
  return settings;
}

export function renderSettings(s: AvoSettings): string {
  return [
    `Avorelo Settings (${s.contract})`,
    `  Workspace:      ${s.workspaceId}`,
    `  Alpha model:    ${s.alphaParticipation.model}`,
    "",
    "  Updates:        explicit only — run `avorelo update check` (no automatic checking)",
    "",
    "  Privacy:",
    `    local-first:        ${s.privacy.localFirst}`,
    `    sends source:       ${s.privacy.sendsSource}`,
    `    sends secrets:      ${s.privacy.sendsSecrets}`,
    `    sends logs:         ${s.privacy.sendsLogs}`,
    `    sends diffs:        ${s.privacy.sendsDiffs}`,
    `    sends env:          ${s.privacy.sendsEnv}`,
    `    sends prompts:      ${s.privacy.sendsPrompts}`,
    `    sends repo names:   ${s.privacy.sendsRepoNames}`,
    `    sends repo paths:   ${s.privacy.sendsRepoPaths}`,
    `    sends filenames:    ${s.privacy.sendsFilenames}`,
    `    sends full artifacts: ${s.privacy.sendsFullArtifacts}`,
    "",
  ].join("\n");
}

export const ALPHA_NOTICE = [
  "Avorelo — Private Alpha",
  "",
  "  Local-first AI Work Control. Your source, secrets, logs, env, diffs, and",
  "  prompts never leave your machine.",
  "",
  "  Local-first participation:",
  "    - Update checking is explicit only: run `avorelo update check` when you want it",
  "    - No source, secrets, logs, env, diffs, prompts, or full artifacts are sent",
  "    - No telemetry, learning, or usage signals are collected or transmitted",
  "",
  "  See current settings:",
  "    avorelo settings show --target .",
  "",
  "  License: see the LICENSE file included with Avorelo",
  "  Privacy: https://avorelo.com/privacy",
  "",
].join("\n");
