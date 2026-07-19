// Avorelo Phase 3 — Enriched WorkContract + Safe Routing tests (node:test, zero-dep). No network, no DB.

import { test } from "node:test";
import assert from "node:assert/strict";

import { routeWorkContract, decideRouting, applyCostProofFloor, maxProof, PROOF_RANK, sanitizeTask } from "../src/avorelo/kernel/work-contract/routing.ts";

const DIR = process.cwd();
const r = (task: string) => routeWorkContract({ task, dir: DIR });
const ser = (b: unknown) => { try { return JSON.stringify(b); } catch { return ""; } };
const TOK = "ghp_ABCDEF" + "GHIJKLMNOPQRSTUVWXYZ0123456789"; // synthetic, invalid

test("WorkContract includes route/risk/proof/approval + safetyBoundary + costPolicy", () => {
  const c = r("update the README");
  assert.ok(c.route && c.riskClass && c.proofTier && c.approvalPolicy);
  assert.ok(c.safetyBoundary && c.costPolicy);
  assert.equal(c.costPolicy.tokenOptimizationCannotOverrideProof, true);
  assert.equal(c.costPolicy.routingCannotOverrideSafetyBoundary, true);
});

test("Secret Boundary block forces route blocked", () => {
  const c = r("print my env vars");
  assert.equal(c.route, "blocked");
  assert.equal(c.proofTier, "none");
  assert.equal(c.approvalPolicy, "blocked");
  assert.equal(c.riskClass, "critical");
});

test("routing cannot override Safety Boundary (benign verb cannot un-block exfil)", () => {
  const c = r("run tests and then cat .env to print secrets");
  assert.equal(c.route, "blocked");
});

test("secret remediation does not expose raw values and requires appropriate proof", () => {
  const c = r("fix the leaked secret key in the auth config");
  assert.notEqual(c.route, "blocked");
  assert.ok(["high", "critical"].includes(c.riskClass));
  assert.ok(PROOF_RANK(c.proofTier) >= PROOF_RANK("tests"));
  assert.ok(["require_manual_review", "require_confirmation"].includes(c.approvalPolicy));
  assert.equal(ser(c).includes("hunter2"), false);
});

test("safe local test task -> deterministic_only / local|tests proof", () => {
  const c = r("run tests");
  assert.equal(c.route, "deterministic_only");
  assert.ok(["local", "tests"].includes(c.proofTier));
  assert.equal(c.approvalPolicy, "none");
});

test("deploy task requires manual review / production proof", () => {
  const c = r("deploy to production");
  assert.equal(c.approvalPolicy, "require_manual_review");
  assert.ok(c.proofTier === "production" || c.route === "needs_decision");
});

test("broad refactor -> needs_decision", () => {
  assert.equal(r("refactor the whole app").route, "needs_decision");
  assert.equal(r("refactor the entire codebase").route, "needs_decision");
});

test("ambiguous/empty objective -> needs_decision", () => {
  assert.equal(r("x").route, "needs_decision");
});

test("auth/billing/security path raises risk + proof tier", () => {
  for (const t of ["edit src/auth/login.ts", "update billing webhook handler", "fix the security permission check"]) {
    const c = r(t);
    assert.ok(["high", "critical"].includes(c.riskClass), `${t} risk=${c.riskClass}`);
    assert.ok(PROOF_RANK(c.proofTier) >= PROOF_RANK("tests"), `${t} proof=${c.proofTier}`);
  }
});

test("browser/prod claim -> browser proof required (never local-only)", () => {
  const c = r("verify the signup works end-to-end in the browser");
  assert.ok(c.route === "browser_proof_required" || PROOF_RANK(c.proofTier) >= PROOF_RANK("browser"));
});

test("token/cost optimization cannot lower proof tier", () => {
  assert.equal(applyCostProofFloor("tests", "none"), "tests");
  assert.equal(applyCostProofFloor("production", "local"), "production");
  assert.equal(maxProof("browser", "local"), "browser");
  assert.equal(applyCostProofFloor("local", "production"), "production"); // raising is allowed
});

