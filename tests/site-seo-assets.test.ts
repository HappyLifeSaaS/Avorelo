// Milestone E3A: routing, SEO, favicon and static-asset boundaries.
//
// The sitemap is derived from the build's own page list, so these tests check that the derivation
// stays honest rather than that a hand-maintained list is up to date.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildSite, renderSitemap, sitemapPages, publicRoute, CANONICAL_ORIGIN, SITEMAP_EXCLUDED,
} from "../src/avorelo/surfaces/public-web/index.ts";

const STATIC = join(process.cwd(), "src", "avorelo", "surfaces", "public-web", "static");
const out = () => mkdtempSync(join(tmpdir(), "avorelo-seo-"));
const clean = (d: string) => { if (existsSync(d)) rmSync(d, { recursive: true, force: true }); };
const redirects = () => readFileSync(join(STATIC, "_redirects"), "utf8");

test("/favicon.ico resolves to the existing brand asset", () => {
  // No .ico is invented and nothing is downloaded: the request is rewritten to the canonical PNG
  // so the browser receives image bytes under the PNG's own content type.
  assert.ok(/^\/favicon\.ico\s+\/favicon-256\.png\s+200/m.test(redirects()), "/favicon.ico must be served");
  assert.ok(existsSync(join(STATIC, "favicon-256.png")), "the PNG target must exist");
  const d = out();
  try {
    buildSite(d);
    assert.ok(existsSync(join(d, "favicon-256.png")), "the PNG must be generated");
  } finally { clean(d); }
});

test("every favicon and icon reference resolves to a generated asset", () => {
  const d = out();
  try {
    const r = buildSite(d);
    for (const p of r.pages) {
      const html = readFileSync(join(d, p), "utf8");
      for (const m of html.matchAll(/<link[^>]*rel="(?:icon|apple-touch-icon|manifest)"[^>]*href="([^"]+)"/g)) {
        const target = m[1].replace(/^\//, "");
        assert.ok(existsSync(join(d, target)), `${p}: icon/manifest reference missing: ${m[1]}`);
      }
    }
  } finally { clean(d); }
});

