// Avorelo Slice-3 tests (Local Receipts + Dashboard). Zero-dep, node:test. Synthetic + sandboxed, local-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { StateLedger } from "../src/avorelo/kernel/state-ledger/index.ts";
import { writeReceipt, persistReceipt, listReceipts, readReceipt, localReceiptDir } from "../src/avorelo/kernel/receipts/index.ts";
import { buildLocalDashboard, toCard, renderHtml, renderText, open, DEFAULT_STALE_WINDOW_MS } from "../src/avorelo/capabilities/local-dashboard/index.ts";
import { OwnershipRegistry } from "../src/avorelo/kernel/registry/index.ts";
import type { GradedEvidence, GateDecision, DecisionBasis } from "../src/avorelo/shared/schemas/index.ts";

const basis: DecisionBasis = { method: "deterministic", confidence: "HIGH", evidenceRefs: [], reasonCodes: ["TEST"], fallbackUsed: false };

function seed(dir: string, opts: { id: string; decision: GateDecision; graded: GradedEvidence[]; next?: string[]; writtenAt?: number; classes?: string[] }) {
  const ledger = new StateLedger();
  const r = writeReceipt(ledger, {
    contractId: opts.id, decision: opts.decision, graded: opts.graded,
    safeNextActions: opts.next ?? [], decisionBasis: basis, sampleSize: 1,
    redactionClasses: opts.classes, receiptId: `rcpt_${opts.id}`, writtenAt: opts.writtenAt,
  });
  return persistReceipt(dir, r);
}

const NOW = 1_900_000_000_000; // fixed deterministic clock
const sandbox = () => { const d = mkdtempSync(join(tmpdir(), "avorelo-slice3-")); mkdirSync(join(d, ".avorelo"), { recursive: true }); return d; };
const cleanup = (d: string) => { if (existsSync(d) && d.includes("avorelo-slice3-")) rmSync(d, { recursive: true, force: true }); };

const READY = [{ artifactId: "a1", level: "OUTCOME" as const, ref: "ev:row" }, { artifactId: "a2", level: "POST_ACTION" as const, ref: "ev:confirm" }];
const FAKE = [{ artifactId: "a1", level: "NAVIGATION" as const, ref: "ev:200" }, { artifactId: "a2", level: "INTERACTION" as const, ref: "ev:submit" }];

test("receipts store — persist/list/read round-trips; writtenAt persisted; reads from .avorelo/receipts only", () => {
  const d = sandbox();
  try {
    seed(d, { id: "x", decision: "STOP_DONE", graded: READY, writtenAt: NOW });
    assert.ok(localReceiptDir(d).endsWith(join(".avorelo", "receipts")));
    const all = listReceipts(d);
    assert.equal(all.length, 1);
    assert.equal(all[0].writtenAt, NOW);
    assert.equal(readReceipt(d, "rcpt_x")?.contractId, "x");
    assert.equal(readReceipt(d, "missing"), null);
  } finally { cleanup(d); }
});

test("listReceipts skips foreign/corrupt files (fail-open on one bad file)", () => {
  const d = sandbox();
  try {
    seed(d, { id: "good", decision: "STOP_DONE", graded: READY, writtenAt: NOW });
    writeFileSync(join(localReceiptDir(d), "corrupt.json"), "{ not json");
    writeFileSync(join(localReceiptDir(d), "foreign.json"), JSON.stringify({ hello: "world" })); // not a receipt
    writeFileSync(join(localReceiptDir(d), "notes.txt"), "ignored");
    const all = listReceipts(d);
    assert.equal(all.length, 1); // only the good receipt; corrupt/foreign/non-json skipped
    assert.equal(all[0].contractId, "good");
  } finally { cleanup(d); }
});

test("receipt without writtenAt is surfaced as unknown-age (not implied fresh, not stale)", () => {
  const d = sandbox();
  try {
    // craft a receipt file lacking writtenAt (e.g. written before Slice 3)
    const legacy = {
      receiptId: "rcpt_legacy", contractId: "legacy", decision: "STOP_DONE",
      evidenceLevels: ["OUTCOME", "POST_ACTION"], evidenceRefs: ["ev:row", "ev:confirm"],
      safeNextActions: [], decisionBasis: basis, redactionClasses: [], receiptDigest: "deadbeef", sampleSize: 1, redaction: "applied",
    };
    mkdirSync(localReceiptDir(d), { recursive: true });
    writeFileSync(join(localReceiptDir(d), "rcpt_legacy.json"), JSON.stringify(legacy));
    const m = buildLocalDashboard(d, { now: NOW });
    const c = m.cards.find((x) => x.contractId === "legacy")!;
    assert.equal(c.ageMs, null);
    assert.equal(c.stale, false); // cannot prove stale without a timestamp
    assert.equal(m.totals.unknownAge, 1);
  } finally { cleanup(d); }
});

test("fake READY is NEVER shown as done; complete READY IS done (truthful)", () => {
  const d = sandbox();
  try {
    seed(d, { id: "complete", decision: "STOP_DONE", graded: READY, writtenAt: NOW });
    seed(d, { id: "fake", decision: "CONTINUE", graded: FAKE, writtenAt: NOW });
    const m = buildLocalDashboard(d, { now: NOW });
    const complete = m.cards.find((c) => c.contractId === "complete")!;
    const fake = m.cards.find((c) => c.contractId === "fake")!;
    assert.equal(complete.kind, "done");
    assert.equal(complete.ready, true);
    assert.equal(fake.kind, "in_progress"); // fake-ready is CONTINUE -> never "done"
    assert.equal(fake.ready, false);
    assert.equal(m.totals.done, 1);
  } finally { cleanup(d); }
});

