import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateEvidence, renderGateResult } from "../src/avorelo/kernel/evidence-gate/index.ts";
import { generateProofContract } from "../src/avorelo/kernel/proof-contract/index.ts";
import { discoverCapabilities } from "../src/avorelo/capabilities/capability-discovery/index.ts";
import type { ProofRunResult } from "../src/avorelo/kernel/proof-adapters/index.ts";

function makeProofRun(overallStatus: "pass" | "fail", adapters: { id: string; status: "pass" | "fail" | "skip"; evidenceType: string; passed: boolean }[]): ProofRunResult {
  return {
    timestamp: new Date().toISOString(),
    results: adapters.map(a => ({
      adapterId: a.id,
      status: a.status,
      evidence: [{
        type: a.evidenceType,
        summary: `${a.evidenceType}: ${a.passed ? "ok" : "failed"}`,
        passed: a.passed,
      }],
      duration: 100,
      containsRawSecret: false as const,
    })),
    overallStatus,
    totalDuration: 200,
    containsRawSecret: false as const,
  };
}

describe("evaluateEvidence", () => {
  it("marks safe to close when all critical pass", () => {
    const caps = discoverCapabilities(process.cwd());
    const contract = generateProofContract(["src/utils/helpers.ts"], caps);
    const proofRun = makeProofRun("pass", [
      { id: "security-secrets", status: "pass", evidenceType: "no_secret_findings", passed: true },
      { id: "build-test", status: "pass", evidenceType: "build_passed", passed: true },
      { id: "build-test", status: "pass", evidenceType: "tests_passed", passed: true },
    ]);

    const gate = evaluateEvidence(contract, proofRun);
    assert.equal(gate.containsRawSecret, false);
    assert.ok(gate.verdicts.length > 0);
  });

  it("blocks when critical evidence fails", () => {
    const caps = discoverCapabilities(process.cwd());
    const contract = generateProofContract(["src/auth/login.ts"], caps);
    const proofRun = makeProofRun("fail", [
      { id: "security-secrets", status: "fail", evidenceType: "no_secret_findings", passed: false },
    ]);

    const gate = evaluateEvidence(contract, proofRun);
    assert.equal(gate.safeToClose, false);
    assert.equal(gate.overallStatus, "blocked");
    assert.ok(gate.blockingReasons.length > 0);
  });

  it("includes closure rules from contract", () => {
    const caps = discoverCapabilities(process.cwd());
    const contract = generateProofContract(["src/index.ts"], caps);
    const proofRun = makeProofRun("pass", []);

    const gate = evaluateEvidence(contract, proofRun);
    assert.ok(gate.closureRulesApplied.length > 0);
    assert.ok(gate.closureRulesApplied.some(r => r.includes("Agent text is never proof")));
  });
});

describe("renderGateResult", () => {
  it("renders readable output", () => {
    const caps = discoverCapabilities(process.cwd());
    const contract = generateProofContract(["src/index.ts"], caps);
    const proofRun = makeProofRun("pass", [
      { id: "security-secrets", status: "pass", evidenceType: "no_secret_findings", passed: true },
    ]);
    const gate = evaluateEvidence(contract, proofRun);
    const output = renderGateResult(gate);
    assert.ok(output.includes("Evidence Gate"));
    assert.ok(output.includes("Closure rules"));
  });
});
