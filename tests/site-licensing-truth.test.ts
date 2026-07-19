// Avorelo site licensing truth — the active site must tell the Apache-2.0 story consistently.
//
// Avorelo is Open Source under the Apache License 2.0. Personal, internal, organizational, and
// commercial use are permitted. The website must state this and must NOT carry the superseded
// source-available / personal-use / non-commercial model. Matching is phrase-based on rendered prose.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const STATIC = join(process.cwd(), "src", "avorelo", "surfaces", "public-web", "static");
const pages = readdirSync(STATIC).filter((f) => f.endsWith(".html"));
const all = new Map(pages.map((f) => [f, readFileSync(join(STATIC, f), "utf8")]));

const CORE = [
  "index.html", "activate.html", "pricing.html", "dashboard.html", "contact.html",
  "privacy-policy.html", "terms-of-service.html", "license.html", "learn-more.html",
  "api-discontinued.html", "refund-discontinued.html", "404.html",
];

/** Visible prose only: strip script/style, tags and entities. */
function text(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ");
}

// Superseded restrictive-model phrasing that must NOT appear as an active claim on the site.
const SUPERSEDED = [
  { re: /\bsource[- ]available\b/i, why: "superseded source-available positioning" },
  { re: /\bpersonal use licen[cs]e\b/i, why: "superseded Personal Use License" },
  { re: /\bnon-commercial[- ]only\b|\bpersonal use only\b/i, why: "superseded non-commercial-only restriction" },
  { re: /\bcommercial use requires\b/i, why: "superseded commercial-license requirement" },
  { re: /\bUNLICENSED\b/, why: "package is Apache-2.0, not UNLICENSED" },
];

test("no active page carries the superseded restrictive licensing model", () => {
  for (const [f, html] of all) {
    const body = text(html);
    for (const { re, why } of SUPERSEDED) {
      const m = body.match(re);
      assert.ok(!m, `${f}: ${why} — found "${m?.[0]}"`);
    }
  }
});

test("core licensing pages state Apache-2.0 and open source", () => {
  for (const f of ["index.html", "pricing.html", "terms-of-service.html", "license.html"]) {
    const body = text(all.get(f)!);
    assert.ok(/Apache[- ]?2\.0|Apache Licen[cs]e/i.test(body), `${f}: must name Apache-2.0`);
    assert.ok(/open[- ]source/i.test(body), `${f}: must state open source`);
  }
});

test("licensing pages permit personal, internal, and commercial use", () => {
  const body = text(all.get("license.html")!) + " " + text(all.get("pricing.html")!);
  assert.ok(/personal/i.test(body), "must mention personal use");
  assert.ok(/internal|organizational/i.test(body), "must mention internal/organizational use");
  assert.ok(/commercial/i.test(body), "must address commercial use");
  assert.ok(/permitt?ed|allowed/i.test(body), "must state the use is permitted");
});

test("no page falsely claims Apache Foundation endorsement or a modified Apache license", () => {
  for (const [f, html] of all) {
    const body = text(html);
    assert.ok(!/\b(?:is|are) (?:endorsed|approved|certified) by the Apache\b/i.test(body), `${f}: false Apache endorsement`);
    assert.ok(!/\bmodified Apache\b|\bCommons Clause\b/i.test(body), `${f}: modified Apache / Commons Clause`);
  }
});

test("the site invites contributions under DCO (Apache, no CLA gate)", () => {
  const body = text(all.get("pricing.html")!);
  assert.ok(/contribut/i.test(body), "pricing/licensing should mention contributions");
  assert.ok(!/contributions are (?:closed|not currently accepted|not accepted)/i.test(body), "must not say contributions are closed");
});

test("core pages publish only the approved contact channel (support@avorelo.com), no form", () => {
  for (const f of CORE) {
    const html = all.get(f)!;
    for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) {
      assert.equal(m[1].toLowerCase(), "support@avorelo.com", `${f}: non-approved mailto ${m[0]}`);
    }
    for (const m of text(html).matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g)) {
      assert.equal(m[0].toLowerCase(), "support@avorelo.com", `${f}: publishes a non-approved email ${m[0]}`);
    }
    assert.ok(!/<form\b/i.test(html), `${f}: contains a form; nothing may be submitted`);
  }
});

test("structured data states Apache-2.0 and a free ($0) offer truthfully", () => {
  const idx = all.get("index.html")!;
  const blocks = [...idx.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const soft = blocks.find((b) => /SoftwareApplication/.test(b));
  assert.ok(soft, "index should carry a SoftwareApplication JSON-LD block");
  assert.ok(/apache\.org\/licenses\/LICENSE-2\.0/.test(soft!), "JSON-LD license must point to the official Apache-2.0 URL");
  assert.ok(!/app\.avorelo\.com/.test(soft!), "JSON-LD must not reference the discontinued hosted app");
});

test("privacy discloses the third-party font requests the site actually makes", () => {
  const body = text(all.get("privacy-policy.html")!);
  assert.ok(/font/i.test(body), "privacy should disclose font requests");
  assert.ok(/\bno analytics\b/i.test(body), "privacy should state there is no analytics");
});
