// Avorelo Slice-1 tests (node:test, zero-dep). Required tests + hardening (ledger deep-hash, allowlist persistence).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { runSlice1 } from "../src/avorelo/kernel/run.ts";
import { createWorkContract } from "../src/avorelo/kernel/work-contract/index.ts";
import { StateLedger, replayFold, stableStringify } from "../src/avorelo/kernel/state-ledger/index.ts";
import { OwnershipRegistry, buildKernelRegistry } from "../src/avorelo/kernel/registry/index.ts";
import { redact } from "../src/avorelo/shared/redaction/index.ts";
import type { EvidenceArtifact } from "../src/avorelo/shared/schemas/index.ts";

const C = (id: string) => createWorkContract({ contractId: id, objective: `t ${id}`, planTier: "Free" });
const RAW_SECRET = "AKIA1234567" + "890ABCD99";
const RAW_PROMPT = "this is a raw user prompt that must never be persisted anywhere";

test("1. fake READY blocked — NAV/INT only is never STOP_DONE (kills no-404=proof)", () => {
  const r = runSlice1({
    contract: C("fake"),
    artifacts: [
      { artifactId: "a1", kind: "http_status_ok", ref: "ev:200" },
      { artifactId: "a2", kind: "ui_action_accepted", ref: "ev:submit" },
    ] as EvidenceArtifact[],
    receiptId: "rcpt_fake",
  });
  assert.notEqual(r.gate.decision, "STOP_DONE");
  assert.equal(r.gate.decision, "CONTINUE");
});

test("1b. redirect alone is INTERACTION, never POST_ACTION (kills redirect=payment)", () => {
  const r = runSlice1({
    contract: C("redir"),
    artifacts: [{ artifactId: "a1", kind: "redirect", ref: "ev:302" }] as EvidenceArtifact[],
    receiptId: "rcpt_redir",
  });
  assert.notEqual(r.gate.decision, "STOP_DONE");
  assert.deepEqual(r.receipt.evidenceLevels, ["INTERACTION"]);
});

test("2. complete READY accepted — OUTCOME + POST_ACTION -> STOP_DONE (n=1 LOW confidence)", () => {
  const r = runSlice1({
    contract: C("complete"),
    artifacts: [
      { artifactId: "a1", kind: "persisted_state_change", ref: "ev:row" },
      { artifactId: "a2", kind: "aftermath_correct", ref: "ev:confirm" },
    ] as EvidenceArtifact[],
    receiptId: "rcpt_complete",
  });
  assert.equal(r.gate.decision, "STOP_DONE");
  assert.equal(r.receipt.decisionBasis.confidence, "LOW");
});

test("3. insufficient evidence continues — OUTCOME without POST_ACTION is not READY", () => {
  const r = runSlice1({
    contract: C("insuf"),
    artifacts: [{ artifactId: "a1", kind: "persisted_state_change", ref: "ev:row" }] as EvidenceArtifact[],
    receiptId: "rcpt_insuf",
  });
  assert.equal(r.gate.decision, "CONTINUE");
  assert.ok(r.gate.safeNextActions.join(" ").includes("POST_ACTION"));
});

test("4. secret blocked + only DERIVED classes persisted (no raw secret/prompt in receipt or ledger)", () => {
  const r = runSlice1({
    contract: C("secret"),
    artifacts: [{ artifactId: "a1", kind: "http_status_ok", ref: "ev:200" }] as EvidenceArtifact[],
    content: { finding: `key ${RAW_SECRET}`, prompt: RAW_PROMPT },
    receiptId: "rcpt_secret",
  });
  assert.equal(r.gate.decision, "STOP_BLOCKED");
  assert.ok(r.gate.reasonCodes.includes("SECRET_DETECTED"));
  // derived classes recorded, raw values absent
  assert.ok(r.receipt.redactionClasses.includes("aws_access_key"));
  assert.ok(r.receipt.redactionClasses.includes("key:prompt"));
  const blob = JSON.stringify(r.receipt) + JSON.stringify(r.ledger.all());
  assert.ok(!blob.includes(RAW_SECRET), "raw secret leaked");
  assert.ok(!blob.includes(RAW_PROMPT), "raw prompt leaked");
});

test("4b. allowlist persistence — raw text under key `prompt` is never persisted", () => {
  const r = runSlice1({ contract: C("p1"), artifacts: [], content: { prompt: RAW_PROMPT }, receiptId: "rcpt_p1" });
  const blob = JSON.stringify(r.receipt) + JSON.stringify(r.ledger.all());
  assert.ok(!blob.includes(RAW_PROMPT));
});

