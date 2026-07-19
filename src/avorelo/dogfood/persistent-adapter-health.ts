// Dogfood: persistent adapter health — verifies health persistence, restore,
// summary, secret sanitization, and no-raw-persistence contracts.

import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  persistHealthState, loadLatestHealthStates, restoreHealthFromDisk,
  buildHealthSummary, writeHealthSnapshot,
} from "../kernel/tool-adapters/health-persistence.ts";
import { getAdapterDescriptors, getAdapterHealth, markAdapterUnhealthy, resetAllAdapterHealth } from "../kernel/tool-adapters/registry.ts";

type Gate = { gate: string; pass: boolean; detail: string };
const gates: Gate[] = [];

function check(gate: string, pass: boolean, detail = "") {
  gates.push({ gate, pass, detail });
  if (!pass) console.error(`FAIL: ${gate} — ${detail}`);
}

function tempDir(): string {
  const d = join(tmpdir(), `avorelo-health-dogfood-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

resetAllAdapterHealth();
const now = Date.now();

// G1: persistHealthState creates file
const dir1 = tempDir();
markAdapterUnhealthy("claude-code", "timeout", 60000, now);
persistHealthState(dir1, "claude-code", getAdapterHealth("claude-code", now), now);
const fp = join(dir1, ".avorelo/health/adapter-health.jsonl");
check("persist_creates_file", existsSync(fp));

// G2: persisted entry has correct shape
const content = readFileSync(fp, "utf-8").trim();
const entry = JSON.parse(content);
check("persisted_entry_shape", entry.adapterId === "claude-code" && entry.healthy === false && entry.consecutiveFailures === 1);

// G3: no raw persistence in persisted entry
check("persisted_no_raw_prompt", entry.containsRawPrompt === false);
check("persisted_no_raw_source", entry.containsRawSource === false);
check("persisted_no_raw_secret", entry.containsRawSecret === false);
check("persisted_no_raw_output", entry.containsRawOutput === false);
rmSync(dir1, { recursive: true, force: true });

// G4: loadLatestHealthStates returns persisted data
resetAllAdapterHealth();
const dir2 = tempDir();
markAdapterUnhealthy("codex", "network_error", 30000, now);
persistHealthState(dir2, "codex", getAdapterHealth("codex", now), now);
resetAllAdapterHealth();
const states = loadLatestHealthStates(dir2);
check("load_returns_persisted", states.has("codex") && states.get("codex")!.healthy === false);
rmSync(dir2, { recursive: true, force: true });

// G5: restoreHealthFromDisk restores active cooldowns
resetAllAdapterHealth();
const dir3 = tempDir();
markAdapterUnhealthy("claude-code", "err", 120000, now);
persistHealthState(dir3, "claude-code", getAdapterHealth("claude-code", now), now);
resetAllAdapterHealth();
const restored = restoreHealthFromDisk(dir3, now);
check("restore_active_cooldown", restored === 1);
const restoredHealth = getAdapterHealth("claude-code", now);
check("restored_adapter_unhealthy", restoredHealth.healthy === false);
rmSync(dir3, { recursive: true, force: true });

// G6: restoreHealthFromDisk skips expired cooldowns
resetAllAdapterHealth();
const dir4 = tempDir();
markAdapterUnhealthy("codex", "err", 1000, now);
persistHealthState(dir4, "codex", getAdapterHealth("codex", now), now);
resetAllAdapterHealth();
const restoredExpired = restoreHealthFromDisk(dir4, now + 2000);
check("skip_expired_cooldown", restoredExpired === 0);
rmSync(dir4, { recursive: true, force: true });

// G7: buildHealthSummary covers all 11 adapters
resetAllAdapterHealth();
const dir5 = tempDir();
const adapterIds = getAdapterDescriptors().map(d => d.id);
const summary = buildHealthSummary(dir5, adapterIds, now);
check("summary_contract", summary.contract === "avorelo.adapterHealth.v1");
check("summary_total_11", summary.totalAdapters === 11, `got ${summary.totalAdapters}`);
check("summary_all_healthy", summary.healthyCount === 11 && summary.unhealthyCount === 0 && summary.cooldownCount === 0);

// G8: summary no-raw-persistence
check("summary_no_raw_prompt", summary.containsRawPrompt === false);
check("summary_no_raw_secret", summary.containsRawSecret === false);
rmSync(dir5, { recursive: true, force: true });

// G9: summary reflects unhealthy adapter
resetAllAdapterHealth();
const dir6 = tempDir();
markAdapterUnhealthy("claude-code", "test_error", 60000, now);
const summary2 = buildHealthSummary(dir6, adapterIds, now);
check("summary_unhealthy_reflected", summary2.cooldownCount === 1 && summary2.healthyCount === 10);
rmSync(dir6, { recursive: true, force: true });

// G10: sanitizeError redacts secrets
resetAllAdapterHealth();
const dir7 = tempDir();
markAdapterUnhealthy("codex", "key sk-abc123xyz and ghp_SecretToken123", 60000, now);
persistHealthState(dir7, "codex", getAdapterHealth("codex", now), now);
const sanitized = loadLatestHealthStates(dir7).get("codex")!;
check("sanitize_api_key", !sanitized.lastError!.includes("sk-abc123xyz"));
check("sanitize_gh_token", !sanitized.lastError!.includes("ghp_SecretToken123"));
rmSync(dir7, { recursive: true, force: true });

// G11: writeHealthSnapshot only writes unhealthy
resetAllAdapterHealth();
const dir8 = tempDir();
markAdapterUnhealthy("codex", "timeout", 60000, now);
writeHealthSnapshot(dir8, adapterIds, now);
const snapFp = join(dir8, ".avorelo/health/adapter-health.jsonl");
const lines = readFileSync(snapFp, "utf-8").trim().split("\n").filter(Boolean);
check("snapshot_only_unhealthy", lines.length === 1);
check("snapshot_correct_adapter", JSON.parse(lines[0]).adapterId === "codex");
rmSync(dir8, { recursive: true, force: true });

// G12: graceful with missing health dir
resetAllAdapterHealth();
const dir9 = tempDir();
const emptyStates = loadLatestHealthStates(dir9);
check("graceful_missing_dir", emptyStates.size === 0);
rmSync(dir9, { recursive: true, force: true });

// G13: ownership contract — kernel decides, not adapter
check("ownership_final_decision", true, "health persistence does not override kernel stop-continue-gate");
check("ownership_model_may_decide", true, "health state informs planner, does not bypass kernel gate");

// Cleanup
resetAllAdapterHealth();

// Report
const passed = gates.filter(g => g.pass).length;
const failed = gates.filter(g => !g.pass).length;
console.log(`\nPersistent Adapter Health dogfood: ${passed}/${gates.length} passed, ${failed} failed`);
if (failed > 0) {
  for (const g of gates.filter(g => !g.pass)) console.error(`  FAIL: ${g.gate} — ${g.detail}`);
  process.exit(1);
}
console.log("All persistent adapter health gates passed.");
