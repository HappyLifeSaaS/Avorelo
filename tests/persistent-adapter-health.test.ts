import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  persistHealthState, loadLatestHealthStates, restoreHealthFromDisk,
  buildHealthSummary, writeHealthSnapshot,
} from "../src/avorelo/kernel/tool-adapters/health-persistence.ts";
import { markAdapterUnhealthy, resetAllAdapterHealth, getAdapterHealth } from "../src/avorelo/kernel/tool-adapters/registry.ts";
import { getAdapterDescriptors } from "../src/avorelo/kernel/tool-adapters/registry.ts";

function tempDir(): string {
  const d = join(tmpdir(), `avorelo-health-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

describe("Persistent Adapter Health v1", () => {

  beforeEach(() => {
    resetAllAdapterHealth();
  });

  it("persists health state to disk", () => {
    const dir = tempDir();
    const now = Date.now();
    markAdapterUnhealthy("claude-code", "timeout", 60000, now);
    const state = getAdapterHealth("claude-code", now);
    persistHealthState(dir, "claude-code", state, now);

    const fp = join(dir, ".avorelo/health/adapter-health.jsonl");
    assert.ok(existsSync(fp), "health file created");
    const content = readFileSync(fp, "utf-8");
    const entry = JSON.parse(content.trim());
    assert.equal(entry.adapterId, "claude-code");
    assert.equal(entry.healthy, false);
    assert.equal(entry.consecutiveFailures, 1);
    assert.equal(entry.containsRawPrompt, false);
    assert.equal(entry.containsRawSecret, false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads latest health states from disk", () => {
    const dir = tempDir();
    const now = Date.now();
    markAdapterUnhealthy("codex", "auth_error", 30000, now);
    persistHealthState(dir, "codex", getAdapterHealth("codex", now), now);

    resetAllAdapterHealth();
    const states = loadLatestHealthStates(dir);
    assert.ok(states.has("codex"));
    assert.equal(states.get("codex")!.healthy, false);
    assert.equal(states.get("codex")!.consecutiveFailures, 1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("restores unhealthy adapters from disk on startup", () => {
    const dir = tempDir();
    const now = Date.now();
    markAdapterUnhealthy("claude-code", "network_error", 120000, now);
    persistHealthState(dir, "claude-code", getAdapterHealth("claude-code", now), now);

    resetAllAdapterHealth();
    const restored = restoreHealthFromDisk(dir, now);
    assert.equal(restored, 1);
    const health = getAdapterHealth("claude-code", now);
    assert.equal(health.healthy, false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not restore expired cooldowns", () => {
    const dir = tempDir();
    const now = Date.now();
    markAdapterUnhealthy("codex", "timeout", 1000, now);
    persistHealthState(dir, "codex", getAdapterHealth("codex", now), now);

    resetAllAdapterHealth();
    const restored = restoreHealthFromDisk(dir, now + 2000);
    assert.equal(restored, 0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("builds health summary for all adapters", () => {
    const dir = tempDir();
    const now = Date.now();
    const adapterIds = getAdapterDescriptors().map(d => d.id);
    const summary = buildHealthSummary(dir, adapterIds, now);

    assert.equal(summary.contract, "avorelo.adapterHealth.v1");
    assert.equal(summary.totalAdapters, 11);
    assert.equal(summary.healthyCount, 11);
    assert.equal(summary.unhealthyCount, 0);
    assert.equal(summary.cooldownCount, 0);
    assert.equal(summary.containsRawPrompt, false);
    assert.equal(summary.containsRawSecret, false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("health summary reflects unhealthy adapter", () => {
    const dir = tempDir();
    const now = Date.now();
    markAdapterUnhealthy("claude-code", "error", 60000, now);
    const adapterIds = getAdapterDescriptors().map(d => d.id);
    const summary = buildHealthSummary(dir, adapterIds, now);

    assert.equal(summary.healthyCount, 10);
    assert.equal(summary.cooldownCount, 1);
    const claude = summary.adapters.find(a => a.adapterId === "claude-code");
    assert.ok(claude);
    assert.equal(claude.healthy, false);
    assert.equal(claude.consecutiveFailures, 1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("sanitizes secrets in error messages", () => {
    const dir = tempDir();
    const now = Date.now();
    markAdapterUnhealthy("codex", "failed with sk-abc123xyz token ghp_SecretToken123", 60000, now);
    persistHealthState(dir, "codex", getAdapterHealth("codex", now), now);

    const states = loadLatestHealthStates(dir);
    const entry = states.get("codex")!;
    assert.ok(!entry.lastError!.includes("sk-abc123xyz"), "API key redacted");
    assert.ok(!entry.lastError!.includes("ghp_SecretToken123"), "GH token redacted");
    assert.ok(entry.lastError!.includes("[REDACTED_API_KEY]") || entry.lastError!.includes("[REDACTED_GH_TOKEN]"));
    rmSync(dir, { recursive: true, force: true });
  });

  it("handles multiple persist calls (appends, latest wins)", () => {
    const dir = tempDir();
    const now = Date.now();
    markAdapterUnhealthy("claude-code", "error1", 60000, now);
    persistHealthState(dir, "claude-code", getAdapterHealth("claude-code", now), now);
    markAdapterUnhealthy("claude-code", "error2", 120000, now + 1000);
    persistHealthState(dir, "claude-code", getAdapterHealth("claude-code", now + 1000), now + 1000);

    const states = loadLatestHealthStates(dir);
    const entry = states.get("claude-code")!;
    assert.equal(entry.consecutiveFailures, 2);
    assert.ok(entry.lastError!.includes("error2"));
    rmSync(dir, { recursive: true, force: true });
  });

  it("writeHealthSnapshot only writes unhealthy adapters", () => {
    const dir = tempDir();
    const now = Date.now();
    markAdapterUnhealthy("codex", "timeout", 60000, now);
    const adapterIds = getAdapterDescriptors().map(d => d.id);
    const summary = writeHealthSnapshot(dir, adapterIds, now);

    const fp = join(dir, ".avorelo/health/adapter-health.jsonl");
    const lines = readFileSync(fp, "utf-8").trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 1, "only unhealthy adapters written");
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.adapterId, "codex");
    rmSync(dir, { recursive: true, force: true });
  });

  it("no raw persistence in any health entry", () => {
    const dir = tempDir();
    const now = Date.now();
    markAdapterUnhealthy("claude-code", "test error", 60000, now);
    persistHealthState(dir, "claude-code", getAdapterHealth("claude-code", now), now);

    const states = loadLatestHealthStates(dir);
    const entry = states.get("claude-code")!;
    assert.equal(entry.containsRawPrompt, false);
    assert.equal(entry.containsRawSource, false);
    assert.equal(entry.containsRawSecret, false);
    assert.equal(entry.containsRawOutput, false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("graceful with missing health dir", () => {
    const dir = tempDir();
    const states = loadLatestHealthStates(dir);
    assert.equal(states.size, 0);
    const restored = restoreHealthFromDisk(dir, Date.now());
    assert.equal(restored, 0);
    rmSync(dir, { recursive: true, force: true });
  });
});
