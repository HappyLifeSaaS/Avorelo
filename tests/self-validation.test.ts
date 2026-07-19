import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { discoverCapabilities } from "../src/avorelo/capabilities/capability-discovery/index.ts";
import { generateProofContract, inferWorkType } from "../src/avorelo/kernel/proof-contract/index.ts";
import { runAllProof } from "../src/avorelo/kernel/proof-adapters/index.ts";
import { evaluateEvidence } from "../src/avorelo/kernel/evidence-gate/index.ts";
import { createVerificationReceipt, renderVerificationReceipt } from "../src/avorelo/kernel/verification-receipt/index.ts";
import { inferWorkMode, renderGuidedMode, getAllModes } from "../src/avorelo/capabilities/guided-work-modes/index.ts";

describe("self-validation: Avorelo verifying itself", () => {
  const projectDir = process.cwd();

  it("discovers its own capabilities correctly", () => {
    const caps = discoverCapabilities(projectDir);
    assert.ok(caps.build.available, "build should be available");
    assert.ok(caps.test.available, "test should be available");
    assert.equal(caps.containsRawSecret, false);
    assert.ok(caps.recommendedProofPath.length >= 3);
  });

  it("generates a valid proof contract for its own source files", () => {
    const caps = discoverCapabilities(projectDir);
    const contract = generateProofContract([
      "src/avorelo/kernel/proof-contract/index.ts",
      "src/avorelo/kernel/proof-adapters/index.ts",
    ], caps);
    assert.ok(contract.requiredProof.length > 0);
    assert.equal(contract.containsRawSecret, false);
    assert.ok(contract.closureRules.includes("Agent text is never proof"));
  });

  it("runs proof adapters against itself", async () => {
    const result = await runAllProof(projectDir, [], ["product-surface"]);
    assert.ok(result.results.length > 0);
    assert.equal(result.containsRawSecret, false);
  });

  it("evidence gate evaluates its own proof run", async () => {
    const caps = discoverCapabilities(projectDir);
    const contract = generateProofContract(["src/avorelo/kernel/evidence-gate/index.ts"], caps);
    const proofRun = await runAllProof(projectDir, [], ["security-secrets", "product-surface"]);
    const gate = evaluateEvidence(contract, proofRun);
    assert.equal(gate.containsRawSecret, false);
    assert.ok(gate.verdicts.length > 0);
    assert.ok(gate.closureRulesApplied.length > 0);
  });

  it("creates a verification receipt for itself", async () => {
    const caps = discoverCapabilities(projectDir);
    const contract = generateProofContract(["src/avorelo/kernel/verification-receipt/index.ts"], caps);
    const proofRun = await runAllProof(projectDir, [], ["product-surface"]);
    const gate = evaluateEvidence(contract, proofRun);
    const receipt = createVerificationReceipt(projectDir, contract, proofRun, gate);
    assert.ok(receipt.id.startsWith("vr_"));
    assert.equal(receipt.containsRawPrompt, false);
    assert.equal(receipt.containsRawSource, false);
    assert.equal(receipt.containsRawSecret, false);
    assert.equal(receipt.contentStored, false);
    const rendered = renderVerificationReceipt(receipt);
    assert.ok(rendered.includes("Verification Receipt"));
  });

  it("infers work modes for its own files", () => {
    const caps = discoverCapabilities(projectDir);
    const mode = inferWorkMode(["src/avorelo/kernel/proof-contract/index.ts"], caps);
    assert.ok(mode.label);
    assert.ok(mode.steps.length > 0);
    assert.ok(mode.safeCommands.length > 0);
    assert.ok(mode.proofPath.length > 0);
  });

  it("all guided work modes are valid", () => {
    const caps = discoverCapabilities(projectDir);
    const modes = getAllModes();
    assert.ok(modes.length >= 7);
    for (const modeName of modes) {
      const mode = inferWorkMode([], caps, undefined);
      assert.ok(mode.label);
    }
  });

  it("proof contract work type inference is deterministic", () => {
    const files = ["src/auth/login.ts"];
    const r1 = inferWorkType(files);
    const r2 = inferWorkType(files);
    assert.equal(r1.workType, r2.workType);
    assert.deepEqual(r1.reasons, r2.reasons);
  });

  it("privacy invariants hold across the full loop", async () => {
    const caps = discoverCapabilities(projectDir);
    assert.equal(caps.containsRawSecret, false);

    const contract = generateProofContract(["src/index.ts"], caps);
    assert.equal(contract.containsRawSecret, false);

    const proofRun = await runAllProof(projectDir, [], ["product-surface"]);
    assert.equal(proofRun.containsRawSecret, false);
    for (const r of proofRun.results) {
      assert.equal(r.containsRawSecret, false);
    }

    const gate = evaluateEvidence(contract, proofRun);
    assert.equal(gate.containsRawSecret, false);

    const receipt = createVerificationReceipt(projectDir, contract, proofRun, gate);
    assert.equal(receipt.containsRawPrompt, false);
    assert.equal(receipt.containsRawSource, false);
    assert.equal(receipt.containsRawSecret, false);
    assert.equal(receipt.contentStored, false);
  });
});
