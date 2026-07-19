// Avorelo Phase 1 Foundation tests (node:test, zero-dep). Covers evidence confidence, receipt validation,
// redaction/sync policy, SafeReference, and cloud sync eligibility. No network calls.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  makeEvidence,
  unavailableEvidence,
  isAvailable,
  asNumberOrNotAvailable,
  canClaimSavings,
} from "../src/avorelo/kernel/evidence/foundation.ts";
import {
  validateReceiptSafety,
  deriveFlags,
  clearFlags,
  hasUnsafeReasonCode,
} from "../src/avorelo/kernel/receipts/validation.ts";
import { classifyPayload, isPayloadSafe } from "../src/avorelo/shared/redaction/policy.ts";
import {
  makeSafeReference,
  isSafeReference,
  safeReferenceHasNoRawValue,
} from "../src/avorelo/shared/safe-reference/index.ts";
import { evaluateReceiptSafety } from "../src/avorelo/kernel/receipts/eligibility.ts";
import { sanitizeReceipt } from "../src/avorelo/kernel/receipts/sanitize.ts";

// --- Evidence confidence ---

test("measured evidence is accepted", () => {
  const e = makeEvidence({ evidenceId: "e", source: "deterministic_check", kind: "token_cost", confidence: "measured", evidenceRef: "ev:1", valueLabel: "1k tokens" });
  assert.equal(e.confidence, "measured");
  assert.equal(isAvailable(e), true);
});

test("imported evidence is accepted", () => {
  const e = makeEvidence({ evidenceId: "e", source: "external_import", kind: "token_cost", confidence: "imported", evidenceRef: "ev:imp", valueLabel: "imported: 2k" });
  assert.equal(e.confidence, "imported");
  assert.equal(canClaimSavings(e).allowed, true);
  assert.equal(canClaimSavings(e).mustLabel, false);
});

test("estimated evidence is accepted but labeled", () => {
  const e = makeEvidence({ evidenceId: "e", source: "tool_output", kind: "token_cost", confidence: "estimated", evidenceRef: "ev:est", valueLabel: "~3k" });
  const d = canClaimSavings(e);
  assert.equal(d.allowed, true);
  assert.equal(d.mustLabel, true, "estimated savings must stay labelled");
});

test("inferred evidence is accepted but labeled", () => {
  const e = makeEvidence({ evidenceId: "e", source: "tool_output", kind: "time", confidence: "inferred", evidenceRef: "ev:inf", valueLabel: "~2min" });
  const d = canClaimSavings(e);
  assert.equal(d.allowed, true);
  assert.equal(d.mustLabel, true);
});

test("unavailable evidence is accepted and does not become zero/pass", () => {
  const e = unavailableEvidence("token_cost", "no_meter");
  assert.equal(e.confidence, "unavailable");
  assert.equal(e.evidenceRef, null, "unavailable carries no ref");
  assert.equal(e.valueLabel, null, "unavailable carries no value");
  assert.equal(asNumberOrNotAvailable(e, null), "not_available");
  // even if a caller hands a number, an unavailable entry never reports it as a real measurement
  assert.equal(asNumberOrNotAvailable(e, 0), "not_available");
});

test("savings cannot be claimed from unavailable evidence", () => {
  const e = unavailableEvidence("token_cost", "no_meter");
  const d = canClaimSavings(e);
  assert.equal(d.allowed, false);
  assert.ok(d.reasonCodes.includes("no_savings_from_unavailable_evidence"));
});

test("savings require an evidence ref even when available", () => {
  const e = makeEvidence({ evidenceId: "e", source: "deterministic_check", kind: "token_cost", confidence: "measured" });
  assert.equal(canClaimSavings(e).allowed, false, "no ref ⇒ no claim");
});

// --- Receipt validation ---

const SAFE = ["STOP_DONE"];

test("valid redacted receipt passes cloud eligibility", () => {
  const r = validateReceiptSafety({ schemaName: "s", schemaVersion: "1", redacted: true, flags: clearFlags(), reasonCodes: SAFE });
  assert.equal(r.cloudEligible, true);
});

for (const [name, payload, flag] of [
  ["rawPrompt", { prompt: "raw prompt" }, "containsRawPrompt"],
  ["rawTranscript", { transcript: "raw transcript" }, "containsRawTranscript"],
  ["rawSecret", { note: "AKIA1234567" + "890ABCD99" }, "containsRawSecret"],
  ["envValue", { config: "API_TOKEN=supersecretvalue" }, "containsEnvValue"],
  ["terminalLog", { log: "[31mERROR[0m boom" }, "containsTerminalLog"],
  ["gitDiff", { d: "diff --git a/f b/f\n+++ b/f" }, "containsGitDiff"],
  ["sourceDump", { rawSource: "function x(){ return 1 }" }, "containsRawSource"],
  ["sensitivePath", { p: "/Users/benja/.ssh/id_rsa" }, "containsSensitiveFilePath"],
] as [string, Record<string, unknown>, string][]) {
  test(`receipt with ${name} flag fails cloud eligibility`, () => {
    const r = validateReceiptSafety({ schemaName: "s", schemaVersion: "1", redacted: true, payload, reasonCodes: SAFE });
    assert.equal(r.cloudEligible, false, `${name} must be ineligible`);
    assert.equal((r.meta.flags as Record<string, boolean>)[flag], true, `${flag} must be set`);
  });
}

