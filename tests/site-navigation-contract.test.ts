// Milestone E1B: the site-wide navigation / CTA contract.
//
// The hosted account flows are gone, so no page may offer them, link to them, or carry the
// analytics metadata that used to describe them. This is the permanent replacement for the
// one-time E1B migration script.
//
// Note on scope: the site is not one template. 53 pages carry the standard <nav>; the two
// discontinued pages and the capability pages use
// simpler layouts with no <nav>. The contract therefore asserts what must be true of every
// page (no hosted flows, no dead links) and, separately, what must be true of a page that
// does have navigation. It does not invent a CTA requirement for pages that never had one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const STATIC = join(process.cwd(), "src", "avorelo", "surfaces", "public-web", "static");
const pages = readdirSync(STATIC).filter((f) => f.endsWith(".html"));
const read = (f: string) => readFileSync(join(STATIC, f), "utf8");
const all = new Map(pages.map((f) => [f, read(f)]));

const CTA_LABEL = "Explore Community Edition";
const CTA_HREF = "/activate";
// Apache-2.0 correction: the landing page's primary CTA points at the public repository.
const GITHUB_CTA_LABEL = "View on GitHub";

// Pages deleted in E1A. Nothing may link to them; their routes are static redirects / 410s.
const DELETED = ["admin", "founder-preview", "settings", "waiting-list", "login", "signup", "refund-policy"];

// Hosted labels that must not appear as an interactive control (link or button) anywhere.
// Prose that merely mentions these words is page content: it is rewritten in E2A/E2B, and is
// not this contract's business. E1B removes the hosted *action*, not the surrounding narrative.
const FORBIDDEN_LABELS = [
  "Log in", "Sign in", "Sign out", "Sign up", "Create account",
  "Start free", "Start free in your repo", "Start Pro", "Get Pro",
  "Join Teams", "Install now", "Download now", "Try free",
  "Open dashboard", "View your account", "Account", "Billing",
];

// Analytics metadata: article-analytics.js was the only consumer and it is deleted.
const DEAD_ATTRS = [
  "data-article-cta", "data-hub-cta", "data-cta-label", "data-destination",
  "data-source-location", "data-article-slug", "data-article-category",
  "data-source-article", "data-target-article", "data-filter-slug", "data-article-filter",
];

test("no page links to a hosted auth flow", () => {
  for (const [f, b] of all) {
    for (const dead of ["login", "signup"]) {
      assert.ok(!new RegExp(`href="${dead}\\.html`).test(b), `${f} links to ${dead}.html`);
      assert.ok(!new RegExp(`href="/${dead}"`).test(b), `${f} links to /${dead}`);
    }
  }
});

test("no page links to a page deleted in E1A", () => {
  for (const [f, b] of all) {
    for (const dead of DELETED) {
      assert.ok(!new RegExp(`href="${dead}\\.html`).test(b), `${f} links to deleted page ${dead}.html`);
    }
  }
});

