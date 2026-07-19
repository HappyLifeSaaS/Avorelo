// Avorelo public-secret-literal gate tests (node:test, zero-dep, no network).
//
// Proves the gate rejects every complete credential-shaped literal and accepts runtime-assembled
// fixtures + detector regexes. IMPORTANT: adversarial literals are ASSEMBLED AT RUNTIME here so this
// test file itself contains no complete credential literal (it must pass its own gate / Push Protection).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { scanForSecretLiterals, collectPublicFiles } from "../tools/check-public-secret-literals.ts";
import { detectInString } from "../src/avorelo/capabilities/secret-boundary/index.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const j = (...p: string[]) => p.join("");
const file = (content: string) => [{ path: "sample.ts", content }];

// Runtime-assembled complete fixtures (no literal appears in this source).
const STRIPE = j("sk", "_live_", "A".repeat(24));
const GH = j("ghp", "_", "A".repeat(36));
const AWS = j("AKIA", "1234567890ABCD99");
const PRIV = j("-----BEGIN RSA ", "PRIVATE KEY-----");
const DBURL = j("postgres://", "user", ":", "s3cretpw", "@db.example.internal:5432/app");

test("complete Stripe-shaped literal fails", () => {
  assert.equal(scanForSecretLiterals(file(`const k = "${STRIPE}"`)).some(f => f.rule === "stripe-secret-key"), true);
});
test("split runtime construction passes", () => {
  const split = `const k = "sk_live_AAAAAA" + "${"A".repeat(18)}"`;
  assert.deepEqual(scanForSecretLiterals(file(split)), []);
});
test("complete GitHub-token literal fails", () => {
  assert.equal(scanForSecretLiterals(file(`token: "${GH}"`)).some(f => f.rule === "github-token"), true);
});
test("complete AWS-key literal fails", () => {
  assert.equal(scanForSecretLiterals(file(`id = "${AWS}"`)).some(f => f.rule === "aws-access-key-id"), true);
});
test("complete private-key block fails", () => {
  assert.equal(scanForSecretLiterals(file(`const p = "${PRIV}\\n..."`)).some(f => f.rule === "private-key-block"), true);
});
test("real-looking database URL with credentials fails", () => {
  assert.equal(scanForSecretLiterals(file(`DATABASE_URL="${DBURL}"`)).some(f => f.rule === "db-url-with-credentials"), true);
});
test("harmless detector regex passes", () => {
  // A scanner rule names the shape via a character class — not a contiguous literal.
  assert.deepEqual(scanForSecretLiterals(file(`const RE = /sk_live_[A-Za-z0-9]+/g; // detector`)), []);
});
test("false-positive prose passes", () => {
  assert.deepEqual(scanForSecretLiterals(file(`This page discusses how a Stripe live key or a GitHub token could leak.`)), []);
});
test("AWS official example key is allowlisted", () => {
  assert.deepEqual(scanForSecretLiterals(file(`const example = "${j("AKIA", "IOSFODNN7EXAMPLE")}"`)), []);
});
test("generated runtime fixture still triggers the product detector", () => {
  // The neutralization keeps detection working: the assembled value is caught by Avorelo's own detector.
  const codes = detectInString(`x ${STRIPE} y ${GH}`).map(f => f.code);
  assert.ok(codes.includes("SEC_STRIPE_LIVE_KEY") && codes.includes("SEC_GH_TOKEN"), `got ${codes.join(",")}`);
});
test("temporary fixture is cleaned up in finally even on failure", () => {
  const dir = mkdtempSync(join(tmpdir(), "avorelo-secfix-"));
  const p = join(dir, "gen.txt");
  try {
    writeFileSync(p, `runtime ${STRIPE}`);
    // Simulate an assertion failure mid-test.
    assert.throws(() => { throw new Error("boom"); });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(readdirSync(tmpdir()).some(n => n === join(dir).split(/[\\/]/).pop()), false);
});
test("the real repository has zero public secret literals", () => {
  const files = collectPublicFiles(REPO);
  assert.ok(files.length > 100, `expected to scan the public tree, got ${files.length}`);
  const findings = scanForSecretLiterals(files);
  assert.deepEqual(findings, [], `public secret literals: ${JSON.stringify(findings.slice(0, 10), null, 2)}`);
});
