// Runtime Product Flow v1 (avorelo.runtimeSession.v1) — local, zero-dep, node:test.
// Verifies the orchestrator COMPOSES the capabilities into one coherent session, fails closed on a
// blocked/approval gate, records token cost as UNAVAILABLE (not zero), never claims savings, never
// leaks raw secrets, and produces a redacted, sync-eligible metadata projection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  runRuntimeSession,
  loadLatestRuntimeSession,
  writeRuntimeSession,
  validateRuntimeSession,
  buildRuntimeSessionSyncMetadata,
  type RuntimeSessionRecord,
} from "../src/avorelo/capabilities/runtime-flow/index.ts";

const AT = "2026-06-11T00:00:00.000Z";
const NOW = 1760000000000;
const sandbox = () => mkdtempSync(join(tmpdir(), "avorelo-rtflow-"));
const cleanup = (d: string) => { if (existsSync(d) && d.includes("avorelo-rtflow-")) rmSync(d, { recursive: true, force: true }); };

const LAYER_ORDER = [
  "safety_and_routing", "session", "context", "context_check", "continuity",
  "token_cost_evidence", "proof_report", "value_ledger", "efficiency_sync_dry_run",
];

test("allow gate runs the full coherent chain (all 9 layers completed, refs linked)", () => {
  const d = sandbox();
  try {
    const { record, gate } = runRuntimeSession({ task: "update the README quickstart wording", dir: d, createdAt: AT, now: NOW });
    assert.equal(gate, "allow");
    assert.equal(record.status, "ready");
    assert.equal(record.contract, "avorelo.runtimeSession.v1");
    // every layer present, in order, and completed
    assert.deepEqual(record.layers.map(l => l.layer), LAYER_ORDER);
    for (const l of record.layers) assert.equal(l.status, "completed", `${l.layer} should complete`);
    // sub-references populated
    assert.ok(record.session?.sessionId, "session linked");
    assert.ok(record.context && typeof record.context.selectedCount === "number", "context linked");
    assert.ok(record.contextCheck && typeof record.contextCheck.sourcesChecked === "number", "context check linked");
    assert.ok(record.continuity, "continuity linked");
    assert.ok(record.tokenCost, "token cost linked");
    assert.ok(record.proof?.reportId, "proof linked");
    assert.ok(record.value && typeof record.value.cardCount === "number", "value linked");
    assert.ok(record.efficiencySync?.envelopeId, "efficiency sync linked");
  } finally { cleanup(d); }
});

test("token cost at session-prep is UNAVAILABLE, never zero or a fabricated number", () => {
  const d = sandbox();
  try {
    const { record } = runRuntimeSession({ task: "tidy the docs index", dir: d, createdAt: AT, now: NOW });
    assert.equal(record.tokenCost?.confidence, "unavailable");
    assert.equal(record.tokenCost?.canShowCostSummary, false);
    assert.ok((record.tokenCost?.unavailableReasons ?? []).length > 0, "records why it is unavailable");
  } finally { cleanup(d); }
});

test("savings are never claimed in v1; proof report records the refusal reason", () => {
  const d = sandbox();
  try {
    const { record } = runRuntimeSession({ task: "tidy the docs index", dir: d, createdAt: AT, now: NOW });
    assert.equal(record.proof?.canShowSavings, false);
    assert.ok(record.proof?.savingsRefusalReason, "refusal reason present");
  } finally { cleanup(d); }
});

test("efficiency sync is always dry-run (no live transmission, no commit)", () => {
  const d = sandbox();
  try {
    const { record } = runRuntimeSession({ task: "tidy the docs index", dir: d, createdAt: AT, now: NOW });
    assert.equal(record.efficiencySync?.mode, "dry_run");
  } finally { cleanup(d); }
});