test("4c. allowlist persistence — raw text under ARBITRARY key `note` is never persisted", () => {
  const note = `arbitrary key carrying ${RAW_PROMPT}`;
  const r = runSlice1({ contract: C("n1"), artifacts: [], content: { note }, receiptId: "rcpt_n1" });
  const blob = JSON.stringify(r.receipt) + JSON.stringify(r.ledger.all());
  assert.ok(!blob.includes(RAW_PROMPT), "arbitrary-key content leaked");
  assert.ok(!blob.includes("arbitrary key carrying"), "arbitrary candidate content leaked");
  // ledger payload must be the allowlisted receipt only — no `context`/`candidate` keys
  assert.ok(!JSON.stringify(r.ledger.all()).includes("candidate"));
});

test("4d. secret under ARBITRARY key is detected (class) but value never persisted", () => {
  const r = runSlice1({ contract: C("s2"), artifacts: [], content: { weird_field: `x ${RAW_SECRET} y` }, receiptId: "rcpt_s2" });
  assert.ok(r.receipt.redactionClasses.includes("aws_access_key"));
  assert.ok(!(JSON.stringify(r.receipt) + JSON.stringify(r.ledger.all())).includes(RAW_SECRET));
});

test("4e. redaction unit — detects classes, emits no raw value", () => {
  const { value, hits } = redact({ a: "ghp_abcdef" + "ghijklmnopqrstuvwxyz012345", prompt: "x" });
  assert.ok(hits.includes("github_token"));
  assert.ok(hits.includes("key:prompt"));
  assert.ok(!JSON.stringify(value).includes("ghp_abcdef" + "ghijklmnopqrstuvwxyz012345"));
});

test("5. ledger writes a deterministic, well-formed, chained event", () => {
  const l = new StateLedger();
  const e = l.append({ type: "test.event", contractId: "c1", payload: { ok: true }, ts: 123 });
  assert.equal(e.seq, 0);
  assert.equal(e.prevHash, "GENESIS");
  assert.equal(e.redacted, true);
  assert.match(e.eventHash, /^[0-9a-f]{64}$/);
  assert.equal(l.verifyChain(), true);
});

test("5b. hash covers NESTED payload — chain verifies with deep nesting", () => {
  const l = new StateLedger();
  l.append({ type: "t", contractId: "c", payload: { a: { b: { c: [1, 2, { d: "x" }] } } }, ts: 1 });
  l.append({ type: "t", contractId: "c", payload: { nested: { deep: { value: 42 } } }, ts: 2 });
  assert.equal(l.verifyChain(), true);
});

test("5c. mutating a NESTED payload field breaks verifyChain (tamper-evident)", () => {
  const l = new StateLedger();
  const e = l.append({ type: "t", contractId: "c", payload: { nested: { v: 1 } }, ts: 1 });
  // tamper the stored event's nested payload
  (e.payload as any).nested.v = 999;
  assert.equal(l.verifyChain(), false);
});

test("5d. deterministic hash is stable across equivalent key ordering", () => {
  assert.equal(stableStringify({ a: 1, b: { x: 1, y: 2 } }), stableStringify({ b: { y: 2, x: 1 }, a: 1 }));
});

test("6. deterministic replay — same input -> same decision; re-fold identical", () => {
  const mk = () =>
    runSlice1({
      contract: C("replay"),
      artifacts: [
        { artifactId: "a1", kind: "persisted_state_change", ref: "ev:row" },
        { artifactId: "a2", kind: "aftermath_correct", ref: "ev:confirm" },
      ] as EvidenceArtifact[],
      receiptId: "rcpt_replay",
    });
  const r1 = mk();
  const r2 = mk();
  assert.equal(r1.gate.decision, r2.gate.decision);
  assert.deepEqual(r1.gate.reasonCodes, r2.gate.reasonCodes);
  assert.equal(r1.receipt.receiptDigest, r2.receipt.receiptDigest);
  const reducer = (n: number) => n + 1;
  assert.equal(replayFold(r1.ledger.all(), reducer, 0), replayFold(r1.ledger.all(), reducer, 0));
});

test("7. capability-collision — a concern cannot have two owners (THE ONE RULE / S5)", () => {
  const reg = new OwnershipRegistry();
  reg.register("evidence", "kernel/evidence");
  reg.register("evidence", "kernel/evidence");
  assert.throws(() => reg.register("evidence", "some/other"), /CAPABILITY_COLLISION/);
  assert.doesNotThrow(() => buildKernelRegistry());
});

test("8. naming invariant — no wuz/cco/claudecode-optimizer in src/avorelo runtime code", () => {
  const root = join(process.cwd(), "src", "avorelo");
  const legacy = /\b(wuz|cco|claudecode-optimizer)\b/i;
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((n) => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|js|json)$/.test(n) ? [p] : [];
    });
  const offenders = walk(root).filter((f) => legacy.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, [], `legacy naming found in: ${offenders.join(", ")}`);
});
