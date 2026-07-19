// Avorelo Slice-4 tests (Production Confidence / Real Workflow Proof). Zero-dep, node:test.
// Deterministic; read-backs run against a REAL throwaway filesystem. Synthetic, local-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { gradeAll, isReadyEligible } from "../src/avorelo/kernel/evidence/index.ts";
import { decide } from "../src/avorelo/kernel/stop-continue-gate/index.ts";
import { evaluateProof, readBack, checkEnvironmentIntegrity } from "../src/avorelo/capabilities/production-confidence/index.ts";
import { toCard } from "../src/avorelo/capabilities/local-dashboard/index.ts";
import { createWorkContract } from "../src/avorelo/kernel/work-contract/index.ts";
import { OwnershipRegistry } from "../src/avorelo/kernel/registry/index.ts";
import type { EvidenceArtifact } from "../src/avorelo/shared/schemas/index.ts";

const sandbox = () => { const d = mkdtempSync(join(tmpdir(), "avorelo-slice4-")); mkdirSync(join(d, "src"), { recursive: true }); return d; };
const cleanup = (d: string) => { if (existsSync(d) && d.includes("avorelo-slice4-")) rmSync(d, { recursive: true, force: true }); };
const ctr = (dir: string) => createWorkContract({ contractId: "p", objective: "proof", allowedPaths: [join(dir, "src")], planTier: "Free" });
const a = (kind: EvidenceArtifact["kind"], id = kind): EvidenceArtifact => ({ artifactId: id, kind, ref: `ev:${id}` });

test("no-404 / redirect / test-pass / screenshot / user-confirm can NEVER mark done (capped below OUTCOME)", () => {
  for (const kind of ["http_status_ok", "redirect", "test_passed", "screenshot", "user_confirmed"] as const) {
    const graded = gradeAll([a(kind)]);
    assert.equal(isReadyEligible(graded), false, `${kind} should not be ready-eligible`);
    const g = decide({ contract: ctr("/work"), graded, policyVerdict: "allow" });
    assert.equal(g.decision, "CONTINUE", `${kind} alone must CONTINUE, not done`);
  }
});

test("even test_passed + screenshot + user_confirmed TOGETHER cannot mark done (no OUTCOME)", () => {
  const graded = gradeAll([a("test_passed"), a("screenshot"), a("user_confirmed")]);
  assert.equal(isReadyEligible(graded), false);
  assert.equal(decide({ contract: ctr("/work"), graded, policyVerdict: "allow" }).decision, "CONTINUE");
});

test("source-of-truth read-back of REAL persisted state grades OUTCOME; mismatch/missing does not", () => {
  const d = sandbox();
  try {
    writeFileSync(join(d, "src", "out.txt"), "expected-value\n");
    const ok = readBack(d, { kind: "file_equals", path: "src/out.txt", expected: "expected-value" });
    assert.equal(ok.passed, true);
    assert.equal(ok.artifact?.kind, "source_of_truth_readback");
    assert.equal(gradeAll([ok.artifact!])[0].level, "OUTCOME");

    const wrong = readBack(d, { kind: "file_equals", path: "src/out.txt", expected: "WRONG" });
    assert.equal(wrong.passed, false);
    assert.equal(wrong.artifact, null); // the fake is caught — no OUTCOME upgrade

    const missing = readBack(d, { kind: "file_equals", path: "src/nope.txt", expected: "x" });
    assert.equal(missing.passed, false);
    assert.equal(missing.reasonCode, "READBACK_FILE_MISSING");
  } finally { cleanup(d); }
});

test("complete proof (source read-back OUTCOME + aftermath POST_ACTION), clean env -> STOP_DONE", () => {
  const d = sandbox();
  try {
    writeFileSync(join(d, "src", "row.txt"), "persisted\n");
    const r = evaluateProof({
      contract: ctr(d), dir: d,
      readbacks: [{ kind: "file_equals", path: "src/row.txt", expected: "persisted" }],
      artifacts: [a("aftermath_correct")],
      environment: { worktreeDirty: false }, persist: false,
    });
    assert.equal(r.decision, "STOP_DONE");
    assert.ok(r.receipt.evidenceLevels.includes("OUTCOME"));
    assert.ok(r.receipt.evidenceLevels.includes("POST_ACTION"));
  } finally { cleanup(d); }
});

