// Proves the relocated canonical sanitizeReceipt (kernel/receipts/sanitize.ts) drops all unsafe content
// and keeps only the safe allowlisted projection. Behavior must match the pre-move cloud-sync version.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeReceipt, SAFE_REASON_CODES, type LocalReceipt } from "../src/avorelo/kernel/receipts/sanitize.ts";

test("sanitizeReceipt excludes raw prompt / source / secret / diff / paths", () => {
  const receipt = {
    receiptId: "r1",
    contractId: "cli_activate",
    decision: "STOP_DONE",
    reasonCodes: ["STOP_DONE", "NOT_A_SAFE_CODE"],
    graded: [{ artifactId: "a", level: "measured" }],
    // hostile fields that must never survive:
    prompt: "raw user prompt text",
    modelResponse: "raw model output",
    sourceCode: "function secret(){}",
    gitDiff: "- old\n+ new",
    apiKey: "sk_live_xxx",
    fullPath: "C:/Users/benja/secret.txt",
  } as unknown as LocalReceipt;

  const s = sanitizeReceipt(receipt);
  const serialized = JSON.stringify(s);

  // only allowlisted keys survive
  assert.deepEqual(
    Object.keys(s).sort(),
    ["capabilityName", "decision", "detectedStates", "estimatedFields", "evidenceLevels", "localReceiptId", "measuredCounters", "reasonCodes", "sessionTimestamp"],
  );
  // unsafe content is absent
  for (const bad of ["raw user prompt", "raw model output", "function secret", "old\\n+ new", "sk_live_xxx", "secret.txt", "prompt", "sourceCode", "gitDiff", "apiKey", "fullPath"]) {
    assert.ok(!serialized.includes(bad), `leaked: ${bad}`);
  }
  // unsafe reason code filtered out; safe one kept
  assert.deepEqual(s.reasonCodes, ["STOP_DONE"]);
  assert.equal(s.localReceiptId, "r1");
  assert.equal(s.capabilityName, "activate");
});

test("SAFE_REASON_CODES is a non-empty allowlist", () => {
  assert.ok(SAFE_REASON_CODES.has("STOP_DONE"));
  assert.ok(!SAFE_REASON_CODES.has("NOT_A_SAFE_CODE"));
});
