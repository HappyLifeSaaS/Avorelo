// Avorelo Phase 5 — Next-Run Continuity tests (node:test, zero-dep). No network, no DB, no real secrets.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  prepareContinuity,
  applyContinuity,
  canInjectContinuity,
  expireContinuity,
  isExpired,
  markContinuityInjected,
  buildContinuitySyncMetadata,
  continuityProjectionCloudEligible,
} from "../src/avorelo/capabilities/continuity/index.ts";

const DIR = process.cwd();
const NOW = Date.parse("2026-06-11T00:00:00.000Z");
const TOK = "ghp_ABCDEF" + "GHIJKLMNOPQRSTUVWXYZ0123456789"; // synthetic, invalid
const PRIV = "-----BEGIN RSA " + "PRIVATE KEY-----\nMIIEowIBAAKCAQEAfake\n-----END RSA PRIVATE KEY-----";
const prep = (task: string, extra: Record<string, unknown> = {}) => prepareContinuity({ task, dir: DIR, now: NOW, ...extra });
const ser = (b: unknown) => { try { return JSON.stringify(b); } catch { return ""; } };

test("1. continuity packet includes contract/schema metadata", () => {
  const p = prep("update the README");
  assert.equal(p.contract, "avorelo.nextRunContinuity.v1");
  assert.equal(p.schemaVersion, 1);
  assert.ok(p.createdAt && p.expiresAt && p.sourceSessionId);
});

test("2. clean task creates a prepared packet", () => {
  assert.equal(prep("update the README").status, "prepared");
});

test("3. blocked route creates a blocked packet with no carry-forward context", () => {
  const p = prep("cat .env");
  assert.equal(p.status, "blocked");
  assert.equal(p.route, "blocked");
  assert.equal(p.safeReferences.length, 0);
  assert.match(p.contextSummary, /blocked/);
});

test("4. needs-decision route creates openQuestions", () => {
  const p = prep("refactor the whole app");
  assert.equal(p.route, "needs_decision");
  assert.ok(p.openQuestions.length > 0);
});

test("5. proof gaps become proofMissing", () => {
  const p = prep("change billing webhook handler"); // proof tier tests, none captured
  assert.ok(p.proofMissing.length > 0);
});

test("6. safe next actions are carried forward", () => {
  const p = prep("run tests", { safeNextActions: ["Run npm test", "Capture result"] });
  assert.deepEqual(p.safeNextActions, ["Run npm test", "Capture result"]);
});

test("7. SafeReferences carry forward without raw values", () => {
  const p = prep(`set token ${TOK}`);
  assert.ok(p.safeReferences.length > 0);
  assert.equal(p.safeReferences[0].rawValuePersisted, false);
  assert.equal(ser(p.safeReferences).includes(TOK), false);
});

test("8. excluded refs carry reason codes only, not raw sensitive paths", () => {
  const p = prep("update .env and src/config.ts");
  assert.ok(p.excludedRefs.includes("secret_file_excluded"));
  assert.equal(ser(p.excludedRefs).includes(".env"), false);
});

test("9. TTL expiry works", () => {
  const p = prep("update the README", { ttlMs: 1000 });
  assert.equal(isExpired(p, NOW + 2000), true);
  assert.equal(isExpired(p, NOW + 500), false);
});

test("10. expired packet cannot be injected", () => {
  const p = prep("update the README", { ttlMs: 1000 });
  assert.equal(canInjectContinuity(p, NOW + 5000).canInject, false);
  assert.ok(canInjectContinuity(p, NOW + 5000).reasons.includes("expired"));
});

test("11. blocked packet cannot be injected", () => {
  const p = prep("cat .env");
  assert.equal(canInjectContinuity(p, NOW).canInject, false);
  assert.ok(canInjectContinuity(p, NOW).reasons.includes("blocked"));
});

test("12. packet requiring approval cannot be injected without approval", () => {
  const p = prep("deploy to production"); // approvalPolicy require_manual_review
  assert.equal(canInjectContinuity(p, NOW).canInject, false);
  assert.ok(canInjectContinuity(p, NOW).reasons.includes("approval_required"));
});

test("13. injected packet remains redacted", () => {
  const p = markContinuityInjected(prep("update the README"));
  assert.equal(p.status, "injected");
  assert.equal(p.redacted, true);
});

test("14. serialized packet contains no raw secret", () => {
  assert.equal(ser(prep(`set ${TOK}`)).includes(TOK), false);
  assert.equal(ser(prep(`fix ${PRIV}`)).includes("MIIEowIBAAKCAQEAfake"), false);
});