test("no hosted account or purchase label survives as an interactive control", () => {
  const forbidden = new Set(FORBIDDEN_LABELS.map((l) => l.toLowerCase()));
  for (const [f, b] of all) {
    for (const m of b.matchAll(/<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
      const text = m[2].replace(/<[^>]*>/g, "").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
      assert.ok(!forbidden.has(text.toLowerCase()), `${f} still offers the control "${text}"`);
    }
  }
});

test("no click-analytics metadata or consumer remains", () => {
  assert.equal(existsSync(join(STATIC, "article-analytics.js")), false, "article-analytics.js must be deleted");
  for (const [f, b] of all) {
    // Load-bearing check: the <script> tag, not the bare name. The privacy page legitimately
    // *names* article-analytics.js in prose to document that it was removed.
    assert.ok(!/<script[^>]*article-analytics/i.test(b), `${f} still loads the analytics script`);
    for (const attr of DEAD_ATTRS) {
      assert.ok(!new RegExp(`\\s${attr}[\\s=>]`).test(b), `${f} still carries ${attr}`);
    }
    assert.ok(!b.includes("trackAvoreloEvent"), `${f} still references the analytics helper`);
    assert.ok(!/\bgtag\s*\(/.test(b), `${f} still calls gtag`);
  }
});

test("every approved CTA uses the approved label and destination", () => {
  let ctas = 0;
  for (const [f, b] of all) {
    for (const m of b.matchAll(/<a ([^>]*)>Explore Community Edition(?: &rarr;)?<\/a>/g)) {
      ctas++;
      assert.ok(/href="\/activate"/.test(m[1]), `${f}: CTA "${CTA_LABEL}" must point to ${CTA_HREF}, got: ${m[1]}`);
    }
    // The inverse: nothing may point at /activate under a different, unapproved label.
    for (const m of b.matchAll(/<a [^>]*href="\/activate"[^>]*>([^<]*)<\/a>/g)) {
      const text = m[1].replace(/\s*&rarr;\s*/, "").trim();
      assert.equal(text, CTA_LABEL, `${f}: /activate must be labelled "${CTA_LABEL}", got "${text}"`);
    }
  }
  assert.ok(ctas > 100, `expected the site-wide CTA replacement, found ${ctas}`);
});

test("desktop and mobile navigation agree where both exist", () => {
  const links = (block: string) =>
    [...block.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g)]
      .map((m) => m[2].trim())
      .filter((t) => t && t !== "Avorelo");

  for (const [f, b] of all) {
    const desktop = b.match(/<ul class="nav-links"[^>]*>[\s\S]*?<\/ul>/);
    const mobile = b.match(/<div class="nav-mob"[^>]*>[\s\S]*?<\/div>/);
    if (!desktop || !mobile) continue;
    const d = links(desktop[0]);
    // The mobile block also contains the primary CTA (either the activation CTA or, on the
    // landing page after the Apache-2.0 correction, "View on GitHub"). Desktop keeps its CTA
    // outside the <ul>, so drop the CTA labels before comparing the navigation items.
    const m = links(mobile[0]).filter((t) => t !== CTA_LABEL && t !== GITHUB_CTA_LABEL);
    assert.deepEqual(m, d, `${f}: mobile navigation diverges from desktop`);
  }
});

test("the mobile menu toggle targets an element that exists", () => {
  for (const [f, b] of all) {
    for (const m of b.matchAll(/getElementById\('([a-zA-Z]+)'\)\.classList\.toggle\('open'\)/g)) {
      assert.ok(new RegExp(`id="${m[1]}"`).test(b), `${f}: menu toggle targets missing #${m[1]}`);
    }
    // Pages using the named helper must define it and expose the element it toggles.
    if (b.includes('onclick="toggleNav()"')) {
      assert.ok(b.includes("function toggleNav"), `${f}: toggleNav() used but not defined`);
      assert.ok(b.includes('id="navMob"'), `${f}: toggleNav() expects #navMob`);
    }
  }
});

test("every internal page link resolves to a generated page", () => {
  // Clean URLs served by the static redirect rules, plus their .html sources.
  const clean: Record<string, string> = {
    "/activate": "activate.html", "/capabilities": "capabilities.html",
    "/license": "license.html",
    "/contact": "contact.html", "/learn-more": "learn-more.html",
    "/privacy": "privacy-policy.html", "/terms": "terms-of-service.html",
  };
  for (const [f, b] of all) {
    for (const m of b.matchAll(/href="([^"#?]+)(?:[#?][^"]*)?"/g)) {
      const href = m[1];
      if (/^(https?:|mailto:|tel:|#|\/favicon|\/apple-touch)/.test(href) || href === "" || href === "/") continue;
      if (href.startsWith("/")) {
        if (clean[href]) {
          assert.ok(all.has(clean[href]), `${f}: ${href} -> missing ${clean[href]}`);
          continue;
        }
        if (/\.(png|jpg|svg|ico|js|css|webmanifest|xml|txt)$/.test(href)) continue;
        // An absolute path to a real page (e.g. /articles.html from 404.html) is fine.
        if (href.endsWith(".html")) {
          assert.ok(all.has(href.slice(1)), `${f}: broken absolute link ${href}`);
          continue;
        }
        assert.fail(`${f}: unknown absolute route ${href}`);
      }
      if (href.endsWith(".html")) {
        assert.ok(all.has(href), `${f}: broken internal link ${href}`);
      }
    }
  }
});

test("no page presents a purchasable plan or hosted origin", () => {
  for (const [f, b] of all) {
    assert.ok(!b.includes("app.avorelo.com"), `${f} references the hosted app origin`);
    assert.ok(!b.includes("__AVORELO_CHECKOUT_URL__"), `${f} carries the checkout hook`);
    assert.ok(!b.includes("__AVORELO_GATE__"), `${f} carries the entitlement gate`);
    // Actual use — a property access or call — not a prose mention. The privacy page says the
    // site uses no localStorage, which must not itself trip this check.
    assert.ok(!/localStorage\s*[.[(]/.test(b), `${f} uses localStorage`);
    // No page may link to a Teams-gated report that never existed.
    assert.ok(!/href="report-[a-z-]+\.html"/.test(b), `${f} links to a nonexistent report page`);
    assert.ok(!b.includes('rl-badge">Teams plan'), `${f} badges a CTA with a commercial tier`);
  }
});

test("no public hosted dashboard or pricing surface exists", () => {
  // Apache-2.0 correction: the hosted dashboard and pricing pages were removed. /dashboard* is a
  // 410 and /pricing* redirects to /license (see static/_redirects). Only a discontinued notice
  // remains, and it must point at the LOCAL Control Center, never a hosted surface.
  assert.equal(all.has("dashboard.html"), false, "website dashboard.html must be removed");
  assert.equal(all.has("pricing.html"), false, "website pricing.html must be removed");
  const gone = all.get("dashboard-discontinued.html")!;
  assert.ok(gone.includes("no hosted dashboard"), "the gone page states there is no hosted dashboard");
  assert.ok(gone.includes("local Control Center"), "it points at the local Control Center");
  for (const hosted of ["fetch(", "/api/", "credentials:", "createNewClaim", "not-signed-in", "app.avorelo.com"]) {
    assert.ok(!gone.includes(hosted), `discontinued page carries hosted behavior: ${hosted}`);
  }
});

test("the CLI preview does not advertise a deleted page", () => {
  // `avorelo serve` prints the routes it hosts. It listed signup.html, settings.html and
  // founder-preview.html, all deleted in E1A, so the local preview was pointing users at 404s.
  const cli = readFileSync(join(process.cwd(), "src", "avorelo", "surfaces", "cli", "avorelo.ts"), "utf8");
  const serveBlock = cli.slice(cli.indexOf("Avorelo preview is running."), cli.indexOf("Press Ctrl+C to stop."));
  for (const dead of DELETED) {
    assert.ok(!serveBlock.includes(`${dead}.html`), `serve output advertises deleted page ${dead}.html`);
  }
  for (const live of ["activate.html", "license.html", "contact.html"]) {
    assert.ok(serveBlock.includes(live), `serve output should still offer ${live}`);
    assert.ok(existsSync(join(STATIC, live)), `${live} must exist`);
  }
  // The removed hosted surfaces must not be advertised by the local preview either.
  for (const removed of ["dashboard.html", "pricing.html"]) {
    assert.ok(!serveBlock.includes(removed), `serve output advertises removed page ${removed}`);
  }
});

test("the license page presents no paid price, tier, or purchase control", () => {
  const p = all.get("license.html")!;
  // "$0" (free / Open Source) is allowed; any non-zero price is not.
  assert.ok(!/\$\s?[1-9]\d*/.test(p), "license page must show no paid price");
  for (const commercial of ["/ month", "/ year", "Upgrade to Pro", "pc-price", "pc-prim", "Join the waitlist", "Lemon Squeezy"]) {
    assert.ok(!p.includes(commercial), `license page still carries: ${commercial}`);
  }
  assert.ok(/Apache License 2\.0/.test(p), "license page states Apache-2.0");
});