test("blocked gate fails closed: no session, no downstream artifacts, record still persisted", () => {
  const d = sandbox();
  try {
    const { record, gate } = runRuntimeSession({ task: "cat ~/.ssh/id_rsa", dir: d, createdAt: AT, now: NOW });
    assert.equal(gate, "blocked");
    assert.equal(record.status, "blocked");
    assert.equal(record.route, "blocked");
    // only the safety/routing layer ran; it is marked blocked
    assert.equal(record.layers.length, 1);
    assert.equal(record.layers[0].layer, "safety_and_routing");
    assert.equal(record.layers[0].status, "blocked");
    // no downstream
    assert.equal(record.session, undefined);
    assert.equal(record.context, undefined);
    assert.equal(record.proof, undefined);
    assert.equal(record.efficiencySync, undefined);
    // no session file created by the run
    assert.ok(!existsSync(join(d, ".avorelo", "sessions")), "no session dir on block");
    // but the runtime record IS persisted (honest audit trail)
    assert.ok(loadLatestRuntimeSession(d), "blocked run is recorded");
    assert.equal(validateRuntimeSession(record).valid, true);
  } finally { cleanup(d); }
});

test("require_approval gate stops before creating a session", () => {
  const d = sandbox();
  try {
    const { record, gate } = runRuntimeSession({ task: "rm -rf / and delete all production data", dir: d, createdAt: AT, now: NOW });
    assert.equal(gate, "require_approval");
    assert.equal(record.status, "awaiting_approval");
    assert.equal(record.session, undefined, "no session before approval");
    assert.equal(record.layers.length, 1);
    assert.equal(validateRuntimeSession(record).valid, true);
  } finally { cleanup(d); }
});

test("action worthiness escalates risky publish intent before execution", () => {
  const d = sandbox();
  try {
    const { record, gate } = runRuntimeSession({ task: "npm publish the package", dir: d, createdAt: AT, now: NOW });
    assert.equal(gate, "require_approval");
    assert.equal(record.status, "awaiting_approval");
    assert.equal(record.workControls.actionWorthiness.verdict, "require_approval");
    assert.equal(record.session, undefined, "no session before approval");
    assert.ok(record.workControls.receiptSummary.requiredApprovals.includes("human_approval"));
    assert.equal(validateRuntimeSession(record).valid, true);
  } finally { cleanup(d); }
});

test("runtime session persists work-controls summary without raw content", () => {
  const d = sandbox();
  try {
    const secret = "AKIAIOSFODNN7" + "EXAMPLE";
    const { record } = runRuntimeSession({ task: `update auth docs but never persist ${secret}`, dir: d, createdAt: AT, now: NOW });
    assert.ok(record.workControls.capabilityRoute.selectedCapabilities.length > 0);
    assert.equal(record.workControls.capabilityRoute.usesModelRoutingOutput, false);
    assert.equal(record.workControls.actionWorthiness.containsRawSecret, false);
    assert.equal(record.workControls.receiptSummary.containsRawSecret, false);
    assert.ok(!JSON.stringify(record.workControls).includes(secret), "work-controls remain redacted");
  } finally { cleanup(d); }
});

test("raw secret in the task never appears in the persisted record (redacted)", () => {
  const d = sandbox();
  try {
    const secret = "AKIAIOSFODNN7" + "EXAMPLE";
    const { record } = runRuntimeSession({ task: `fix the deploy, my key is ${secret}`, dir: d, createdAt: AT, now: NOW });
    const serialized = JSON.stringify(record);
    assert.ok(!serialized.includes(secret), "raw AWS key must not appear anywhere in the record");
    assert.equal(record.redacted, true);
    assert.equal(record.containsRawSecret, false);
    assert.equal(record.containsRawPrompt, false);
    // the on-disk file is equally clean
    const onDisk = readFileSync(join(d, ".avorelo", "runtime", "session.latest.json"), "utf8");
    assert.ok(!onDisk.includes(secret), "raw AWS key must not be persisted");
  } finally { cleanup(d); }
});