test("receipt with unsafe reason code fails cloud eligibility", () => {
  const r = validateReceiptSafety({ schemaName: "s", schemaVersion: "1", redacted: true, flags: clearFlags(), reasonCodes: ["TOTALLY_UNVETTED_CODE"] });
  assert.equal(r.cloudEligible, false);
  assert.ok(r.reasons.includes("unsafe_reason_code"));
  assert.equal(hasUnsafeReasonCode(["TOTALLY_UNVETTED_CODE"]), true);
});

test("unredacted receipt is never cloud eligible", () => {
  const r = validateReceiptSafety({ schemaName: "s", schemaVersion: "1", redacted: false, flags: clearFlags(), reasonCodes: SAFE });
  assert.equal(r.cloudEligible, false);
});

// --- Redaction / sync policy ---

test("allowlisted metadata-only payload passes", () => {
  assert.equal(isPayloadSafe({ receiptId: "r", decision: "STOP_DONE", count: 3, status: "done", reasonCodes: SAFE, timestamp: 123 }), true);
});

test("payload with prompt text fails", () => {
  assert.equal(isPayloadSafe({ prompt: "do the thing" }), false);
});

test("payload with terminal log fails", () => {
  assert.equal(classifyPayload({ stdout: "[32mok[0m" }).safe, false);
});

test("payload with git diff fails", () => {
  assert.equal(classifyPayload({ blob: "diff --git a/a b/b" }).safe, false);
});

test("payload with env value fails", () => {
  assert.equal(classifyPayload({ blob: "SECRET_KEY=abc123def" }).safe, false);
});

test("payload with raw secret marker fails", () => {
  const c = classifyPayload({ blob: "token ghp_aaaaaa" + "aaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  assert.equal(c.safe, false);
  assert.ok(c.violations.some((v) => v.startsWith("raw_secret")));
});

test("payload with safe reference passes", () => {
  const ref = makeSafeReference({ id: "s", sourceKind: "env", label: "secret ref", riskClass: "credential" });
  assert.equal(isPayloadSafe({ decision: "STOP_BLOCKED", safeRef: ref }), true);
});

// --- SafeReference ---

test("constructing a safe reference with allowed fields passes", () => {
  const ref = makeSafeReference({ id: "s", sourceKind: "file", label: ".env path", riskClass: "sensitive" });
  assert.equal(isSafeReference(ref), true);
  assert.equal(ref.valueExposedToModel, false);
  assert.equal(ref.rawValuePersisted, false);
});

test("rawValue is impossible / stripped", () => {
  const ref = makeSafeReference({ id: "s", sourceKind: "env", label: "pw", riskClass: "credential", rawValue: "hunter2", value: "hunter2" } as never);
  assert.equal((ref as Record<string, unknown>).rawValue, undefined);
  assert.equal((ref as Record<string, unknown>).value, undefined);
  assert.ok(ref.safeReasonCodes.includes("raw_value_stripped"));
  assert.equal(JSON.stringify(ref).includes("hunter2"), false);
});

test("valueExposedToModel cannot be true", () => {
  const ref = makeSafeReference({ id: "s", sourceKind: "env", label: "x", riskClass: "unknown", valueExposedToModel: true } as never);
  assert.equal(ref.valueExposedToModel, false);
});

test("rawValuePersisted cannot be true", () => {
  const ref = makeSafeReference({ id: "s", sourceKind: "env", label: "x", riskClass: "unknown", rawValuePersisted: true } as never);
  assert.equal(ref.rawValuePersisted, false);
});

test("serialized safe reference does not contain secret-like value fields", () => {
  const ref = makeSafeReference({ id: "s", sourceKind: "env", label: "x", riskClass: "credential" });
  assert.equal(safeReferenceHasNoRawValue(ref), true);
});

// --- Cloud sync ---

test("dry-run payload is metadata-only (sanitize keeps no raw fields)", () => {
  const sanitized = sanitizeReceipt({ receiptId: "r1", contractId: "cli_x", decision: "STOP_DONE", reasonCodes: ["STOP_DONE"], graded: [{ artifactId: "a", level: "OUTCOME", ref: "ev:1" }], sampleSize: 1 });
  const json = JSON.stringify(sanitized);
  assert.equal(json.includes("prompt"), false);
  assert.equal(json.includes("transcript"), false);
  assert.equal(sanitized.localReceiptId, "r1");
});

test("eligibility rejects unsafe payload and is allowlist-only", () => {
  assert.equal(evaluateReceiptSafety({ allowlisted: false, redacted: true, payload: { count: 1 } }).eligible, false);
  assert.equal(evaluateReceiptSafety({ allowlisted: true, redacted: true, payload: { prompt: "x" }, reasonCodes: SAFE }).eligible, false);
  assert.equal(evaluateReceiptSafety({ allowlisted: true, redacted: true, payload: { count: 1, decision: "STOP_DONE" }, reasonCodes: SAFE }).eligible, true);
});

test("deriveFlags maps detected violations to safety flags", () => {
  const flags = deriveFlags({ prompt: "p", note: "AKIA1234567" + "890ABCD99" });
  assert.equal(flags.containsRawPrompt, true);
  assert.equal(flags.containsRawSecret, true);
  assert.equal(flags.containsGitDiff, false);
});

