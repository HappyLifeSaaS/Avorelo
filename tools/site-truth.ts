#!/usr/bin/env node
// Avorelo site:truth — the active-site truth gate (Milestone E3B).
//
// Runs over the GENERATED site, not the source, because what ships is what matters. It rejects
// hosted-product claims and licensing claims the project cannot make.
//
// Matching is phrase- and context-based. Naive substring matching is a bug, not a feature:
//   - "OSI" appears inside "position", "composition", "purposing" — 66 files, zero real hits.
//   - "Unrestricted — All tools always" is a security-policy label, not a licence grant.
//   - The privacy page documents the localStorage and analytics the site does NOT use.
// Every rule below therefore anchors on word boundaries, exact phrases, or markup context, and
// narrow exceptions are declared explicitly rather than discovered by accident.
//
// Usage: node tools/site-truth.ts   (exits 0 when the site is truthful, 1 otherwise)

import { buildSite, sitemapPages } from "../src/avorelo/surfaces/public-web/index.ts";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Finding = { page: string; rule: string; detail: string };

/** Rendered prose only — no script, no style, no tags. */
function text(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ");
}

/** Pages allowed to describe the discontinued hosted service in the past tense. */
const DISCONTINUED_PAGES = new Set([
  "api-discontinued.html", "refund-discontinued.html", "dashboard-discontinued.html",
  "terms-of-service.html", "privacy-policy.html", "contact.html",
]);