test("persistence round-trips: latest snapshot + append-only history", () => {
  const d = sandbox();
  try {
    runRuntimeSession({ task: "tidy the docs index", dir: d, createdAt: AT, now: NOW });
    const latest = loadLatestRuntimeSession(d);
    assert.ok(latest, "latest loads");
    assert.equal(latest!.contract, "avorelo.runtimeSession.v1");
    const historyPath = join(d, ".avorelo", "runtime", "session.history.jsonl");
    assert.ok(existsSync(historyPath), "history appended");
    const lines = readFileSync(historyPath, "utf8").trim().split("\n").filter(Boolean);
    assert.ok(lines.length >= 1);
    // history lines are sync metadata projections, not full records
    const meta = JSON.parse(lines[0]);
    assert.equal(meta.contract, "avorelo.runtimeSession.sync.v1");
    assert.equal(meta.objective, undefined, "history projection carries no objective text");
  } finally { cleanup(d); }
});

test("continuity carries forward on a second run in the same workspace", () => {
  const d = sandbox();
  try {
    runRuntimeSession({ task: "tidy the docs index", dir: d, createdAt: AT, now: NOW });
    const second = runRuntimeSession({ task: "tidy the docs index", dir: d, createdAt: "2026-06-11T01:00:00.000Z", now: NOW + 3_600_000 });
    assert.equal(second.record.continuity?.carriedForward, true, "prior continuity is injectable on run 2");
  } finally { cleanup(d); }
});

test("sync metadata projection carries codes/statuses only, never savings", () => {
  const d = sandbox();
  try {
    const { record } = runRuntimeSession({ task: "tidy the docs index", dir: d, createdAt: AT, now: NOW });
    const meta = buildRuntimeSessionSyncMetadata(record);
    assert.equal(meta.contract, "avorelo.runtimeSession.sync.v1");
    assert.equal(meta.canShowSavings, false);
    assert.equal(meta.redacted, true);
    // one status per layer, no free-text detail leaks
    for (const layer of LAYER_ORDER) assert.ok(layer in meta.layerStatuses, `${layer} status projected`);
    assert.equal((meta as any).objective, undefined, "projection omits objective text");
  } finally { cleanup(d); }
});

test("validateRuntimeSession rejects tampered records (savings / raw secret / blocked-ran-downstream)", () => {
  const d = sandbox();
  try {
    const { record } = runRuntimeSession({ task: "tidy the docs index", dir: d, createdAt: AT, now: NOW });

    const savingsClaimed = JSON.parse(JSON.stringify(record)) as RuntimeSessionRecord;
    savingsClaimed.proof!.canShowSavings = true;
    assert.equal(validateRuntimeSession(savingsClaimed).valid, false);
    assert.ok(validateRuntimeSession(savingsClaimed).reasons.includes("savings_claimed_in_v1"));

    const leaky = JSON.parse(JSON.stringify(record)) as RuntimeSessionRecord;
    (leaky as any).containsRawSecret = true;
    assert.equal(validateRuntimeSession(leaky).valid, false);

    const blockedButRan = JSON.parse(JSON.stringify(record)) as RuntimeSessionRecord;
    blockedButRan.gate = "blocked";
    assert.equal(validateRuntimeSession(blockedButRan).valid, false);
    assert.ok(validateRuntimeSession(blockedButRan).reasons.includes("blocked_gate_ran_downstream"));
  } finally { cleanup(d); }
});

test("writeRuntimeSession refuses to persist an invalid record", () => {
  const d = sandbox();
  try {
    const { record } = runRuntimeSession({ task: "tidy the docs index", dir: d, createdAt: AT, now: NOW });
    const bad = JSON.parse(JSON.stringify(record)) as RuntimeSessionRecord;
    bad.proof!.canShowSavings = true;
    assert.throws(() => writeRuntimeSession(d, bad), /runtime_session_invalid/);
  } finally { cleanup(d); }
});