test("15. serialized packet contains no raw task secret (objective redacted)", () => {
  const p = prep(`update config with ${TOK}`);
  assert.equal(p.objectiveSummary.includes(TOK), false);
  assert.ok(p.objectiveSummary.includes("[REDACTED:SEC_GH_TOKEN]"));
});

test("16. serialized packet contains no raw source dump (flag false)", () => {
  const p = prep("edit src/util/format.ts");
  assert.equal(p.containsRawSourceDump, false);
  assert.equal(p.containsRawSecret, false);
  assert.equal(p.containsRawPrompt, false);
});

test("17. serialized packet contains no terminal log or git diff (flags false)", () => {
  const p = prep("update the README");
  assert.equal(p.containsTerminalLog, false);
  assert.equal(p.containsGitDiff, false);
});

test("18. sync projection is metadata-only", () => {
  const proj = buildContinuitySyncMetadata(prep("edit src/auth/login.ts"));
  const o = proj as unknown as Record<string, unknown>;
  for (const k of ["objectiveSummary", "decisionsMade", "safeReferences", "safeNextActions", "contextSummary", "avoidRepeating", "openQuestions"]) {
    assert.equal(o[k], undefined, `projection must not include ${k}`);
  }
  assert.ok(typeof proj.decisionsCount === "number" && typeof proj.safeReferenceCount === "number");
});

test("19. sync projection excludes objective text", () => {
  assert.equal(ser(buildContinuitySyncMetadata(prep("update the README"))).includes("README"), false);
});

test("20. sync projection excludes decisions text if sensitive", () => {
  const p = prep("edit src/auth/login.ts", { decisionsMade: ["chose to touch auth/login.ts"] });
  const s = ser(buildContinuitySyncMetadata(p));
  assert.equal(s.includes("auth"), false);
  assert.equal(s.includes("login"), false);
});

test("21. sync projection excludes selected/excluded ref labels", () => {
  const s = ser(buildContinuitySyncMetadata(prep("update .env and src/config.ts")));
  assert.equal(s.includes(".env"), false);
  assert.equal(s.includes("config.ts"), false);
});

test("22. continuity packet is local-only; projection is the only sync artifact", () => {
  const p = prep("update the README");
  const proj = buildContinuitySyncMetadata(p);
  assert.equal(proj.contract, "avorelo.nextRunContinuity.sync.v1");
  assert.notEqual(p.contract, proj.contract);
  assert.equal(typeof continuityProjectionCloudEligible(p), "boolean");
});

test("23. apply returns redacted carry-forward for an injectable packet; refusal otherwise", () => {
  const inj = applyContinuity(prep("update the README"), NOW);
  assert.equal(inj.injectable, true);
  assert.ok(inj.carryForward && !ser(inj.carryForward).includes(TOK));
  const refused = applyContinuity(prep("cat .env"), NOW);
  assert.equal(refused.injectable, false);
});

test("24. continuity does not lower proof/approval (preserves WorkContract)", () => {
  const p = prep("deploy to production");
  assert.equal(p.proofTier, "production");
  assert.equal(p.approvalPolicy, "require_manual_review");
  assert.ok(["high", "critical"].includes(p.riskClass));
});

test("25. consumes ContextPacket (contextPacketRef present, no full selectedRefs array)", () => {
  const p = prep("update the README");
  assert.ok(p.contextPacketRef && p.contextPacketRef.length > 0);
  assert.equal((p as unknown as Record<string, unknown>).selectedRefs, undefined);
});

test("26. consumes WorkContract routing (route/risk/proof/approval reflected)", () => {
  const p = prep("edit src/auth/login.ts");
  assert.ok(["high", "critical"].includes(p.riskClass));
  assert.ok(["targeted_code_edit", "needs_decision", "browser_proof_required"].includes(p.route));
});

test("27. consumes Secret Boundary (token → SafeReference + riskFlag, no raw value)", () => {
  const p = prep(`add ${TOK}`);
  assert.ok(p.riskFlags.includes("SEC_GH_TOKEN"));
  assert.ok(p.safeReferences.length > 0);
  assert.equal(ser(p).includes(TOK), false);
});

test("28. expireContinuity transitions status to expired", () => {
  const p = prep("update the README", { ttlMs: 1000 });
  assert.equal(expireContinuity(p, NOW + 5000).status, "expired");
});
