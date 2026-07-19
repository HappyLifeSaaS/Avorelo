// Commit 5: remote feedback replaced by a local support flow. Support artifacts
// (JSON + Markdown) are written under .avorelo/support/, carry only allowlisted
// fields, redact secrets, point to GitHub Issues + SECURITY.md (no email / no
// owner Gmail), and are never uploaded — proven with the network trap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  getFeedbackConfig,
  prepareSupportBundle,
  renderSupportMarkdown,
  validateSupportBundle,
  SUPPORT_BUNDLE_ALLOWLIST,
  SUPPORT_ISSUES_URL,
  SUPPORT_SECURITY_URL,
} from "../src/avorelo/capabilities/feedback/index.ts";

const CLI = join(import.meta.dirname, "..", "src", "avorelo", "surfaces", "cli", "avorelo.ts");
const TRAP = pathToFileURL(join(import.meta.dirname, "helpers", "net-trap.mjs")).href;
const REPO = process.cwd();

function tmp() { return mkdtempSync(join(tmpdir(), "avorelo-support-")); }
function cleanup(dir: string) { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); }

function run(args: string[], dir: string) {
  const logPath = join(dir, "trap.log");
  const env = { ...process.env, NET_TRAP_LOG: logPath };
  const r = spawnSync(process.execPath, ["--import", "tsx", "--import", TRAP, CLI, ...args, "--target", dir],
    { cwd: REPO, env, encoding: "utf8", timeout: 60000 });
  const attempts = existsSync(logPath) ? readFileSync(logPath, "utf8").trim() : "";
  return { r, attempts, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
}

test("support bundle writes a JSON artifact under .avorelo/support/", () => {
  const dir = tmp();
  try {
    const { path } = prepareSupportBundle(dir);
    assert.ok(existsSync(path), "JSON artifact exists");
    assert.ok(path.replace(/\\/g, "/").includes("/.avorelo/support/"), "written under .avorelo/support/");
    assert.ok(path.endsWith(".json"));
  } finally { cleanup(dir); }
});

test("support bundle writes a Markdown companion artifact", () => {
  const dir = tmp();
  try {
    const { markdownPath } = prepareSupportBundle(dir);
    assert.ok(existsSync(markdownPath), "Markdown artifact exists");
    assert.ok(markdownPath.endsWith(".md"));
  } finally { cleanup(dir); }
});

test("JSON artifact is valid JSON and carries only allowlisted keys", () => {
  const dir = tmp();
  try {
    const { path } = prepareSupportBundle(dir);
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const result = validateSupportBundle(parsed);
    assert.equal(result.valid, true, `unexpected keys: ${result.violations.join(", ")}`);
    for (const key of Object.keys(parsed)) {
      assert.ok((SUPPORT_BUNDLE_ALLOWLIST as readonly string[]).includes(key), `disallowed key ${key}`);
    }
  } finally { cleanup(dir); }
});

test("validateSupportBundle rejects an injected upload/contact key", () => {
  const tampered = { bundleId: "fb_x", createdAt: "now", redaction: "applied", uploadUrl: "https://evil.example/ingest" };
  const result = validateSupportBundle(tampered);
  assert.equal(result.valid, false);
  assert.ok(result.violations.some(v => v.includes("uploadUrl")));
});

test("Markdown references the GitHub Issues URL", () => {
  const dir = tmp();
  try {
    const { markdownPath } = prepareSupportBundle(dir);
    const md = readFileSync(markdownPath, "utf8");
    assert.ok(md.includes(SUPPORT_ISSUES_URL), "issues URL present");
    assert.ok(SUPPORT_ISSUES_URL.includes("github.com/HappyLifeSaaS/Avorelo/issues"));
  } finally { cleanup(dir); }
});

test("Markdown references SECURITY.md for private reports", () => {
  const dir = tmp();
  try {
    const { markdownPath } = prepareSupportBundle(dir);
    const md = readFileSync(markdownPath, "utf8");
    assert.ok(md.includes(SUPPORT_SECURITY_URL), "security URL present");
    assert.ok(SUPPORT_SECURITY_URL.includes("SECURITY.md"));
  } finally { cleanup(dir); }
});

test("no email address or owner Gmail appears in either artifact", () => {
  const dir = tmp();
  try {
    const { path, markdownPath } = prepareSupportBundle(dir);
    for (const p of [path, markdownPath]) {
      const content = readFileSync(p, "utf8");
      assert.ok(!content.includes("mailto:"), "no mailto in artifact");
      assert.ok(!content.includes("support@avorelo.com"), "no support email in artifact");
      assert.ok(!content.includes("@gmail.com"), "no owner Gmail in artifact");
    }
  } finally { cleanup(dir); }
});

test("artifacts redact secrets and mark redaction applied", () => {
  const dir = tmp();
  try {
    const { path, bundle } = prepareSupportBundle(dir);
    const content = readFileSync(path, "utf8");
    assert.ok(!content.includes("AKIA"), "no AWS-style key");
    assert.ok(!content.includes("sk_live"), "no Stripe-style key");
    assert.equal(bundle.redaction, "applied");
    assert.ok(bundle.excludedCategories.includes("secrets"));
  } finally { cleanup(dir); }
});

test("SECURITY.md exists at the repo root and uses GitHub private reporting with a support@ fallback", () => {
  assert.ok(existsSync(join(REPO, "SECURITY.md")), "SECURITY.md present");
  const sec = readFileSync(join(REPO, "SECURITY.md"), "utf8");
  assert.ok(sec.includes(SUPPORT_ISSUES_URL) || sec.includes("github.com/HappyLifeSaaS/Avorelo/issues"));
  // GitHub Private Vulnerability Reporting is preferred; the email fallback is the approved address.
  assert.ok(/Private Vulnerability Reporting|Report a vulnerability/i.test(sec), "SECURITY.md documents GitHub private reporting");
  assert.ok(sec.includes("support@avorelo.com"), "SECURITY.md provides the approved email fallback");
  // Only the approved address may appear — never a personal mailbox.
  assert.ok(!/@(gmail|outlook|hotmail|yahoo|icloud|proton)\./i.test(sec), "SECURITY.md contains no personal email");
  for (const m of sec.matchAll(/mailto:([^"'?\s)]+)/gi)) {
    assert.equal(m[1].toLowerCase(), "support@avorelo.com", `SECURITY.md non-approved mailto ${m[0]}`);
  }
});

test("feedback config has no remote anonymous-metrics field", () => {
  const dir = tmp();
  try {
    const config = getFeedbackConfig(dir);
    assert.ok(!("allowAnonymousMetrics" in config), "no anonymous-metrics concept");
    assert.equal(config.enabled, false, "default off");
    assert.equal(config.allowSupportBundles, true, "local support bundles available");
  } finally { cleanup(dir); }
});

test("renderSupportMarkdown states nothing is uploaded", () => {
  const dir = tmp();
  try {
    const { bundle } = prepareSupportBundle(dir);
    const md = renderSupportMarkdown(bundle);
    assert.ok(/does not upload/i.test(md) || /nothing was sent/i.test(md), "explicit no-upload statement");
  } finally { cleanup(dir); }
});

test("CLI `support bundle` creates artifacts with no network egress", () => {
  const dir = tmp();
  try {
    const { r, attempts, out } = run(["support", "bundle"], dir);
    assert.equal(r.status, 0, out);
    assert.equal(attempts, "", `no outbound network expected, got: ${attempts}`);
    assert.ok(out.includes(SUPPORT_ISSUES_URL), "issues URL in output");
    assert.ok(out.toLowerCase().includes("nothing was sent") || out.toLowerCase().includes("no data"), "honest no-send copy");
  } finally { cleanup(dir); }
});

test("CLI `feedback share` prints references (GitHub + support@) with no egress and no auto-open", () => {
  const dir = tmp();
  try {
    const { path } = prepareSupportBundle(dir);
    const { r, attempts, out } = run(["feedback", "share", "--file", path], dir);
    assert.equal(r.status, 0, out);
    assert.equal(attempts, "", `no outbound network expected, got: ${attempts}`);
    assert.ok(out.includes(SUPPORT_ISSUES_URL), "issues URL in share output");
    // The approved support address is printed as a static reference the user acts on themselves.
    assert.ok(out.includes("support@avorelo.com"), "approved support address printed");
    assert.ok(!/@(gmail|outlook|hotmail|yahoo|icloud|proton)\./i.test(out), "no personal email in output");
    // No mailto: so no mail client is auto-opened — it is a printed address, not a launch link.
    assert.ok(!out.includes("mailto:"), "no mailto in share output (nothing auto-opens)");
  } finally { cleanup(dir); }
});

test("CLI `feedback status` is local-only with no metrics line and no egress", () => {
  const dir = tmp();
  try {
    const { r, attempts, out } = run(["feedback", "status"], dir);
    assert.equal(r.status, 0, out);
    assert.equal(attempts, "", `no outbound network expected, got: ${attempts}`);
    assert.ok(!/anonymous metrics/i.test(out), "no anonymous-metrics line");
    assert.ok(/stays local|nothing is uploaded/i.test(out), "states local-only");
  } finally { cleanup(dir); }
});
