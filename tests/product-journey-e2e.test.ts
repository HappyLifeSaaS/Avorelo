// Avorelo Connected Product Journey E2E tests. Zero-dep, node:test.
// Verifies all canonical routes serve, CTAs connect, no broken links, no fake claims.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildSite } from "../src/avorelo/surfaces/public-web/index.ts";
import { serve } from "../src/avorelo/surfaces/preview-server/index.ts";

const sandbox = () => mkdtempSync(join(tmpdir(), "avorelo-e2e-"));
const cleanup = (d: string) => { if (existsSync(d) && d.includes("avorelo-e2e-")) rmSync(d, { recursive: true, force: true }); };

// Helper: fetch a route and return status + body
async function get(base: string, path: string): Promise<{ status: number; body: string }> {
  const res = await fetch(base.replace(/\/$/, "") + path);
  return { status: res.status, body: await res.text() };
}

test("Journey 1 — Landing loads with approved hero and CTAs", async () => {
  const d = sandbox();
  let h: Awaited<ReturnType<typeof serve>> | null = null;
  try {
    buildSite(join(d, "site"));
    h = await serve(join(d, "site"), { port: 0 });
    const { status, body } = await get(h.url, "/");
    assert.equal(status, 200);
    assert.ok(body.includes("AI coding comes with overhead. Avorelo handles it."));
    assert.ok(!body.includes("Make your AI coding tools waste less time, context, and tokens."));
    // Apache-2.0 correction: the primary CTA is "View on GitHub"; no hosted sign-up.
    assert.ok(body.includes("View on GitHub"));
    assert.ok(body.includes("github.com/HappyLifeSaaS/Avorelo"));
    assert.ok(!body.includes("Start free"));
    assert.ok(!body.includes(">Sign in<"));
    assert.ok(body.includes("See how activation works"));
  } finally {
    if (h) await h.close();
    cleanup(d);
  }
});

test("Journey 1 — Learn more / activation page exists and links to wizard", async () => {
  const d = sandbox();
  try {
    buildSite(join(d, "site"));
    const h = await serve(join(d, "site"), { port: 0 });
    const { status, body } = await get(h.url, "/learn-more.html");
    assert.equal(status, 200);
    assert.ok(body.includes("avorelo") || body.includes("Avorelo"));
    await h.close();
  } finally { cleanup(d); }
});

// Apache-2.0 correction: the hosted pricing page was removed; there is a License page and no
// pricing surface. /pricing redirects to /license on Netlify (301 in _redirects).
test("Journey 2 — no pricing page; the License page states Apache-2.0", async () => {
  const d = sandbox();
  let h: Awaited<ReturnType<typeof serve>> | null = null;
  try {
    buildSite(join(d, "site"));
    h = await serve(join(d, "site"), { port: 0 });
    const pricing = await get(h.url, "/pricing.html");
    assert.equal(pricing.status, 404, "pricing.html must be gone");
    const lic = await get(h.url, "/license.html");
    assert.equal(lic.status, 200);
    assert.ok(/Apache License 2\.0/.test(lic.body), "license page states Apache-2.0");
    assert.ok(!lic.body.includes("Lemon Squeezy"));
    assert.ok(!/\$\s?[1-9]\d*/.test(lic.body), "no paid price");
  } finally { if (h) await h.close(); cleanup(d); }
});

test("Journey 2 — Capabilities page and alias both work", async () => {
  const d = sandbox();
  try {
    buildSite(join(d, "site"));
    const h = await serve(join(d, "site"), { port: 0 });
    const page = await get(h.url, "/capabilities.html");
    const alias = await get(h.url, "/capabilities");
    assert.equal(page.status, 200);
    assert.equal(alias.status, 200);
    // E2B: no Pro tier is sold; capabilities are described without tier framing.
    assert.ok(page.body.includes("Deeper capabilities when the work needs them"));
    assert.ok(!page.body.includes("Pro capability packs"));
    await h.close();
  } finally { cleanup(d); }
});

// Journeys 3, 4 and 6 covered the discontinued hosted signup / login / Teams-waitlist pages.
// Those pages were deleted in Milestone E1A; /login and /signup are now static 301s to
// /activate. Their absence is asserted by tests/site-inclusion-boundary.test.ts.

