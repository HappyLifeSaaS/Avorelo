import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateEvidence } from "../src/avorelo/kernel/evidence-gate/index.ts";
import { generateProofContract } from "../src/avorelo/kernel/proof-contract/index.ts";
import { discoverCapabilities } from "../src/avorelo/capabilities/capability-discovery/index.ts";
import type { ProofRunResult } from "../src/avorelo/kernel/proof-adapters/index.ts";
import type { AdapterResult } from "../src/avorelo/kernel/proof-adapters/types.ts";

function makeResult(id: string, status: "pass" | "fail" | "skip", evidences: { type: string; passed: boolean; summary: string }[]): AdapterResult {
  return {
    adapterId: id,
    status,
    evidence: evidences.map(e => ({ ...e })),
    duration: 50,
    containsRawSecret: false as const,
  };
}

function makeRun(results: AdapterResult[]): ProofRunResult {
  return {
    timestamp: new Date().toISOString(),
    results,
    overallStatus: results.every(r => r.status === "pass" || r.status === "skip") ? "pass" : "fail",
    totalDuration: 100,
    containsRawSecret: false as const,
  };
}

const caps = discoverCapabilities(process.cwd());

describe("evidence gate negative scenarios", () => {
  it("UI change with build-only proof must NOT be safe_to_close", () => {
    const contract = generateProofContract(["src/components/Header.tsx", "src/pages/Home.tsx"], caps);
    const run = makeRun([
      makeResult("build-test", "pass", [
        { type: "build_passed", passed: true, summary: "Build passed" },
        { type: "tests_passed", passed: true, summary: "Tests passed" },
      ]),
    ]);
    const gate = evaluateEvidence(contract, run);
    assert.equal(gate.safeToClose, false, "UI change with build-only proof must not be safe_to_close");
    assert.ok(gate.blockingReasons.length > 0, "Should have blocking reasons");
  });

  it("security-sensitive change without security proof must NOT be safe_to_close", () => {
    const contract = generateProofContract(["src/auth/login.ts"], caps);
    const run = makeRun([
      makeResult("build-test", "pass", [
        { type: "build_passed", passed: true, summary: "Build passed" },
      ]),
    ]);
    const gate = evaluateEvidence(contract, run);
    assert.equal(gate.safeToClose, false, "Security change without secret scan must be blocked");
    assert.ok(gate.blockingReasons.some(r => r.toLowerCase().includes("secret") || r.toLowerCase().includes("no adapter")),
      "Blocking reason should mention secret scan or missing adapter");
  });

  it("release readiness with missing clean_worktree proof must be blocked", () => {
    const contract = generateProofContract([".github/workflows/ci.yml", "netlify.toml"], caps);
    const run = makeRun([
      makeResult("build-test", "pass", [{ type: "build_passed", passed: true, summary: "Build passed" }]),
    ]);
    const gate = evaluateEvidence(contract, run);
    assert.equal(gate.safeToClose, false, "Release readiness without clean worktree must be blocked");
  });

  it("fake metric in product surface must cause failure", () => {
    const contract = generateProofContract(["src/components/Header.tsx"], caps);
    const run = makeRun([
      makeResult("build-test", "pass", [
        { type: "build_passed", passed: true, summary: "Build passed" },
      ]),
      makeResult("product-surface", "fail", [
        { type: "fake_metric", passed: false, summary: "Unsubstantiated 50% reduction claim" },
      ]),
    ]);
    const gate = evaluateEvidence(contract, run);
    assert.equal(gate.safeToClose, false, "Fake metric must block safe_to_close");
  });

  it("publish/deploy must be in blocked actions", () => {
    const contract = generateProofContract(["src/index.ts"], caps);
    assert.ok(contract.blockedActions.includes("npm publish"), "npm publish must be blocked");
    assert.ok(contract.blockedActions.includes("production deploy"), "production deploy must be blocked");
  });
});

describe("evidence gate positive scenario", () => {
  it("sufficient evidence produces safe_to_close or exact missing proof", () => {
    const contract = generateProofContract(["src/utils/helpers.ts"], caps);
    const run = makeRun([
      makeResult("build-test", "pass", [
        { type: "build_passed", passed: true, summary: "Build passed" },
        { type: "tests_passed", passed: true, summary: "Tests passed" },
      ]),
      makeResult("security-secrets", "pass", [
        { type: "no_secret_findings", passed: true, summary: "No secrets" },
      ]),
      makeResult("product-surface", "pass", [
        { type: "product_surface_clean", passed: true, summary: "Clean" },
      ]),
    ]);
    const gate = evaluateEvidence(contract, run);

    if (gate.safeToClose) {
      assert.equal(gate.overallStatus, "safe");
    } else {
      assert.ok(gate.blockingReasons.length > 0, "If not safe, must have exact blocking reasons");
      for (const reason of gate.blockingReasons) {
        assert.ok(reason.length > 0, "Each blocking reason must be non-empty");
      }
    }
    assert.equal(gate.containsRawSecret, false);
  });
});