/** Hosted-product claims. Checked against markup or prose as noted. */
const HOSTED_RULES: Array<{ rule: string; test: (html: string, t: string, page: string) => string | null }> = [
  { rule: "hosted-app-origin", test: (h) => (/app\.avorelo\.com/i.test(h) ? "app.avorelo.com" : null) },
  { rule: "railway-origin", test: (h) => (/\brailway\.app\b|\bup\.railway\b/i.test(h) ? "railway origin" : null) },
  { rule: "entitlement-gate", test: (h) => (/__AVORELO_GATE__/.test(h) ? "__AVORELO_GATE__" : null) },
  { rule: "checkout-hook", test: (h) => (/__AVORELO_CHECKOUT_URL__/.test(h) ? "__AVORELO_CHECKOUT_URL__" : null) },
  { rule: "hosted-api-path", test: (h) => {
      const m = h.match(/["'(]\/api\/[a-z]/i);
      return m ? `hosted API path ${m[0]}` : null;
    } },
  { rule: "auth-flow-link", test: (h) => {
      const m = h.match(/href="\/?(?:login|signup)(?:\.html)?"/i);
      return m ? `active auth link ${m[0]}` : null;
    } },
  { rule: "localStorage-use", test: (h) => (/localStorage\s*[.[(]/.test(h) ? "localStorage access" : null) },
  { rule: "click-analytics", test: (h) => {
      if (/<script[^>]*article-analytics/i.test(h)) return "analytics script";
      if (/\bgtag\s*\(/.test(h)) return "gtag call";
      if (/\bsendBeacon\s*\(/.test(h)) return "sendBeacon";
      const m = h.match(/\sdata-(?:article-cta|cta-label|source-location|hub-cta)[\s=>]/);
      return m ? `CTA analytics attribute ${m[0].trim()}` : null;
    } },
  { rule: "hosted-form", test: (h) => (/<form\b/i.test(h) ? "<form>" : null) },
  // The only public contact address permitted on the site is support@avorelo.com. Any other
  // published address is a stale/invented channel and fails the gate.
  { rule: "published-email", test: (h, t) => {
      for (const m of t.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g)) {
        if (m[0].toLowerCase() !== "support@avorelo.com") return `non-approved email address ${m[0]}`;
      }
      return null;
    } },
  // mailto: is permitted only to support@avorelo.com (optionally with a ?subject= query). Any
  // other mailto target — or a form-style sender — is rejected.
  { rule: "mailto-link", test: (h) => {
      for (const m of h.matchAll(/mailto:([^"'?\s>]+)/gi)) {
        if (m[1].toLowerCase() !== "support@avorelo.com") return `non-approved mailto: ${m[0]}`;
      }
      return null;
    } },
  { rule: "payment-provider", test: (h, t, p) =>
      (/\bLemon Squeezy\b/i.test(t) && !DISCONTINUED_PAGES.has(p) ? "Lemon Squeezy" : null) },
  { rule: "priced-plan", test: (h, t) => {
      const m = t.match(/\$\s?\d[\d,.]*\s*(?:\/|per)\s*(?:mo|month|yr|year|seat|user)/i);
      return m ? `price ${m[0]}` : null;
    } },
  { rule: "plan-claim", test: (h, t) => {
      const m = t.match(/\b(?:Free|Pro|Teams) plan\b|\bPro tier\b|\bPro-tier\b|\bPro capability packs\b/);
      return m ? `plan/tier claim "${m[0]}"` : null;
    } },
  { rule: "subscription-requirement", test: (h, t, p) => {
      if (DISCONTINUED_PAGES.has(p)) return null; // may say the subscription was discontinued
      const m = t.match(/\b(?:requires|need|needs) an? (?:account|subscription|entitlement)\b/i);
      return m ? m[0] : null;
    } },
  { rule: "cloud-sync-instruction", test: (h, t) => {
      const m = t.match(/\b(?:enable|turn on|configure) cloud sync\b/i);
      return m ? m[0] : null;
    } },
  { rule: "automatic-telemetry", test: (h, t) => {
      const m = t.match(/\b(?:we|avorelo) (?:collect|collects|send|sends|upload|uploads) (?:usage|telemetry|analytics)\b/i);
      return m ? m[0] : null;
    } },
  { rule: "operator-page", test: (h) => {
      const m = h.match(/href="\/?(?:admin|founder-preview|settings|waiting-list|refund-policy|payments)(?:\.html)?"/i);
      return m ? `operator/removed page link ${m[0]}` : null;
    } },
  { rule: "dead-report-link", test: (h) => {
      const m = h.match(/href="report-[a-z-]+\.html"/i);
      return m ? `link to a report page that never existed ${m[0]}` : null;
    } },
];

/** False/superseded licensing claims. Avorelo is Open Source under Apache-2.0; the OLD source-available/
 *  non-commercial model must not appear as an active claim, and Apache terms must not be misstated. */
const LICENSING_CLAIMS: Array<{ rule: string; re: RegExp }> = [
  { rule: "source-available-not-oss", re: /\bsource[- ]available\b/i },
  { rule: "personal-use-license", re: /\bpersonal use licen[cs]e\b/i },
  { rule: "non-commercial-only", re: /\bnon-commercial(?:[- ]only| use only)\b|\bpersonal use only\b/i },
  { rule: "commercial-requires-license", re: /\bcommercial use (?:requires|needs|must have) (?:a )?(?:separate |written )*licen[cs]e\b/i },
  { rule: "company-use-restricted", re: /\b(?:company|organizational|business) use (?:requires|needs|is not permitted|prohibited)\b/i },
  { rule: "proprietary-claim", re: /\bproprietary (?:licen[cs]e|software)\b/i },
  { rule: "unlicensed-claim", re: /\bUNLICENSED\b/ },
  { rule: "mit-claim", re: /\bMIT Licen[cs]e\b/i },
  { rule: "commons-clause", re: /\bCommons Clause\b/i },
  { rule: "apache-endorsement", re: /\b(?:is|are) (?:endorsed|approved|certified) by the Apache\b|\bApache Software Foundation (?:endorses|approves|certifies)\b/i },
  { rule: "modified-apache", re: /\bmodified Apache\b|\bApache[- ]?2\.0 with (?:a |an )?(?:additional|extra) (?:restriction|clause)\b/i },
];
// No negation carve-out is needed: none of the above is a legitimate positive claim for this project.
const NEGATED = /a^/; // never matches

/** Core pages where the Apache-2.0 licensing must be stated consistently. */
const LICENSING_PAGES = ["index.html", "license.html", "terms-of-service.html"];
const REQUIRED_LICENSING = [
  { name: "Apache-2.0 named", re: /Apache[- ]?2\.0|Apache Licen[cs]e/i },
  { name: "open source stated", re: /open[- ]source/i },
];

function run(): number {
  const dir = mkdtempSync(join(tmpdir(), "avorelo-truth-"));
  const findings: Finding[] = [];
  let checked = 0;

  try {
    const built = buildSite(dir);
    if (!built.ok) {
      process.stdout.write(`FAIL  build  ${built.errors.join("; ")}\n`);
      return 1;
    }

    for (const page of built.pages) {
      const html = readFileSync(join(dir, page), "utf8");
      const t = text(html);
      checked++;

      for (const r of HOSTED_RULES) {
        const hit = r.test(html, t, page);
        if (hit) findings.push({ page, rule: r.rule, detail: hit });
      }

      for (const { rule, re } of LICENSING_CLAIMS) {
        const m = t.match(re);
        if (!m) continue;
        const around = t.slice(Math.max(0, m.index! - 60), m.index! + m[0].length + 20);
        if (NEGATED.test(around)) continue; // an explicit denial is the truth, not a claim
        findings.push({ page, rule, detail: `"${m[0].trim()}" — context: "${around.trim()}"` });
      }
    }

    // Licensing pages must state the model consistently.
    for (const page of LICENSING_PAGES) {
      if (!existsSync(join(dir, page))) { findings.push({ page, rule: "missing-licensing-page", detail: "not generated" }); continue; }
      const t = text(readFileSync(join(dir, page), "utf8"));
      for (const req of REQUIRED_LICENSING) {
        if (!req.re.test(t)) findings.push({ page, rule: "licensing-incomplete", detail: `missing: ${req.name}` });
      }
    }

    // Redirects/sitemap/robots/manifest: the non-HTML surfaces.
    const redirects = readFileSync(join(dir, "_redirects"), "utf8");
    if (/https?:\/\/\S+\s+200/.test(redirects)) findings.push({ page: "_redirects", rule: "proxy-rule", detail: "remote proxy" });
    if (/\.netlify\/functions/.test(redirects)) findings.push({ page: "_redirects", rule: "function-rule", detail: "netlify function" });

    const sitemap = readFileSync(join(dir, "sitemap.xml"), "utf8");
    for (const gone of ["login", "signup", "admin", "settings", "waiting-list", "refund", "payments", "/api/"]) {
      if (sitemap.includes(gone)) findings.push({ page: "sitemap.xml", rule: "sitemap-lists-removed", detail: gone });
    }
    for (const p of sitemapPages(built.pages)) {
      const html = readFileSync(join(dir, p), "utf8");
      if (/<meta[^>]*name="robots"[^>]*noindex/i.test(html)) {
        findings.push({ page: "sitemap.xml", rule: "sitemap-lists-noindex", detail: p });
      }
    }

    const manifest = readFileSync(join(dir, "site.webmanifest"), "utf8");
    if (/subscription|checkout|open source|"display"\s*:\s*"standalone"/i.test(manifest)) {
      findings.push({ page: "site.webmanifest", rule: "manifest-claim", detail: "false claim or installable-app display" });
    }
  } finally {
    if (existsSync(dir) && dir.includes("avorelo-truth-")) rmSync(dir, { recursive: true, force: true });
  }

  for (const f of findings) process.stdout.write(`FAIL  ${f.page}  [${f.rule}]  ${f.detail}\n`);
  process.stdout.write(`\n${checked} pages checked, ${findings.length} truth violations\n`);
  return findings.length === 0 ? 0 : 1;
}

process.exit(run());
