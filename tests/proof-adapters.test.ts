import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ALL_ADAPTERS, getAdapter, getAvailableAdapters, getAutomaticAdapters, runAllProof, renderProofRun } from "../src/avorelo/kernel/proof-adapters/index.ts";

describe("proof adapters registry", () => {
  it("has expected adapters", () => {
    const ids = ALL_ADAPTERS.map(a => a.id);
    assert.ok(ids.includes("build-test"));
    assert.ok(ids.includes("security-secrets"));
    assert.ok(ids.includes("product-surface"));
    assert.ok(ids.includes("ui-browser"));
    assert.ok(ids.includes("api-contract"));
  });

  it("getAdapter returns adapter by id", () => {
    const adapter = getAdapter("build-test");
    assert.ok(adapter);
    assert.equal(adapter.id, "build-test");
  });

  it("getAdapter returns undefined for unknown", () => {
    assert.equal(getAdapter("nonexistent"), undefined);
  });

  it("getAvailableAdapters filters by detect", () => {
    const available = getAvailableAdapters(process.cwd());
    assert.ok(available.length > 0);
    assert.ok(available.some(a => a.id === "security-secrets"));
  });

  it("getAutomaticAdapters filters by canRunAutomatically", () => {
    const auto = getAutomaticAdapters(process.cwd());
    for (const a of auto) {
      assert.ok(a.canRunAutomatically());
    }
  });
});

describe("runAllProof", () => {
  it("runs available adapters and returns result", async () => {
    const result = await runAllProof(process.cwd(), []);
    assert.ok(result.timestamp);
    assert.ok(result.results.length > 0);
    assert.ok(["pass", "fail", "partial"].includes(result.overallStatus));
    assert.equal(result.containsRawSecret, false);
  });

  it("runs specific adapters when ids provided", async () => {
    const result = await runAllProof(process.cwd(), [], ["security-secrets"]);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].adapterId, "security-secrets");
  });
});

describe("renderProofRun", () => {
  it("renders readable output", async () => {
    const result = await runAllProof(process.cwd(), [], ["product-surface"]);
    const output = renderProofRun(result);
    assert.ok(output.includes("Proof Run"));
    assert.ok(output.includes("product-surface"));
  });
});
