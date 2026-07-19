#!/usr/bin/env node
// Avorelo Connected Preview Check. Starts preview server, tests all routes via real HTTP,
// checks internal links, writes proof artifact. Fails on any broken route or dead CTA.

import { buildSite } from "../src/avorelo/surfaces/public-web/index.ts";
import { serve } from "../src/avorelo/surfaces/preview-server/index.ts";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

type RouteProof = {
  url: string;
  status: number;
  contentType: string;
  title: string;
  bodyContainsExpectedMarker: boolean;
  internalLinksFound: number;
  brokenInternalLinks: string[];
  errors: string[];
};

type LinkProof = {
  sourcePage: string;
  href: string;
  targetStatus: number | null;
  works: boolean;
};

const EXPECTED_ROUTES: Array<{ path: string; marker: string; contentMarkers?: string[] }> = [
  { path: "/", marker: "Avorelo" },
  { path: "/activate.html", marker: "Activate", contentMarkers: ["npx avorelo"] },
  { path: "/dashboard.html", marker: "Dashboard" },
  { path: "/pricing.html", marker: "Pricing", contentMarkers: ["Lemon Squeezy", "Free", "Pro"] },
  { path: "/signup.html", marker: "Avorelo", contentMarkers: ["Create your Avorelo account", "Free. No credit card required.", "Quick sign in", "Local preview auth", "Google", "GitHub", "Slack", "Discord", "OAuth providers are not connected"] },
  { path: "/login.html", marker: "Avorelo", contentMarkers: ["Sign in to Avorelo", "Continue where you left off.", "Quick sign in", "Local preview auth", "Google", "GitHub", "Slack", "Discord", "OAuth providers are not connected"] },
  { path: "/settings.html", marker: "Settings" },
  { path: "/founder.html", marker: "Founder", contentMarkers: ["SaaS Ops", "AI Work Control", "Product", "Learn", "Users", "Billing", "Workspace", "Support", "Production Blockers", "Benjamin Decisions", "Fixture", "Lemon Squeezy", "Entitlements", "Local preview"] },
  { path: "/admin.html", marker: "Admin" },
  { path: "/waiting-list.html", marker: "Waiting" },
  { path: "/contact.html", marker: "Contact" },
  { path: "/articles.html", marker: "Articles" },
  { path: "/activate-cta.js", marker: "Avorelo" },
];

async function run() {
  const dir = mkdtempSync(join(tmpdir(), "avorelo-preview-check-"));
  const outDir = join(dir, "site");
  let failed = 0;

  try {
    const build = buildSite(outDir);
    if (!build.ok) { process.stderr.write("BUILD FAILED\n"); process.exit(1); }

    const h = await serve(outDir, { port: 0 });
    const baseUrl = h.url.replace(/\/$/, "");
    const routeProofs: RouteProof[] = [];
    const linkProofs: LinkProof[] = [];

    // Test each expected route
    for (const route of EXPECTED_ROUTES) {
      const url = baseUrl + route.path;
      try {
        const res = await fetch(url);
        const body = await res.text();
        const title = body.match(/<title>(.*?)<\/title>/)?.[1] || "(no title)";
        const containsMarker = body.includes(route.marker);

        // Extract internal links from HTML pages
        const internalLinks: string[] = [];
        const brokenLinks: string[] = [];
        if (route.path.endsWith(".html") || route.path === "/") {
          const hrefs = [...body.matchAll(/href="([^"]*?)"/g)].map(m => m[1]);
          for (const href of hrefs) {
            if (href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("#") || href.startsWith("data:")) continue;
            internalLinks.push(href);
            // Check if internal link target exists
            const target = href.startsWith("/") ? href : "/" + href;
            try {
              const lr = await fetch(baseUrl + target.split("?")[0]);
              if (lr.status !== 200) brokenLinks.push(href);
              linkProofs.push({ sourcePage: route.path, href, targetStatus: lr.status, works: lr.status === 200 });
            } catch {
              brokenLinks.push(href);
              linkProofs.push({ sourcePage: route.path, href, targetStatus: null, works: false });
            }
          }
        }

        const ok = res.status === 200 && containsMarker;
        if (!ok) failed++;

        routeProofs.push({
          url: route.path,
          status: res.status,
          contentType: res.headers.get("content-type") || "",
          title,
          bodyContainsExpectedMarker: containsMarker,
          internalLinksFound: internalLinks.length,
          brokenInternalLinks: brokenLinks,
          errors: ok ? [] : [`status=${res.status}`, !containsMarker ? `missing marker: ${route.marker}` : ""].filter(Boolean),
        });

        const icon = ok ? "PASS" : "FAIL";
        process.stdout.write(`${icon}  ${route.path}  HTTP ${res.status}  "${title.substring(0, 40)}"${brokenLinks.length > 0 ? `  [${brokenLinks.length} broken links]` : ""}\n`);

      } catch (e) {
        failed++;
        routeProofs.push({ url: route.path, status: 0, contentType: "", title: "", bodyContainsExpectedMarker: false, internalLinksFound: 0, brokenInternalLinks: [], errors: [(e as Error).message] });
        process.stdout.write(`FAIL  ${route.path}  ${(e as Error).message}\n`);
      }
    }

    await h.close();

    // Write proof artifacts
    const proofDir = join(process.cwd(), ".avorelo", "proof");
    mkdirSync(proofDir, { recursive: true });

    writeFileSync(join(proofDir, "connected-preview-route-proof.json"), JSON.stringify({
      generatedAt: new Date().toISOString(),
      baseUrl,
      totalRoutes: EXPECTED_ROUTES.length,
      passed: EXPECTED_ROUTES.length - failed,
      failed,
      routes: routeProofs,
    }, null, 2));

    const brokenLinkCount = linkProofs.filter(l => !l.works).length;
    writeFileSync(join(proofDir, "connected-preview-link-proof.json"), JSON.stringify({
      generatedAt: new Date().toISOString(),
      totalLinks: linkProofs.length,
      working: linkProofs.filter(l => l.works).length,
      broken: brokenLinkCount,
      links: linkProofs.filter(l => !l.works),
    }, null, 2));

    process.stdout.write(`\n${EXPECTED_ROUTES.length} routes, ${EXPECTED_ROUTES.length - failed} passed, ${failed} failed\n`);
    process.stdout.write(`${linkProofs.length} internal links, ${brokenLinkCount} broken\n`);
    process.stdout.write(`Proof: .avorelo/proof/connected-preview-route-proof.json\n`);

    // Critical broken links are only those in nav/CTA flow (not article content pages or assets)
    const criticalBroken = linkProofs.filter(l => !l.works && !l.href.startsWith("article-") && !l.href.startsWith("report-") && !l.href.includes("favicon") && !l.href.includes("webmanifest") && !l.href.includes("apple-touch") && !l.href.includes("og-card"));
    const criticalCount = criticalBroken.length;
    if (criticalCount > 0) {
      process.stdout.write(`\nCRITICAL broken links (${criticalCount}):\n`);
      for (const l of criticalBroken) process.stdout.write(`  ${l.sourcePage} → ${l.href}\n`);
    }

    await new Promise(r => setTimeout(r, 50));
    process.exit(failed > 0 || criticalCount > 0 ? 1 : 0);

  } finally {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

run();