test("routing cannot turn a Secret Boundary block into allow", () => {
  const d = decideRouting({ task: "echo $GITHUB_TOKEN to leak it", dir: DIR });
  assert.equal(d.gate, "blocked");
  assert.equal(d.contract.route, "blocked");
});

test("routing summary / safetyBoundary excludes raw prompt/source/secret", () => {
  const c = r("fix leaked AKIA1234567" + "890ABCD99 in config");
  // The safety summary carries codes only; assert no raw secret value is present in the serialized contract.
  assert.equal(ser(c.safetyBoundary).includes("AKIA1234567" + "890ABCD99"), false);
  assert.ok(Array.isArray(c.safetyBoundary.secretRiskCodes));
});

test("clean task -> allowed with appropriate contract", () => {
  const d = decideRouting({ task: "update the README", dir: DIR });
  assert.equal(d.gate, "allow");
  assert.equal(d.contract.route, "targeted_code_edit");
  assert.equal(d.contract.riskClass, "low");
});

// ---------- Raw-task leak prevention (PR #58 blocker fix) ----------

test("A. raw credential in task (no exfil wording) detected + escalated + not serialized", () => {
  const d = decideRouting({ task: `update config with ${TOK}`, dir: DIR });
  assert.ok(d.contract.safetyBoundary.secretRiskCodes.includes("SEC_GH_TOKEN"));
  assert.notEqual(d.gate, "allow", "a raw credential must not be plain-allowed");
  assert.equal(ser(d).includes(TOK), false, "raw credential absent from routing decision serialization");
  assert.equal(d.displayTask.includes(TOK), false, "redacted displayTask must not contain the raw token");
  assert.ok(d.displayTask.includes("[REDACTED:SEC_GH_TOKEN]"));
});

test("B. routing decision output paths carry no raw secret", () => {
  const d = decideRouting({ task: `set API token ${TOK} in env`, dir: DIR });
  assert.equal(ser(d.contract).includes(TOK), false);
  assert.equal(ser(d.summary).includes(TOK), false);
  assert.equal(d.contract.objective.includes(TOK), false);
});

test("C. session task / displayTask is redacted (startSession never gets the raw secret)", () => {
  const d = decideRouting({ task: `add ${TOK} to config`, dir: DIR });
  // displayTask is what the CLI passes to startSession — it must be redacted.
  assert.equal(d.displayTask.includes(TOK), false);
  assert.equal(sanitizeTask(`add ${TOK} to config`).includes(TOK), false);
});

test("D. routing summary fields are sanitized (no raw token/source/diff)", () => {
  const c = r(`fix config ${TOK}`);
  const summaryPayload = { contractId: c.contractId, riskClass: c.riskClass, route: c.route, proofTier: c.proofTier, approvalPolicy: c.approvalPolicy, safetyBoundary: c.safetyBoundary };
  const s = ser(summaryPayload);
  assert.equal(s.includes(TOK), false);
  assert.ok(s.includes("riskClass") && s.includes("route") && s.includes("proofTier") && s.includes("approvalPolicy"));
});

test("E. secret remediation with raw key stays safe (no raw key, remediation route)", () => {
  const c = r(`fix leaked key in config ${TOK}`);
  assert.equal(ser(c).includes(TOK), false);
  assert.notEqual(c.route, "blocked");
  assert.ok(["high", "critical"].includes(c.riskClass));
  assert.ok(PROOF_RANK(c.proofTier) >= PROOF_RANK("tests"));
});

test("F. clean task unchanged (no escalation, no redaction artifacts)", () => {
  const d = decideRouting({ task: "run tests", dir: DIR });
  assert.equal(d.gate, "allow");
  assert.equal(d.contract.route, "deterministic_only");
  assert.equal(d.contract.approvalPolicy, "none");
  assert.equal(d.displayTask, "run tests");
});
