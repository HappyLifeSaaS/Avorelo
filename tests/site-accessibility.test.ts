// Milestone E3B: deterministic accessibility checks over the generated site.
//
// These are static checks, not a substitute for a real audit: they catch the things that can be
// proven from markup. They deliberately do not redesign the visual system.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSite } from "../src/avorelo/surfaces/public-web/index.ts";

const dir = mkdtempSync(join(tmpdir(), "avorelo-a11y-"));
const result = buildSite(dir);
const pages = result.pages;
const html = new Map(pages.map((p) => [p, readFileSync(join(dir, p), "utf8")]));
process.on("exit", () => { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); });

/** Strip head/script/style so body-level checks see only rendered markup. */
const bodyOf = (h: string) => {
  const m = h.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return (m ? m[1] : h).replace(/<script[\s\S]*?<\/script>/gi, " ");
};

test("build produced the pages under test", () => {
  assert.equal(result.ok, true, `build failed: ${result.errors.join("; ")}`);
  assert.ok(pages.length >= 60, `expected the full site, got ${pages.length}`);
});

test("every page declares a language", () => {
  for (const [p, h] of html) {
    const m = h.match(/<html[^>]*\blang="([a-z-]+)"/i);
    assert.ok(m, `${p}: <html> has no lang attribute`);
    assert.ok(m![1].length >= 2, `${p}: empty lang`);
  }
});

test("every page has a non-empty title", () => {
  for (const [p, h] of html) {
    const m = h.match(/<title>([^<]*)<\/title>/i);
    assert.ok(m && m[1].trim().length > 0, `${p}: missing or empty <title>`);
  }
});

test("every page has exactly one h1", () => {
  for (const [p, h] of html) {
    const n = (bodyOf(h).match(/<h1[\s>]/gi) || []).length;
    assert.equal(n, 1, `${p}: expected exactly one h1, found ${n}`);
  }
});

test("content pages expose landmarks", () => {
  for (const [p, h] of html) {
    const b = bodyOf(h);
    // A <main> (or role="main") must exist so keyboard/AT users can skip the chrome.
    assert.ok(/<main[\s>]|role="main"/i.test(b), `${p}: no main landmark`);
    // Navigation must be identifiable where it exists.
    if (/<nav[\s>]/i.test(b)) {
      assert.ok(/<nav[^>]*(?:aria-label|aria-labelledby)/i.test(b) || (b.match(/<nav[\s>]/gi) || []).length === 1,
        `${p}: multiple <nav> landmarks require aria-label to be distinguishable`);
    }
  }
});

test("every image has an alt attribute", () => {
  for (const [p, h] of html) {
    for (const m of bodyOf(h).matchAll(/<img\b[^>]*>/gi)) {
      assert.ok(/\balt=/.test(m[0]), `${p}: <img> without alt: ${m[0].slice(0, 90)}`);
    }
  }
});

test("every link and button has an accessible name", () => {
  for (const [p, h] of html) {
    for (const m of bodyOf(h).matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      const attrs = m[2];
      const text = m[3].replace(/<[^>]*>/g, "").replace(/&[a-z]+;/gi, " ").trim();
      const labelled = /\baria-label\s*=\s*"[^"]+"/i.test(attrs) || /\baria-labelledby\s*=/i.test(attrs);
      const imgAlt = /<img[^>]*\balt\s*=\s*"[^"]+"/i.test(m[3]);
      assert.ok(text.length > 0 || labelled || imgAlt,
        `${p}: <${m[1]}> has no accessible name: ${m[0].slice(0, 110)}`);
    }
  }
});

test("no link has an empty or placeholder href", () => {
  for (const [p, h] of html) {
    for (const m of bodyOf(h).matchAll(/<a\b[^>]*\bhref\s*=\s*"([^"]*)"/gi)) {
      assert.notEqual(m[1].trim(), "", `${p}: empty href`);
      assert.notEqual(m[1].trim(), "#", `${p}: placeholder href="#"`);
      assert.ok(!/^javascript:/i.test(m[1]), `${p}: javascript: pseudo-link`);
    }
  }
});

test("the mobile menu toggle is announced and targets a real element", () => {
  for (const [p, h] of html) {
    const b = bodyOf(h);
    for (const m of b.matchAll(/<button\b([^>]*\bclass="[^"]*nav-ham[^"]*"[^>]*)>/gi)) {
      const attrs = m[1];
      assert.ok(/aria-label\s*=\s*"[^"]+"/i.test(attrs), `${p}: menu toggle has no aria-label`);
      // The element it toggles must exist.
      const onclick = attrs.match(/getElementById\('([a-zA-Z]+)'\)/);
      if (onclick) {
        assert.ok(new RegExp(`id="${onclick[1]}"`).test(b), `${p}: toggle targets missing #${onclick[1]}`);
      }
    }
  }
});

test("pages define a visible focus style", () => {
  // Keyboard users must be able to see where they are. Checked on pages that carry their own CSS.
  for (const [p, h] of html) {
    if (!/<style[\b>]/i.test(h) && !/rel="stylesheet"[^>]*href="[^"]*capability-styles/.test(h)) continue;
    const css = [...h.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
    if (!css.trim()) continue;
    const hasFocus = /:focus-visible|:focus\b/.test(css);
    const killsOutline = /outline\s*:\s*(?:none|0)/.test(css);
    if (killsOutline) {
      assert.ok(hasFocus, `${p}: removes the focus outline without providing a focus style`);
    }
  }
});

test("existing motion respects prefers-reduced-motion", () => {
  for (const [p, h] of html) {
    const css = [...h.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
    const animates = /@keyframes|animation\s*:/.test(css);
    if (!animates) continue;
    assert.ok(/prefers-reduced-motion/.test(css), `${p}: animates without a reduced-motion guard`);
  }
});

test("no page relies on a form the site cannot submit", () => {
  for (const [p, h] of html) {
    const forms = bodyOf(h).match(/<form\b[^>]*>/gi) || [];
    assert.equal(forms.length, 0, `${p}: contains a form, but nothing is submitted from this site`);
  }
});

test("shipped stylesheet references resolve", () => {
  for (const [p, h] of html) {
    for (const m of h.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/gi)) {
      const href = m[1];
      if (/^https?:\/\//i.test(href)) continue; // external fonts: disclosed in the privacy policy
      assert.ok(existsSync(join(dir, href.replace(/^\//, ""))), `${p}: missing stylesheet ${href}`);
    }
  }
});
