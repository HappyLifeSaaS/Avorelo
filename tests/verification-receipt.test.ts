import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createVerificationReceipt, storeVerificationReceipt, loadLatestVerificationReceipt, loadAllVerificationReceipts, renderVerificationReceipt } from "../src/avorelo/kernel/verification-receipt/index.ts";
import type { ProofContract } from "../src/avorelo/kernel/proof-contract/index.ts";
import type { ProofRunResult } from "../src/avorelo/kernel/proof-adapters/index.ts";
import type { GateResult } from "../src/avorelo/kernel/evidence-gate/index.ts";

function makeMockContract(): ProofContract {
  return {
    timestamp: new Date().toISOString(),
    workType: "quick_code_fix",
    workTypeReasons: ["test"],
    requiredProof: [],
    optionalProof: [],
    blockedActions: [],
    missingCapabilities: [],
    recommendedCommands: [],
    closureRules: ["Agent text is never proof"],
    containsRawSecret: false,
  };
}

function makeMockProofRun(): ProofRunResult {
  return {
    timestamp: new Date().toISOString(),
    results: [],
    overallStatus: "pass",
    totalDuration: 100,
    containsRawSecret: false,
  };
}

function makeMockGate(safeToClose: boolean): GateResult {
  return {
    timestamp: new Date().toISOString(),
    safeToClose,
    overallStatus: safeToClose ? "safe" : "blocked",
    verdicts: [],
    blockingReasons: safeToClose ? [] : ["test block"],
    warnings: [],
    satisfiedCount: safeToClose ? 5 : 0,
    totalRequired: 5,
    closureRulesApplied: [],
    containsRawSecret: false,
  };
}

describe("createVerificationReceipt", () => {
  it("creates receipt with privacy invariants", () => {
    const receipt = createVerificationReceipt("/test", makeMockContract(), makeMockProofRun(), makeMockGate(true));
    assert.ok(receipt.id.startsWith("vr_"));
    assert.equal(receipt.containsRawPrompt, false);
    assert.equal(receipt.containsRawSource, false);
    assert.equal(receipt.containsRawSecret, false);
    assert.equal(receipt.contentStored, false);
    assert.equal(receipt.safeToClose, true);
  });

  it("reflects blocked gate", () => {
    const receipt = createVerificationReceipt("/test", makeMockContract(), makeMockProofRun(), makeMockGate(false));
    assert.equal(receipt.safeToClose, false);
    assert.equal(receipt.overallStatus, "blocked");
  });
});

describe("store and load receipts", () => {
  let tmpDir: string;

  it("stores and loads receipts", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "avorelo-receipt-test-"));
    const receipt = createVerificationReceipt(tmpDir, makeMockContract(), makeMockProofRun(), makeMockGate(true));
    const path = storeVerificationReceipt(receipt, tmpDir);
    assert.ok(path.includes("receipt-"));

    const loaded = loadLatestVerificationReceipt(tmpDir);
    assert.ok(loaded);
    assert.equal(loaded!.id, receipt.id);

    const all = loadAllVerificationReceipts(tmpDir);
    assert.equal(all.length, 1);
    assert.equal(all[0].id, receipt.id);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no receipts exist", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "avorelo-receipt-test-"));
    const loaded = loadLatestVerificationReceipt(tmpDir);
    assert.equal(loaded, null);
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("renderVerificationReceipt", () => {
  it("renders readable output", () => {
    const receipt = createVerificationReceipt("/test", makeMockContract(), makeMockProofRun(), makeMockGate(true));
    const output = renderVerificationReceipt(receipt);
    assert.ok(output.includes("Verification Receipt"));
    assert.ok(output.includes("Privacy invariants"));
    assert.ok(output.includes("containsRawSecret: false"));
  });
});