test("STOP_DONE without OUTCOME+POST_ACTION is downgraded to needs_attention (never trust the label)", () => {
  // defensive: even if a STOP_DONE receipt lacks full evidence, the card must not read as done
  const card = toCard({
    receiptId: "r", contractId: "c", decision: "STOP_DONE", evidenceLevels: ["NAVIGATION"], evidenceRefs: ["ev"],
    safeNextActions: [], decisionBasis: basis, redactionClasses: [], receiptDigest: "abc", sampleSize: 1, writtenAt: NOW, redaction: "applied",
  }, { now: NOW, staleWindowMs: DEFAULT_STALE_WINDOW_MS });
  assert.equal(card.ready, false);
  assert.equal(card.kind, "needs_attention");
});

test("blocked receipt surfaces as blocked card with its safeNextActions", () => {
  const d = sandbox();
  try {
    seed(d, { id: "blk", decision: "STOP_BLOCKED", graded: [], next: ["re-run avorelo doctor; fix hook install"], writtenAt: NOW });
    const m = buildLocalDashboard(d, { now: NOW });
    const c = m.cards.find((x) => x.contractId === "blk")!;
    assert.equal(c.kind, "blocked");
    assert.deepEqual(c.safeNextActions, ["re-run avorelo doctor; fix hook install"]);
    assert.equal(m.totals.blocked, 1);
  } finally { cleanup(d); }
});

test("stale detection — old receipt flagged stale/needs-attention; fresh one is not; unknown age surfaced honestly", () => {
  const d = sandbox();
  try {
    const win = DEFAULT_STALE_WINDOW_MS;
    seed(d, { id: "fresh", decision: "STOP_DONE", graded: READY, writtenAt: NOW - 1000 });
    seed(d, { id: "old", decision: "STOP_DONE", graded: READY, writtenAt: NOW - win - 1000 });
    const m = buildLocalDashboard(d, { now: NOW });
    const fresh = m.cards.find((c) => c.contractId === "fresh")!;
    const old = m.cards.find((c) => c.contractId === "old")!;
    assert.equal(fresh.stale, false);
    assert.equal(fresh.kind, "done");
    assert.equal(old.stale, true);
    assert.equal(old.kind, "needs_attention"); // a stale "done" becomes needs-attention
    assert.equal(m.totals.stale >= 1, true);
  } finally { cleanup(d); }
});

test("no raw secret/prompt/source in the model or rendered HTML/JSON (classes only)", () => {
  const d = sandbox();
  try {
    // classes are derived labels; the receipt never holds raw values, but assert defensively end-to-end
    seed(d, { id: "sec", decision: "STOP_BLOCKED", graded: [], next: ["secret blocked"], classes: ["aws_access_key", "key:prompt"], writtenAt: NOW });
    const m = buildLocalDashboard(d, { now: NOW });
    const html = renderHtml(m);
    const text = renderText(m);
    const json = JSON.stringify(m);
    for (const out of [html, text, json]) {
      assert.ok(!out.includes("AKIA1234567" + "890ABCD99"), "raw secret leaked");
      assert.ok(!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(out), "raw private key leaked");
    }
    // the class label IS allowed to appear (it is not a secret value)
    assert.ok(html.includes("aws_access_key"));
  } finally { cleanup(d); }
});

test("open() writes a local HTML file; no network/login; deterministic given now", () => {
  const d = sandbox();
  try {
    seed(d, { id: "c1", decision: "STOP_DONE", graded: READY, writtenAt: NOW });
    const r = open(d, { now: NOW });
    assert.equal(r.ok, true);
    assert.ok(r.htmlPath.endsWith(join(".avorelo", "dashboard", "index.html")));
    assert.ok(existsSync(r.htmlPath));
    const html = readFileSync(r.htmlPath, "utf8");
    assert.ok(html.length > 200);
    assert.ok(html.includes("local-first") || html.includes("no network"));
    assert.ok(html.includes("c1"));
  } finally { cleanup(d); }
});

test("empty store renders an empty-but-valid dashboard (no crash, totals all zero)", () => {
  const d = sandbox();
  try {
    const m = buildLocalDashboard(d, { now: NOW });
    assert.equal(m.totals.total, 0);
    assert.ok(renderHtml(m).includes("0 receipts"));
  } finally { cleanup(d); }
});

test("THE ONE RULE — local-dashboard may not own receipts/evidence/policy truth (capability-collision)", () => {
  const reg = new OwnershipRegistry();
  reg.register("receipts", "kernel/receipts");
  reg.register("evidence", "kernel/evidence");
  reg.register("policy", "kernel/policy");
  // the dashboard registering itself as an owner of any truth concern must throw
  assert.throws(() => reg.register("receipts", "capabilities/local-dashboard"), /CAPABILITY_COLLISION/);
  assert.throws(() => reg.register("evidence", "capabilities/local-dashboard"), /CAPABILITY_COLLISION/);
  assert.throws(() => reg.register("policy", "capabilities/local-dashboard"), /CAPABILITY_COLLISION/);
});
