// Proves the relocated receipt-safety gate (kernel/receipts/eligibility.ts) makes identical decisions
// to the pre-move cloud-sync/eligibility.ts. Pure local decision; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateReceiptSafety } from "../src/avorelo/kernel/receipts/eligibility.ts";

const SAFE = ["STOP_DONE"];

test("eligible only when allowlisted + redacted + clean payload + safe reason codes", () => {
  assert.equal(evaluateReceiptSafety({ allowlisted: true, redacted: true, payload: { count: 1, decision: "STOP_DONE" }, reasonCodes: SAFE }).eligible, true);
});

test("not allowlisted -> ineligible with reason", () => {
  const r = evaluateReceiptSafety({ allowlisted: false, redacted: true, payload: { count: 1 } });
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes("not_allowlisted"));
});

test("not redacted -> ineligible", () => {
  assert.equal(evaluateReceiptSafety({ allowlisted: true, redacted: false, payload: { count: 1 } }).eligible, false);
});

test("raw prompt in payload -> ineligible (defense in depth)", () => {
  const r = evaluateReceiptSafety({ allowlisted: true, redacted: true, payload: { prompt: "x" }, reasonCodes: SAFE });
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.some((x) => x.startsWith("flag:")));
});

test("unsafe reason code -> ineligible", () => {
  const r = evaluateReceiptSafety({ allowlisted: true, redacted: true, payload: { count: 1 }, reasonCodes: ["NOT_A_SAFE_CODE"] });
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes("unsafe_reason_code"));
});
