// Dogfood: cost benchmarking — verifies adapter cost profiles, benchmark entries,
// summaries, ranking, and no-raw-persistence contracts.

import {
  getAdapterCostProfile, getAllCostProfiles, createBenchmarkEntry,
  buildCostBenchmarkSummary, estimateTaskCost, rankAdaptersByCostEfficiency,
} from "../kernel/tool-adapters/cost-benchmarking.ts";
import type { ToolExecutionResult } from "../kernel/tool-adapters/types.ts";

type Gate = { gate: string; pass: boolean; detail: string };
const gates: Gate[] = [];

function check(gate: string, pass: boolean, detail = "") {
  gates.push({ gate, pass, detail });
  if (!pass) console.error(`FAIL: ${gate} — ${detail}`);
}

function fakeResult(adapterId: string, status: "executed" | "failed" = "executed", durationMs = 1000): ToolExecutionResult {
  return {
    adapterId, executionMode: "real", status, durationMs,
    proofCollected: false, receiptId: `r-${adapterId}`, reasonCodes: [], failureClass: null,
  };
}

// G1: 11 cost profiles
const profiles = getAllCostProfiles();
check("profiles_count_11", profiles.length === 11, `got ${profiles.length}`);

// G2: all profiles have no-raw-secret
check("profiles_no_raw_secret", profiles.every(p => p.containsRawSecret === false && p.containsRawPrompt === false));

// G3: free adapters have zero cost
for (const id of ["deterministic-local", "manual-gate", "scanner", "semgrep", "playwright-proof"] as const) {
  const p = getAdapterCostProfile(id);
  check(`free_${id}`, p.costTier === "free" && p.estimatedCostPerTaskUsd === 0);
}

// G4: pay-per-use adapters have positive cost
for (const id of ["claude-code", "codex", "gemini-cli", "aider", "github-actions"] as const) {
  const p = getAdapterCostProfile(id);
  check(`pay_per_use_${id}`, p.costTier === "pay_per_use" && (p.estimatedCostPerTaskUsd ?? 0) > 0);
}

// G5: cursor is subscription
check("cursor_subscription", getAdapterCostProfile("cursor").costTier === "subscription");

// G6: unknown adapter returns unknown tier
check("unknown_adapter_tier", getAdapterCostProfile("mystery").costTier === "unknown");

// G7: benchmark entry has no-raw fields
const entry = createBenchmarkEntry(fakeResult("claude-code"), "code_gen", 5000);
check("entry_no_raw", entry.containsRawPrompt === false && entry.containsRawSource === false && entry.containsRawSecret === false && entry.containsRawOutput === false);

// G8: free adapter entry has zero cost
const freeEntry = createBenchmarkEntry(fakeResult("deterministic-local"), "lint", null);
check("free_entry_zero_cost", freeEntry.estimatedCostUsd === 0);

// G9: summary contract and ownership
const entries = [
  createBenchmarkEntry(fakeResult("claude-code", "executed", 2000), "gen", 3000),
  createBenchmarkEntry(fakeResult("codex", "executed", 1500), "gen", 2000),
  createBenchmarkEntry(fakeResult("deterministic-local", "executed", 50), "lint", null),
];
const summary = buildCostBenchmarkSummary(entries);
check("summary_contract", summary.contract === "avorelo.costBenchmark.v1");
check("summary_ownership", summary.modelMayDecide === false && summary.scannerMayDecide === false && summary.finalDecisionOwner === "kernel/stop-continue-gate");
check("summary_no_raw", summary.containsRawPrompt === false && summary.containsRawSecret === false);

// G10: summary breakdown
check("summary_breakdown_count", summary.adapterBreakdown.length === 3);
check("summary_total_cost_positive", summary.totalEstimatedCostUsd > 0);

// G11: fastest/cheapest identification
const ranked = [
  createBenchmarkEntry(fakeResult("claude-code", "executed", 5000), "task", 10000),
  createBenchmarkEntry(fakeResult("gemini-cli", "executed", 1000), "task", 10000),
];
const rankedSummary = buildCostBenchmarkSummary(ranked);
check("fastest_identified", rankedSummary.fastestAdapter === "gemini-cli");
check("cheapest_identified", rankedSummary.cheapestAdapter === "gemini-cli");

// G12: reliability identification
const reliabilityEntries = [
  createBenchmarkEntry(fakeResult("claude-code", "executed", 1000), "t", null),
  createBenchmarkEntry(fakeResult("claude-code", "failed", 500), "t", null),
  createBenchmarkEntry(fakeResult("codex", "executed", 1000), "t", null),
  createBenchmarkEntry(fakeResult("codex", "executed", 1000), "t", null),
];
const relSummary = buildCostBenchmarkSummary(reliabilityEntries);
check("most_reliable_codex", relSummary.mostReliableAdapter === "codex");

// G13: estimateTaskCost
check("estimate_free_zero", estimateTaskCost("deterministic-local", null) === 0);
check("estimate_pay_positive", (estimateTaskCost("claude-code", 10000) ?? 0) > 0);
check("estimate_unknown_null", estimateTaskCost("mystery", null) === null);

// G14: rankAdaptersByCostEfficiency
const ranking = rankAdaptersByCostEfficiency(["claude-code", "gemini-cli", "deterministic-local", "cursor"], 5000);
check("rank_cheapest_first", ranking[0].adapterId === "deterministic-local");
check("rank_unknown_last", ranking[ranking.length - 1].adapterId === "cursor");

// G15: empty summary valid
const emptySummary = buildCostBenchmarkSummary([]);
check("empty_summary_valid", emptySummary.totalEstimatedCostUsd === 0 && emptySummary.cheapestAdapter === null);

// Report
const passed = gates.filter(g => g.pass).length;
const failed = gates.filter(g => !g.pass).length;
console.log(`\nCost Benchmarking dogfood: ${passed}/${gates.length} passed, ${failed} failed`);
if (failed > 0) {
  for (const g of gates.filter(g => !g.pass)) console.error(`  FAIL: ${g.gate} — ${g.detail}`);
  process.exit(1);
}
console.log("All cost benchmarking gates passed.");