test("outcome WITHOUT post-action continues (post-action mandatory for READY)", () => {
  const d = sandbox();
  try {
    writeFileSync(join(d, "src", "row.txt"), "persisted\n");
    const r = evaluateProof({
      contract: ctr(d), dir: d,
      readbacks: [{ kind: "file_equals", path: "src/row.txt", expected: "persisted" }],
      environment: { worktreeDirty: false }, persist: false,
    });
    assert.equal(r.decision, "CONTINUE");
  } finally { cleanup(d); }
});

test("dirty worktree -> NEVER done even with complete evidence (ENVIRONMENT_COMPROMISED)", () => {
  const d = sandbox();
  try {
    writeFileSync(join(d, "src", "row.txt"), "persisted\n");
    const r = evaluateProof({
      contract: ctr(d), dir: d,
      readbacks: [{ kind: "file_equals", path: "src/row.txt", expected: "persisted" }],
      artifacts: [a("aftermath_correct")],
      environment: { worktreeDirty: true },
      persist: false,
    });
    assert.notEqual(r.decision, "STOP_DONE");
    assert.ok(r.reasonCodes.includes("ENVIRONMENT_COMPROMISED"));
    assert.ok(r.reasonCodes.includes("WORKTREE_DIRTY"));
    assert.ok(r.receipt.safeNextActions.join(" ").includes("clean environment"));
  } finally { cleanup(d); }
});

test("stale process signal also compromises the environment", () => {
  const env = checkEnvironmentIntegrity("/work", { staleProcess: true });
  assert.equal(env.compromised, true);
  assert.ok(env.reasonCodes.includes("STALE_PROCESS"));
});

test("fake READY: declaring done with only NAV/INT signals cannot self-declare done", () => {
  const d = sandbox();
  try {
    const r = evaluateProof({
      contract: ctr(d), dir: d,
      artifacts: [a("http_status_ok"), a("test_passed"), a("screenshot")],
      environment: { worktreeDirty: false }, persist: false,
    });
    assert.equal(r.decision, "CONTINUE");
  } finally { cleanup(d); }
});

test("no raw secret/prompt/source in the proof receipt (classes only)", () => {
  const d = sandbox();
  try {
    const r = evaluateProof({
      contract: ctr(d), dir: d,
      artifacts: [{ artifactId: "x", kind: "user_confirmed", ref: "ev:AKIA1234567" + "890ABCD99" }],
      environment: { worktreeDirty: false }, persist: false,
    });
    assert.ok(!JSON.stringify(r.receipt).includes("AKIA1234567" + "890ABCD99"));
  } finally { cleanup(d); }
});

test("dashboard surfaces a compromised-environment proof as needs_attention (truthful, not in_progress)", () => {
  const now = 1_900_000_000_000;
  const compromised = {
    receiptId: "r", contractId: "c", decision: "CONTINUE" as const, evidenceLevels: ["OUTCOME", "POST_ACTION"] as ("OUTCOME" | "POST_ACTION")[],
    evidenceRefs: ["ev"], safeNextActions: ["restore a clean environment"],
    decisionBasis: { method: "deterministic" as const, confidence: "UNKNOWN" as const, evidenceRefs: [], reasonCodes: ["ENVIRONMENT_COMPROMISED", "WORKTREE_DIRTY"], fallbackUsed: false },
    redactionClasses: [], receiptDigest: "abc", sampleSize: 1, writtenAt: now, redaction: "applied" as const,
  };
  const card = toCard(compromised, { now, staleWindowMs: 1_000_000 });
  assert.equal(card.kind, "needs_attention");
});

test("THE ONE RULE — production-confidence may not own evidence/gate/receipts truth", () => {
  const reg = new OwnershipRegistry();
  reg.register("evidence", "kernel/evidence");
  reg.register("stop-continue-gate", "kernel/stop-continue-gate");
  reg.register("receipts", "kernel/receipts");
  assert.throws(() => reg.register("evidence", "capabilities/production-confidence"), /CAPABILITY_COLLISION/);
  assert.throws(() => reg.register("stop-continue-gate", "capabilities/production-confidence"), /CAPABILITY_COLLISION/);
  assert.throws(() => reg.register("receipts", "capabilities/production-confidence"), /CAPABILITY_COLLISION/);
});
