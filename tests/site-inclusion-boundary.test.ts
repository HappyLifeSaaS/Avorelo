// Milestone E1A: the site build uses an explicit inclusion contract, not a blind copy.
// Removed hosted/operator pages cannot reach dist/site — not by lingering from an earlier
// build, and not by being dropped back into the static source directory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, unlinkSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSite, RETAINED_PAGES, RETAINED_COLLECTIONS } from "../src/avorelo/surfaces/public-web/index.ts";

const REPO = process.cwd();
const STATIC = join(REPO, "src", "avorelo", "surfaces", "public-web", "static");
const REMOVED = ["admin", "founder-preview", "settings", "waiting-list", "login", "signup", "refund-policy"];

function out() { return mkdtempSync(join(tmpdir(), "avorelo-site-")); }
const clean = (d: string) => { if (existsSync(d)) rmSync(d, { recursive: true, force: true }); };

test("removed hosted/operator pages are absent from the source tree", () => {
  for (const p of REMOVED) {
    assert.equal(existsSync(join(STATIC, `${p}.html`)), false, `${p}.html must be deleted, not hidden`);
  }
});

test("removed hosted/operator pages are absent from the generated site", () => {
  const d = out();
  try {
    const r = buildSite(d);
    assert.equal(r.ok, true, `build failed: ${r.errors.join("; ")}`);
    for (const p of REMOVED) {
      assert.equal(existsSync(join(d, `${p}.html`)), false, `${p}.html must not be generated`);
      assert.ok(!r.pages.includes(`${p}.html`), `${p}.html must not be in the page list`);
    }
  } finally { clean(d); }
});

test("every declared retained page is generated", () => {
  const d = out();
  try {
    const r = buildSite(d);
    assert.equal(r.ok, true);
    for (const p of RETAINED_PAGES) {
      assert.ok(existsSync(join(d, p)), `retained page missing from build: ${p}`);
    }
  } finally { clean(d); }
});

test("article and capability collections remain generated", () => {
  const d = out();
  try {
    const r = buildSite(d);
    const articles = r.pages.filter((p) => /^article-/.test(p));
    const caps = r.pages.filter((p) => /^capability-/.test(p));
    // 43 after E3B removed 12 head-only article stubs that rendered a blank page.
    assert.ok(articles.length >= 43, `expected the article collection, got ${articles.length}`);
    // 8 after E2B removed capability-payment-launch-readiness.html.
    assert.ok(caps.length >= 8, `expected the capability collection, got ${caps.length}`);
    for (const p of [...articles, ...caps]) {
      assert.ok(RETAINED_COLLECTIONS.some((re) => re.test(p)), `${p} must match a collection pattern`);
    }
  } finally { clean(d); }
});

test("an operator page dropped into the source directory FAILS the build (fail-closed)", () => {
  const d = out();
  const rogue = join(STATIC, "rogue-operator-console.html");
  try {
    writeFileSync(rogue, "<html><body>operator</body></html>");
    const r = buildSite(d);
    assert.equal(r.ok, false, "an undeclared page must fail the build");
    assert.ok(r.errors.some((e) => e.includes("rogue-operator-console.html")), `errors: ${r.errors.join("; ")}`);
    assert.equal(existsSync(join(d, "rogue-operator-console.html")), false, "must not be copied");
  } finally { if (existsSync(rogue)) unlinkSync(rogue); clean(d); }
});

test("a missing declared retained page FAILS the build", () => {
  const d = out();
  const page = join(STATIC, "learn-more.html");
  const stash = join(tmpdir(), `avorelo-stash-learn-more-${process.pid}.html`);
  try {
    renameSync(page, stash);
    const r = buildSite(d);
    assert.equal(r.ok, false, "a missing declared page must fail the build");
    assert.ok(r.errors.some((e) => e.includes("learn-more.html")), `errors: ${r.errors.join("; ")}`);
  } finally { if (existsSync(stash)) renameSync(stash, page); clean(d); }
});

test("a stale page from a previous build is pruned, not left behind", () => {
  const d = out();
  try {
    // Simulate a previous build that still contained a now-removed hosted page.
    writeFileSync(join(d, "login.html"), "<html>stale hosted login</html>");
    const r = buildSite(d);
    assert.equal(r.ok, true);
    assert.equal(existsSync(join(d, "login.html")), false, "stale page must be pruned from dist/site");
  } finally { clean(d); }
});

test("static redirect rules cover the removed routes and target existing pages", () => {
  const redirects = readFileSync(join(STATIC, "_redirects"), "utf8");
  // login/signup -> /activate (permanent, static)
  for (const r of ["/login", "/login.html", "/signup", "/signup.html"]) {
    assert.ok(new RegExp(`^${r.replace(/\//g, "\\/")}\\s+\\/activate\\s+301`, "m").test(redirects),
      `${r} must statically redirect to /activate (301)`);
  }
  // feedback -> /contact ; refund-policy -> static 410 ; api -> static 410
  assert.ok(/^\/feedback\s+\/contact\s+301/m.test(redirects), "/feedback -> /contact 301");
  assert.ok(/^\/refund-policy\s+\/refund-discontinued\.html\s+410/m.test(redirects), "/refund-policy -> static 410");
  assert.ok(/^\/api\/\*\s+\/api-discontinued\.html\s+410/m.test(redirects), "/api/* -> static 410");
  // No proxy, no function.
  assert.ok(!/https?:\/\/\S+\s+200/.test(redirects), "no remote proxy rule");
  assert.ok(!/\.netlify\/functions/.test(redirects), "no Netlify function");

  // Every redirect target that is a local page must exist in the source.
  for (const m of redirects.matchAll(/^\/\S+\s+(\/[a-z0-9./-]+)\s+\d{3}/gim)) {
    const target = m[1].split("#")[0];
    if (target.endsWith(".html")) {
      assert.ok(existsSync(join(STATIC, target.slice(1))), `redirect target missing: ${target}`);
    }
  }
});