test("the sitemap is generated and lists only generated pages", () => {
  const d = out();
  try {
    const r = buildSite(d);
    const xml = readFileSync(join(d, "sitemap.xml"), "utf8");
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.ok(locs.length > 0, "sitemap must not be empty");
    for (const loc of locs) {
      assert.ok(loc.startsWith(CANONICAL_ORIGIN), `sitemap URL must use the canonical origin: ${loc}`);
      const route = loc.slice(CANONICAL_ORIGIN.length);
      const file = route === "/" ? "index.html" : route.replace(/^\//, "");
      assert.ok(existsSync(join(d, file)), `sitemap lists a URL with no generated page: ${loc}`);
    }
  } finally { clean(d); }
});

test("the sitemap excludes redirects, 410s, noindex pages and removed routes", () => {
  const d = out();
  try {
    const r = buildSite(d);
    const xml = readFileSync(join(d, "sitemap.xml"), "utf8");
    for (const p of SITEMAP_EXCLUDED) {
      assert.ok(!xml.includes(p), `sitemap must exclude ${p}`);
    }
    // Redirect sources, 410 routes and deleted operator/auth pages must never appear.
    for (const gone of ["login", "signup", "settings", "waiting-list", "refund-policy", "admin",
                        "founder-preview", "payments", "/api/", "/feedback", "/refund"]) {
      assert.ok(!xml.includes(gone), `sitemap must not list ${gone}`);
    }
    // Everything listed must be indexable: no noindex page may appear.
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const route = m[1].slice(CANONICAL_ORIGIN.length);
      const file = route === "/" ? "index.html" : route.replace(/^\//, "");
      const html = readFileSync(join(d, file), "utf8");
      assert.ok(!/<meta[^>]*name="robots"[^>]*noindex/.test(html), `sitemap lists a noindex page: ${file}`);
    }
  } finally { clean(d); }
});

test("the sitemap has no duplicates and is reproducible", () => {
  const d = out();
  try {
    const r = buildSite(d);
    const xml = readFileSync(join(d, "sitemap.xml"), "utf8");
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.equal(new Set(locs).size, locs.length, "sitemap contains duplicate URLs");
    // Same input -> byte-identical output, and order does not depend on readdir order.
    assert.equal(renderSitemap(r.pages), xml);
    assert.equal(renderSitemap([...r.pages].reverse()), xml, "sitemap must not depend on input order");
  } finally { clean(d); }
});

test("robots.txt points at the sitemap that is actually generated", () => {
  const d = out();
  try {
    buildSite(d);
    const robots = readFileSync(join(d, "robots.txt"), "utf8");
    const m = robots.match(/^Sitemap:\s*(\S+)/m);
    assert.ok(m, "robots.txt must declare a sitemap");
    assert.equal(m![1], `${CANONICAL_ORIGIN}/sitemap.xml`);
    const file = m![1].slice(CANONICAL_ORIGIN.length).replace(/^\//, "");
    assert.ok(existsSync(join(d, file)), "robots.txt points at a sitemap that does not exist");
    // It must not block retained content or invite the removed routes back in.
    assert.ok(!/^Disallow:\s*\/\s*$/m.test(robots), "robots must not block the whole site");
    for (const gone of ["login", "signup", "admin", "settings"]) {
      assert.ok(!robots.includes(gone), `robots.txt should not mention the removed route ${gone}`);
    }
  } finally { clean(d); }
});

test("every indexable page has exactly one canonical pointing at its real route", () => {
  const d = out();
  try {
    const r = buildSite(d);
    for (const p of sitemapPages(r.pages)) {
      const html = readFileSync(join(d, p), "utf8");
      const canon = [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((m) => m[1]);
      assert.equal(canon.length, 1, `${p}: expected exactly one canonical, got ${canon.length}`);
      assert.equal(canon[0], `${CANONICAL_ORIGIN}${publicRoute(p)}`, `${p}: canonical must match its route`);
    }
  } finally { clean(d); }
});

test("no page canonicalises or links to a route that does not exist", () => {
  const d = out();
  try {
    const r = buildSite(d);
    // article-context.html canonicalised to /field-notes/repeated-context — a route with no page,
    // no redirect rule and no directory. That told search engines the real URL was a 404.
    for (const p of r.pages) {
      const html = readFileSync(join(d, p), "utf8");
      assert.ok(!html.includes("/field-notes/"), `${p}: references the nonexistent /field-notes/ route`);
      for (const m of html.matchAll(new RegExp(`${CANONICAL_ORIGIN}(/[^"'\\s<)]*)`, "g"))) {
        const route = m[1];
        if (route === "/" || /\.(png|jpe?g|svg|ico|js|css|webmanifest|xml|txt)$/.test(route)) continue;
        const file = route.replace(/^\//, "");
        const cleanRoutes = ["activate", "capabilities", "pricing", "dashboard", "contact", "learn-more", "articles"];
        if (cleanRoutes.includes(file)) continue;
        assert.ok(existsSync(join(d, file)), `${p}: absolute URL to a missing route: ${m[0]}`);
      }
    }
  } finally { clean(d); }
});

test("indexable pages carry title, description and Open Graph metadata", () => {
  const d = out();
  try {
    const r = buildSite(d);
    for (const p of sitemapPages(r.pages)) {
      const html = readFileSync(join(d, p), "utf8");
      const title = html.match(/<title>([^<]*)<\/title>/);
      assert.ok(title && title[1].trim().length > 0, `${p}: missing title`);
      assert.ok(/<meta name="description" content="[^"]+"/.test(html), `${p}: missing meta description`);
      assert.ok(/<meta property="og:title"/.test(html), `${p}: missing og:title`);
      assert.ok(/<meta property="og:description"/.test(html), `${p}: missing og:description`);
      assert.ok(!/app\.avorelo\.com/.test(html), `${p}: references the hosted app origin`);
    }
  } finally { clean(d); }
});

test("every clean URL in a 200 rewrite targets a generated page, with no loops", () => {
  const d = out();
  try {
    buildSite(d);
    const rules = [...redirects().matchAll(/^(\/\S+)\s+(\/\S+)\s+(\d{3})!?/gm)]
      .map((m) => ({ from: m[1], to: m[2], status: Number(m[3]) }));
    assert.ok(rules.length > 0, "expected redirect rules");
    for (const r of rules) {
      assert.notEqual(r.from, r.to, `redirect loop: ${r.from} -> ${r.to}`);
      if (r.from.includes("*")) continue;
      const target = r.to.split("#")[0].replace(/^\//, "");
      if (target === "" || !/\./.test(target)) continue; // clean-URL target handled by another rule
      assert.ok(existsSync(join(d, target)), `${r.from} -> missing target ${r.to}`);
    }
    // No redirect *chain*: a 3xx must not land on another 3xx source. Landing on a clean URL
    // that is served by a 200 rewrite (e.g. /login -> /activate, then /activate -> /activate.html
    // 200) is the intended design, not a chain — the rewrite is server-side and costs no hop.
    const redirectSources = new Set(rules.filter((r) => r.status >= 300 && r.status < 400).map((r) => r.from));
    for (const r of rules) {
      if (r.status < 300 || r.status >= 400) continue;
      assert.ok(!redirectSources.has(r.to), `redirect chain: ${r.from} -> ${r.to} -> ...`);
    }
    // Every clean-URL 301 target must be served by some rule or file.
    const rewriteSources = new Set(rules.filter((r) => r.status === 200).map((r) => r.from));
    for (const r of rules) {
      if (r.status < 300 || r.status >= 400) continue;
      const target = r.to.replace(/^\//, "");
      if (/\./.test(target)) continue; // file target, checked above
      assert.ok(rewriteSources.has(r.to), `${r.from} -> ${r.to}: clean URL has no 200 rewrite`);
    }
  } finally { clean(d); }
});

test("the final route matrix is exactly as specified", () => {
  const rx = redirects();
  const expect: Array<[string, string, number]> = [
    ["/login", "/activate", 301], ["/login.html", "/activate", 301],
    ["/signup", "/activate", 301], ["/signup.html", "/activate", 301],
    ["/feedback", "/contact", 301], ["/feedback.html", "/contact", 301],
    ["/refund", "/refund-discontinued.html", 410], ["/refund.html", "/refund-discontinued.html", 410],
    ["/refund-policy", "/refund-discontinued.html", 410], ["/refund-policy.html", "/refund-discontinued.html", 410],
    ["/api/*", "/api-discontinued.html", 410],
  ];
  for (const [from, to, status] of expect) {
    const re = new RegExp(`^${from.replace(/[/*.]/g, (c) => "\\" + c)}\\s+${to.replace(/[/*.]/g, (c) => "\\" + c)}\\s+${status}`, "m");
    assert.ok(re.test(rx), `missing route: ${from} -> ${to} ${status}`);
  }
  assert.ok(!/https?:\/\/\S+\s+200/.test(rx), "no remote proxy rule");
  assert.ok(!/\.netlify\/functions/.test(rx), "no Netlify function");
});

test("the manifest describes an informational site, not an installable app", () => {
  const d = out();
  try {
    buildSite(d);
    const m = JSON.parse(readFileSync(join(d, "site.webmanifest"), "utf8"));
    assert.equal(m.display, "browser", "a static information site must not present as a standalone app");
    assert.equal(m.start_url, "/");
    for (const icon of m.icons) {
      assert.ok(existsSync(join(d, icon.src.replace(/^\//, ""))), `manifest icon missing: ${icon.src}`);
    }
    assert.ok(!/subscription|plan|checkout|open source/i.test(JSON.stringify(m)), "manifest makes a false claim");
  } finally { clean(d); }
});

test("removed operator and auth pages are absent from the build", () => {
  const d = out();
  try {
    buildSite(d);
    for (const gone of ["login.html", "signup.html", "settings.html", "waiting-list.html",
                        "admin.html", "founder-preview.html", "refund-policy.html",
                        "payments.html", "capability-payment-launch-readiness.html"]) {
      assert.equal(existsSync(join(d, gone)), false, `${gone} must not be generated`);
    }
    assert.ok(existsSync(join(d, "404.html")), "404 page must be generated");
  } finally { clean(d); }
});
