import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolAdapterId, AdapterHealthState } from "./types.ts";
import { getAdapterHealth, markAdapterUnhealthy } from "./registry.ts";

export type PersistedHealthEntry = {
  adapterId: ToolAdapterId;
  healthy: boolean;
  lastError: string | null;
  cooldownUntil: number;
  consecutiveFailures: number;
  recordedAt: number;
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawSecret: false;
  containsRawOutput: false;
};

export type HealthSummary = {
  contract: "avorelo.adapterHealth.v1";
  adapters: PersistedHealthEntry[];
  totalAdapters: number;
  healthyCount: number;
  unhealthyCount: number;
  cooldownCount: number;
  lastUpdated: number;
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawSecret: false;
  containsRawOutput: false;
};

const HEALTH_DIR = ".avorelo/health";
const HEALTH_FILE = "adapter-health.jsonl";

function healthDir(dir: string): string {
  return join(dir, HEALTH_DIR);
}

function healthFilePath(dir: string): string {
  return join(dir, HEALTH_DIR, HEALTH_FILE);
}

function ensureHealthDir(dir: string): void {
  const d = healthDir(dir);
  if (!existsSync(d)) {
    mkdirSync(d, { recursive: true });
  }
}

function sanitizeError(error: string | null): string | null {
  if (!error) return null;
  return error
    .replace(/[A-Za-z0-9+/=]{40,}/g, "[REDACTED_TOKEN]")
    .replace(/ghp_[A-Za-z0-9]+/g, "[REDACTED_GH_TOKEN]")
    .replace(/sk-[A-Za-z0-9]+/g, "[REDACTED_API_KEY]")
    .replace(/Bearer\s+[^\s]+/g, "Bearer [REDACTED]")
    .slice(0, 500);
}

export function persistHealthState(dir: string, adapterId: ToolAdapterId, state: AdapterHealthState, now: number): void {
  ensureHealthDir(dir);
  const entry: PersistedHealthEntry = {
    adapterId: state.adapterId,
    healthy: state.healthy,
    lastError: sanitizeError(state.lastError),
    cooldownUntil: state.cooldownUntil,
    consecutiveFailures: state.consecutiveFailures,
    recordedAt: now,
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
    containsRawOutput: false,
  };
  appendFileSync(healthFilePath(dir), JSON.stringify(entry) + "\n", "utf-8");
}

export function loadLatestHealthStates(dir: string): Map<ToolAdapterId, PersistedHealthEntry> {
  const fp = healthFilePath(dir);
  if (!existsSync(fp)) return new Map();

  const lines = readFileSync(fp, "utf-8").trim().split("\n").filter(Boolean);
  const latest = new Map<ToolAdapterId, PersistedHealthEntry>();

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as PersistedHealthEntry;
      if (entry.adapterId && typeof entry.healthy === "boolean") {
        latest.set(entry.adapterId, entry);
      }
    } catch { /* skip malformed lines */ }
  }

  return latest;
}

export function restoreHealthFromDisk(dir: string, now: number): number {
  const states = loadLatestHealthStates(dir);
  let restored = 0;

  for (const [adapterId, entry] of states) {
    if (!entry.healthy && entry.cooldownUntil > now) {
      markAdapterUnhealthy(adapterId, entry.lastError ?? "restored_from_disk", entry.cooldownUntil - now, now);
      restored++;
    }
  }

  return restored;
}

export function buildHealthSummary(dir: string, adapterIds: ToolAdapterId[], now: number): HealthSummary {
  const persisted = loadLatestHealthStates(dir);
  const adapters: PersistedHealthEntry[] = [];
  let healthyCount = 0;
  let unhealthyCount = 0;
  let cooldownCount = 0;

  for (const id of adapterIds) {
    const inMemory = getAdapterHealth(id, now);
    const onDisk = persisted.get(id);
    const effective = inMemory.consecutiveFailures > 0 ? inMemory : (onDisk ?? inMemory);

    const entry: PersistedHealthEntry = {
      adapterId: id,
      healthy: effective.healthy,
      lastError: sanitizeError(effective.lastError),
      cooldownUntil: effective.cooldownUntil,
      consecutiveFailures: effective.consecutiveFailures,
      recordedAt: now,
      containsRawPrompt: false,
      containsRawSource: false,
      containsRawSecret: false,
      containsRawOutput: false,
    };

    adapters.push(entry);

    if (!entry.healthy && entry.cooldownUntil > now) {
      cooldownCount++;
    } else if (!entry.healthy) {
      unhealthyCount++;
    } else {
      healthyCount++;
    }
  }

  return {
    contract: "avorelo.adapterHealth.v1",
    adapters,
    totalAdapters: adapterIds.length,
    healthyCount,
    unhealthyCount,
    cooldownCount,
    lastUpdated: now,
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
    containsRawOutput: false,
  };
}

export function writeHealthSnapshot(dir: string, adapterIds: ToolAdapterId[], now: number): HealthSummary {
  const summary = buildHealthSummary(dir, adapterIds, now);
  ensureHealthDir(dir);

  for (const entry of summary.adapters) {
    if (entry.consecutiveFailures > 0) {
      appendFileSync(healthFilePath(dir), JSON.stringify(entry) + "\n", "utf-8");
    }
  }

  return summary;
}
