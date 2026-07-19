import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getAdapterCostProfile, getAllCostProfiles, createBenchmarkEntry,
  buildCostBenchmarkSummary, estimateTaskCost, rankAdaptersByCostEfficiency,
} from "../src/avorelo/kernel/tool-adapters/cost-benchmarking.ts";
import type { ToolExecutionResult } from "../src/avorelo/kernel/tool-adapters/types.ts";

function fakeResult(adapterId: string, status: "executed" | "failed" = "executed", durationMs = 1000): ToolExecutionResult {
  return {
    adapterId, executionMode: "real", status, durationMs,
    proofCollected: false, receiptId: `r-${adapterId}`, reasonCodes: [], failureClass: null,
  };
}

describe("Cost Benchmarking v1", () => {

  it("returns cost profiles for all 11 well-known adapters", () => {
    const profiles = getAllCostProfiles();
    assert.equal(profiles.length, 11);
    for (const p of profiles) {
      assert.equal(p.containsRawSecret, false);
      assert.equal(p.containsRawPrompt, false);
    }
  });

  it("free adapters have zero cost", () => {
    for (const id of ["deterministic-local", "manual-gate", "scanner", "semgrep", "playwright-proof"] as const) {
      const p = getAdapterCostProfile(id);
      assert.equal(p.costTier, "free");
      assert.equal(p.estimatedCostPerTaskUsd, 0);
    }
  });

  it("pay-per-use adapters have non-null costs", () => {
    for (const id of ["claude-code", "codex", "gemini-cli", "aider", "github-actions"] as const) {
      const p = getAdapterCostProfile(id);
      assert.equal(p.costTier, "pay_per_use");
      assert.ok(p.estimatedCostPerTaskUsd !== null && p.estimatedCostPerTaskUsd > 0);
    }
  });

  it("cursor is subscription tier with null per-task cost", () => {
    const p = getAdapterCostProfile("cursor");
    assert.equal(p.costTier, "subscription");
    assert.equal(p.estimatedCostPerTaskUsd, null);
  });

  it("unknown adapter gets unknown tier", () => {
    const p = getAdapterCostProfile("some-future-adapter");
    assert.equal(p.costTier, "unknown");
    assert.equal(p.estimatedCostPerTaskUsd, null);
  });

  it("createBenchmarkEntry produces no-raw entry", () => {
    const entry = createBenchmarkEntry(fakeResult("claude-code"), "code_generation", 5000);
    assert.equal(entry.adapterId, "claude-code");
    assert.equal(entry.success, true);
    assert.ok(entry.estimatedCostUsd !== null);
    assert.equal(entry.containsRawPrompt, false);
    assert.equal(entry.containsRawSource, false);
    assert.equal(entry.containsRawSecret, false);
    assert.equal(entry.containsRawOutput, false);
  });

  it("createBenchmarkEntry for free adapter has zero cost", () => {
    const entry = createBenchmarkEntry(fakeResult("deterministic-local"), "lint_check", null);
    assert.equal(entry.estimatedCostUsd, 0);
  });

  it("buildCostBenchmarkSummary computes correct totals", () => {
    const entries = [
      createBenchmarkEntry(fakeResult("claude-code", "executed", 2000), "code_gen", 3000),
      createBenchmarkEntry(fakeResult("codex", "executed", 1500), "code_gen", 2000),
      createBenchmarkEntry(fakeResult("deterministic-local", "executed", 100), "lint", null),
    ];
    const summary = buildCostBenchmarkSummary(entries);
    assert.equal(summary.contract, "avorelo.costBenchmark.v1");
    assert.equal(summary.entries.length, 3);
    assert.equal(summary.adapterBreakdown.length, 3);
    assert.ok(summary.totalEstimatedCostUsd > 0);
    assert.equal(summary.modelMayDecide, false);
    assert.equal(summary.scannerMayDecide, false);
    assert.equal(summary.finalDecisionOwner, "kernel/stop-continue-gate");
    assert.equal(summary.containsRawPrompt, false);
    assert.equal(summary.containsRawSecret, false);
  });

  it("summary identifies cheapest and fastest adapters", () => {
    const entries = [
      createBenchmarkEntry(fakeResult("claude-code", "executed", 5000), "task", 10000),
      createBenchmarkEntry(fakeResult("gemini-cli", "executed", 1000), "task", 10000),
    ];
    const summary = buildCostBenchmarkSummary(entries);
    assert.equal(summary.fastestAdapter, "gemini-cli");
    assert.equal(summary.cheapestAdapter, "gemini-cli");
  });

  it("summary identifies most reliable adapter", () => {
    const entries = [
      createBenchmarkEntry(fakeResult("claude-code", "executed", 1000), "task", null),
      createBenchmarkEntry(fakeResult("claude-code", "failed", 500), "task", null),
      createBenchmarkEntry(fakeResult("codex", "executed", 1000), "task", null),
      createBenchmarkEntry(fakeResult("codex", "executed", 1000), "task", null),
    ];
    const summary = buildCostBenchmarkSummary(entries);
    assert.equal(summary.mostReliableAdapter, "codex");
  });

  it("estimateTaskCost returns 0 for free adapters", () => {
    assert.equal(estimateTaskCost("deterministic-local", null), 0);
    assert.equal(estimateTaskCost("scanner", 5000), 0);
  });

  it("estimateTaskCost returns non-null for pay-per-use with tokens", () => {
    const cost = estimateTaskCost("claude-code", 10000);
    assert.ok(cost !== null && cost > 0);
  });

  it("estimateTaskCost returns null for unknown adapter", () => {
    assert.equal(estimateTaskCost("mystery-adapter", null), null);
  });

  it("rankAdaptersByCostEfficiency sorts cheapest first", () => {
    const ranked = rankAdaptersByCostEfficiency(
      ["claude-code", "gemini-cli", "deterministic-local", "cursor"],
      5000,
    );
    assert.equal(ranked[0].adapterId, "deterministic-local");
    assert.equal(ranked[0].estimatedCostUsd, 0);
    assert.equal(ranked[ranked.length - 1].adapterId, "cursor");
  });

  it("empty benchmark summary is valid", () => {
    const summary = buildCostBenchmarkSummary([]);
    assert.equal(summary.totalEstimatedCostUsd, 0);
    assert.equal(summary.adapterBreakdown.length, 0);
    assert.equal(summary.cheapestAdapter, null);
    assert.equal(summary.fastestAdapter, null);
  });
});
