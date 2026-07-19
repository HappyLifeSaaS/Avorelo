// Avorelo support configuration. Local-first: support artifacts are always
// created locally and never transmitted. There is no remote channel and no
// metrics collection — opt-in only records that the user is willing to create
// and manually share local support bundles.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export type FeedbackConfig = {
  enabled: boolean;
  allowSupportBundles: boolean;
  optedInAt: string | null;
  optedOutAt: string | null;
};

const CONFIG_PATH = ".avorelo/config.json";

const DEFAULTS: FeedbackConfig = {
  enabled: false,
  allowSupportBundles: true,
  optedInAt: null,
  optedOutAt: null,
};

type AvoConfig = { feedback?: Partial<FeedbackConfig>; [k: string]: unknown };

function readConfig(dir: string): AvoConfig {
  const p = join(dir, CONFIG_PATH);
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; }
}

function writeConfig(dir: string, config: AvoConfig): void {
  const p = join(dir, CONFIG_PATH);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(config, null, 2));
}

// Legacy remote-oriented keys that must never resurface in the local config.
const LEGACY_REMOTE_KEYS = new Set(["allowAnonymousMetrics"]);

export function getFeedbackConfig(dir: string): FeedbackConfig {
  const raw = readConfig(dir);
  const stored = (raw.feedback ?? {}) as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(stored)) {
    if (!LEGACY_REMOTE_KEYS.has(k)) clean[k] = v;
  }
  return { ...DEFAULTS, ...clean };
}

export function optIn(dir: string): FeedbackConfig {
  const config = readConfig(dir);
  config.feedback = { ...DEFAULTS, ...getFeedbackConfig(dir), enabled: true, optedInAt: new Date().toISOString(), optedOutAt: null };
  writeConfig(dir, config);
  return config.feedback as FeedbackConfig;
}

export function optOut(dir: string): FeedbackConfig {
  const config = readConfig(dir);
  config.feedback = { ...DEFAULTS, ...getFeedbackConfig(dir), enabled: false, optedOutAt: new Date().toISOString() };
  writeConfig(dir, config);
  return config.feedback as FeedbackConfig;
}