test("Journey 5 — no hosted dashboard; the route is a discontinued 'Gone' page", async () => {
  const d = sandbox();
  let h: Awaited<ReturnType<typeof serve>> | null = null;
  try {
    buildSite(join(d, "site"));
    h = await serve(join(d, "site"), { port: 0 });
    // The hosted dashboard page is removed. On Netlify /dashboard* returns 410 via _redirects;
    // the static preview serves the discontinued target directly.
    const dash = await get(h.url, "/dashboard.html");
    assert.equal(dash.status, 404, "dashboard.html must be gone");
    const gone = await get(h.url, "/dashboard-discontinued.html");
    assert.equal(gone.status, 200);
    assert.ok(gone.body.includes("no hosted dashboard"));
    assert.ok(gone.body.includes("local Control Center"));
    assert.ok(!gone.body.includes("app.avorelo.com"));
  } finally {
    if (h) await h.close();
    cleanup(d);
  }
});

test("Journey 7 — Contact page exists", async () => {
  const d = sandbox();
  try {
    buildSite(join(d, "site"));
    const h = await serve(join(d, "site"), { port: 0 });
    const { status } = await get(h.url, "/contact.html");
    assert.equal(status, 200);
    await h.close();
  } finally { cleanup(d); }
});

test("All article pages linked from landing exist", async () => {
  const d = sandbox();
  try {
    buildSite(join(d, "site"));
    const h = await serve(join(d, "site"), { port: 0 });
    for (const article of ["articles.html", "article-context.html", "article-scope.html", "article-proof.html", "article-routing.html", "article-access.html"]) {
      const { status } = await get(h.url, "/" + article);
      assert.equal(status, 200, `${article} should return 200`);
    }
    await h.close();
  } finally { cleanup(d); }
});

test("Legal pages exist (terms, privacy) and the refund policy is a static 410 body", async () => {
  const d = sandbox();
  try {
    buildSite(join(d, "site"));
    const h = await serve(join(d, "site"), { port: 0 });
    // refund-policy.html was removed in E1A; /refund-policy now serves refund-discontinued.html
    // with a static 410 (Netlify applies the status; the body must exist and be generated).
    for (const page of ["terms-of-service.html", "privacy-policy.html", "refund-discontinued.html"]) {
      const { status } = await get(h.url, "/" + page);
      assert.equal(status, 200, `${page} should return 200`);
    }
    await h.close();
  } finally { cleanup(d); }
});

test("Assets serve correctly", async () => {
  const d = sandbox();
  try {
    buildSite(join(d, "site"));
    const h = await serve(join(d, "site"), { port: 0 });
    const js = await get(h.url, "/activate-cta.js");
    assert.equal(js.status, 200);
    const favicon = await get(h.url, "/favicon-256.png");
    assert.equal(favicon.status, 200);
    await h.close();
  } finally { cleanup(d); }
});

test("Generated/deferred pages NOT served", async () => {
  const d = sandbox();
  try {
    buildSite(join(d, "site"));
    const h = await serve(join(d, "site"), { port: 0 });
    const payments = await get(h.url, "/payments.html");
    assert.equal(payments.status, 404, "payments.html must not exist (generated-only)");
    // NOTE: admin.html is an INTENTIONAL static page (founder/admin preview), per PR #75 and the
    // production admin console (PR #77). It is gated server-side at runtime, not by absence from the static
    // site. So admin.html is expected to be served by the local preview here; we no longer assert 404 on it
    // (this assertion was stale). payments.html remains generated-only and 404.
    await h.close();
  } finally { cleanup(d); }
});

test("Path traversal blocked", async () => {
  const d = sandbox();
  try {
    buildSite(join(d, "site"));
    const h = await serve(join(d, "site"), { port: 0 });
    const { status } = await get(h.url, "/../../../etc/passwd");
    assert.equal(status, 404);
    await h.close();
  } finally { cleanup(d); }
});

test("No fake MRR/revenue in any canonical page", async () => {
  const d = sandbox();
  try {
    buildSite(join(d, "site"));
    const h = await serve(join(d, "site"), { port: 0 });
    for (const page of ["/", "/license.html", "/contact.html"]) {
      const { body } = await get(h.url, page);
      assert.ok(!/\$\s?\d[\d,]*\s*(MRR|revenue)\b/i.test(body), `fake MRR/revenue in ${page}`);
    }
    await h.close();
  } finally { cleanup(d); }
});

test("No GA4 tracking in any page", async () => {
  const d = sandbox();
  try {
    buildSite(join(d, "site"));
    const h = await serve(join(d, "site"), { port: 0 });
    // login/signup were deleted in E1A; article-analytics.js (the gtag consumer) in E1B.
    for (const page of ["/", "/license.html", "/articles.html", "/article-context.html"]) {
      const { body } = await get(h.url, page);
      assert.ok(!body.includes("googletagmanager"), `GA4 in ${page}`);
      assert.ok(!body.includes("G-BW9LQSWSD9"), `GA4 ID in ${page}`);
      assert.ok(!body.includes("gtag"), `gtag in ${page}`);
    }
    await h.close();
  } finally { cleanup(d); }
});
