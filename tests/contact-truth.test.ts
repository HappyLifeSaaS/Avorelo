// Avorelo contact-truth tests (node:test, zero-dep, no network).
//
// Proves the contact-truth gate with adversarial injections: every forbidden contact shape is caught,
// every legitimate one passes, and the real repository surfaces are consistent. Also proves the CLI's
// sole public contact is support@avorelo.com and that a generated support bundle embeds no address.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { scanContent, collectRealFiles, APPROVED_EMAIL, type ScanFile } from "../tools/check-contact-truth.ts";
import { SUPPORT_EMAIL } from "../src/avorelo/capabilities/feedback/index.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A minimal, clean shipped set: support@ present, a valid disclaimer + restriction, nothing else. */
function cleanSet(): ScanFile[] {
  return [
    { path: "README.md", kind: "shipped", content: `Contact ${APPROVED_EMAIL} for support.` },
    { path: "COMMERCIAL-SERVICES.md", kind: "shipped",
      content: `Optional paid services. Email ${APPROVED_EMAIL}. Contacting us does not alter your Apache-2.0 rights.` },
    { path: "src/avorelo/surfaces/public-web/static/contact.html", kind: "shipped",
      content: `<a href="mailto:${APPROVED_EMAIL}?subject=x">${APPROVED_EMAIL}</a>` },
  ];
}

test("clean shipped set passes with zero findings", () => {
  assert.deepEqual(scanContent(cleanSet()), []);
});

test("the constant and the gate agree on the single approved address", () => {
  assert.equal(SUPPORT_EMAIL, "support@avorelo.com");
  assert.equal(APPROVED_EMAIL, SUPPORT_EMAIL);
});

const injections: Array<{ name: string; rule: string; mut: (s: ScanFile[]) => ScanFile[] }> = [
  // A synthetic personal mailbox (aol) — not the owner's real address and not in the export's
  // generic-personal denylist — so this fixture itself never leaks a real personal address on export.
  { name: "personal mailbox address", rule: "personal-email",
    mut: (s) => [...s, { path: "README.md", kind: "shipped", content: "reach nobody@aol.com" }] },
  { name: "founder@ invented channel", rule: "non-approved-avorelo-email",
    mut: (s) => [...s, { path: "SUPPORT.md", kind: "shipped", content: "founder@avorelo.com" }] },
  { name: "licensing@ invented channel", rule: "non-approved-avorelo-email",
    mut: (s) => [...s, { path: "COMMERCIAL-SERVICES.md", kind: "shipped", content: "Email licensing@avorelo.com for services." }] },
  { name: "arbitrary third-party address", rule: "unexpected-published-email",
    mut: (s) => [...s, { path: "contact.html", kind: "shipped", content: "mail help@some-vendor.io" }] },
  { name: "channel-pending claim", rule: "pending-contact-claim",
    mut: (s) => [...s, { path: "src/avorelo/surfaces/public-web/static/contact.html", kind: "shipped", content: "<span>Channel pending</span>" }] },
  { name: "website contact form", rule: "contact-form",
    mut: (s) => [...s, { path: "src/avorelo/surfaces/public-web/static/contact.html", kind: "shipped", content: `<form action="/x"><input></form>` }] },
  { name: "js sender", rule: "js-sender",
    mut: (s) => [...s, { path: "src/avorelo/surfaces/public-web/static/contact.html", kind: "shipped", content: `<script>fetch("/api/mail",{method:"POST"})</script>` }] },
  { name: "mailto form action", rule: "mailto-form-action",
    mut: (s) => [...s, { path: "src/avorelo/surfaces/public-web/static/contact.html", kind: "shipped", content: `<form action="mailto:support@avorelo.com">` }] },
  { name: "unresolved template token on shipped surface", rule: "unresolved-template-token",
    mut: (s) => [...s, { path: "src/avorelo/surfaces/public-web/static/contact.html", kind: "shipped", content: "Contact: {{COMMERCIAL_CONTACT}}" }] },
  { name: "approved address absent from shipped set", rule: "no-approved-contact",
    mut: () => [{ path: "src/avorelo/surfaces/public-web/static/contact.html", kind: "shipped", content: "no address here" }] },
];

for (const inj of injections) {
  test(`adversarial: ${inj.name} → ${inj.rule}`, () => {
    const findings = scanContent(inj.mut(cleanSet()));
    assert.ok(findings.some((f) => f.rule === inj.rule),
      `expected rule ${inj.rule}; got ${JSON.stringify(findings.map((f) => f.rule))}`);
  });
}

test("legitimate example/fixture addresses are not flagged", () => {
  const findings = scanContent([
    ...cleanSet(),
    { path: "tests/x.test.ts", kind: "shipped", content: "alice@example.com jdoe@example.org admin@test" },
  ]);
  assert.deepEqual(findings, []);
});

test("template placeholders are permitted in release-kind files", () => {
  const findings = scanContent([
    ...cleanSet(),
    { path: "release/templates/commercial.md", kind: "release", content: "Contact {{COMMERCIAL_CONTACT}} to license." },
  ]);
  assert.deepEqual(findings, []);
});

test("the real repository contact surfaces are consistent (0 findings)", () => {
  const files = collectRealFiles(REPO_ROOT);
  assert.ok(files.length > 10, `expected to collect real surfaces, got ${files.length}`);
  const findings = scanContent(files);
  assert.deepEqual(findings, [], `real surfaces have contact-truth violations: ${JSON.stringify(findings, null, 2)}`);
});

test("CLI support bundle prints support@ and embeds no address, contacts nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "avorelo-contact-"));
  try {
    const out = execFileSync(process.execPath, [join(REPO_ROOT, "bin/avorelo.mjs"), "support", "bundle", "--target", dir],
      { encoding: "utf8" });
    assert.match(out, /support@avorelo\.com/, "CLI must print the approved support address");
    assert.doesNotMatch(out, /@gmail\.com|founder@|licensing@/i, "CLI must not print a personal/invented address");

    const bundleDir = join(dir, ".avorelo", "support");
    const jsonName = readdirSync(bundleDir).find((n) => n.endsWith(".json"))!;
    const bundle = readFileSync(join(bundleDir, jsonName), "utf8");
    assert.doesNotMatch(bundle, /@/, "the generated support bundle must embed no contact address");
    assert.doesNotMatch(bundle, /https?:\/\//, "the generated support bundle must embed no upload/contact URL");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
