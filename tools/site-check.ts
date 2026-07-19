#!/usr/bin/env node
// Avorelo site:check — diagnostic that builds the site, starts a server, tests all routes, and exits.
// Usage: node tools/site-check.ts
// Exits 0 if all checks pass, 1 if any fail.

import { buildSite } from "../src/avorelo/surfaces/public-web/index.ts";
import { serve } from "../src/avorelo/surfaces/preview-server/index.ts";
import { join } from "node:path";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";

type Check = { name: string; pass: boolean; detail: string };

async function run() {
  const checks: Check[] = [];
  const dir = mkdtempSync(join(tmpdir(), "avorelo-sitecheck-"));
  const outDir = join(dir, "site");

  try {
    // Build
    const build = buildSite(outDir);
    checks.push({ name: "build", pass: build.ok, detail: build.ok ? `${build.pages.length} pages` : "build failed" });

    // Start server
    const h = await serve(outDir, { port: 0 });

    const routes: { name: string; path: string; mustContain?: string; mustNotContain?: string }[] = [
      { name: "/", path: "/", mustContain: "AI coding comes with overhead. Avorelo handles it." },
      { name: "/index.html", path: "/index.html", mustContain: "AI coding comes with overhead", mustNotContain: "Make your AI coding tools waste less time, context, and tokens." },
      // The dashboard is a static illustration: it must say so, and must not reach the hosted app.
      { name: "/dashboard.html", path: "/dashboard.html", mustContain: "Illustrative local example", mustNotContain: "app.avorelo.com" },
      { name: "/dashboard (alias)", path: "/dashboard", mustContain: "Overview", mustNotContain: "/api/" },
      // Pricing states there is nothing to buy; the payment provider is gone with the hosted service.
      { name: "/pricing.html", path: "/pricing.html", mustContain: "There is nothing to buy", mustNotContain: "Lemon Squeezy" },
      { name: "/pricing (alias)", path: "/pricing", mustContain: "There is nothing to buy", mustNotContain: "Lemon Squeezy" },
      { name: "/activate-cta.js", path: "/activate-cta.js", mustContain: "Avorelo" },
      { name: "/activate.html", path: "/activate.html", mustContain: "Activate Avorelo" },
      // Discontinued hosted surfaces are served as static "gone" pages (Netlify applies the
      // 410/301 rules from _redirects; the local preview serves the target files directly).
      { name: "/api-discontinued.html", path: "/api-discontinued.html", mustContain: "discontinued" },
      { name: "/refund-discontinued.html", path: "/refund-discontinued.html", mustContain: "discontinued" },
    ];

    for (const route of routes) {
      try {
        const res = await fetch(h.url.replace(/\/$/, "") + route.path);
        const body = await res.text();
        const status = res.status === 200;
        const contains = route.mustContain ? body.includes(route.mustContain) : true;
        const notContains = route.mustNotContain ? !body.includes(route.mustNotContain) : true;
        const pass = status && contains && notContains;
        const detail = !status ? `HTTP ${res.status}` : !contains ? `missing: ${route.mustContain?.slice(0, 40)}` : !notContains ? `forbidden content present` : `HTTP 200 (${body.length}b)`;
        checks.push({ name: route.name, pass, detail });
      } catch (e) {
        checks.push({ name: route.name, pass: false, detail: (e as Error).message });
      }
    }

    // Path traversal check
    try {
      const res = await fetch(h.url + "../../../etc/passwd");
      checks.push({ name: "path-traversal", pass: res.status === 404, detail: `HTTP ${res.status}` });
    } catch (e) {
      checks.push({ name: "path-traversal", pass: false, detail: (e as Error).message });
    }

    // Removed hosted/operator pages must not be generated (Milestone E1 inclusion contract).
    // Their routes are handled by static redirects / 410s in _redirects, which Netlify applies.
    for (const forbidden of [
      "payments.html",
      "admin.html", "founder-preview.html", "settings.html", "waiting-list.html",
      "login.html", "signup.html", "refund-policy.html",
    ]) {
      try {
        const res = await fetch(h.url + forbidden);
        checks.push({ name: `no-${forbidden}`, pass: res.status === 404, detail: `HTTP ${res.status}` });
      } catch {
        checks.push({ name: `no-${forbidden}`, pass: true, detail: "not reachable (good)" });
      }
    }

    await h.close();
    // Give the event loop a tick to clean up handles before exit
    await new Promise(r => setTimeout(r, 50));
  } finally {
    if (existsSync(dir) && dir.includes("avorelo-sitecheck-")) rmSync(dir, { recursive: true, force: true });
  }

  // Print results
  let failed = 0;
  for (const c of checks) {
    const icon = c.pass ? "PASS" : "FAIL";
    if (!c.pass) failed++;
    process.stdout.write(`${icon}  ${c.name}  ${c.detail}\n`);
  }
  process.stdout.write(`\n${checks.length} checks, ${checks.length - failed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
