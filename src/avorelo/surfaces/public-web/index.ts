// Avorelo Public Web surface — the canonical static site.
//
// Community Edition build contract: the site is NOT a blind copy of the static directory.
// Every generated page must be declared here, either as a named retained page or through a
// validated collection pattern. The build FAILS when:
//   - an unexpected top-level HTML page appears in the static directory (so a hosted or
//     operator page cannot silently re-enter dist/site by being dropped in), or
//   - a declared retained page is missing.
//
// The discontinued hosted account/operator pages (admin, founder-preview, settings,
// waiting-list, login, signup, refund-policy) were removed in Milestone E1; their routes are
// handled by static redirects / 410s in `static/_redirects`.

import { mkdirSync, copyFileSync, readdirSync, existsSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = join(__dirname, "static");
const PKG_PATH = join(__dirname, "..", "..", "..", "..", "package.json");

/** Named top-level pages that must exist and are always generated. */
export const RETAINED_PAGES = [
  "index.html",
  "activate.html",
  "capabilities.html",
  "articles.html",
  "contact.html",
  "learn-more.html",
  "privacy-policy.html",
  "terms-of-service.html",
  "license.html",
  "api-discontinued.html",
  "refund-discontinued.html",
  "dashboard-discontinued.html",
  // Netlify serves this for any unmatched path. It is generated but intentionally noindex,
  // and it is excluded from the sitemap.
  "404.html",
] as const;

/** Validated collections — every member is generated, but only if it matches the pattern. */
export const RETAINED_COLLECTIONS = [
  /^article-[a-z0-9-]+\.html$/,
  /^capability-[a-z0-9-]+\.html$/,
] as const;

/** Non-HTML assets that ship with the site. */
const ASSET_RE = /\.(js|css|png|jpe?g|svg|ico|json|txt|xml|webmanifest)$/;
const NETLIFY_FILES = ["_redirects", "_headers"];

export type BuildSiteResult = {
  ok: boolean;
  outDir: string;
  pages: string[];
  indexPath: string;
  errors: string[];
};

function isRetainedPage(f: string): boolean {
  return (RETAINED_PAGES as readonly string[]).includes(f) ||
    RETAINED_COLLECTIONS.some((re) => re.test(f));
}

/**
 * Build the canonical static site under <outDir> using the explicit inclusion contract.
 * Returns ok:false with errors when the contract is violated (the CLI exits non-zero).
 */
export function buildSite(outDir: string): BuildSiteResult {
  mkdirSync(outDir, { recursive: true });

  if (!existsSync(STATIC_DIR)) {
    return { ok: false, outDir, pages: [], indexPath: "", errors: ["static source directory missing"] };
  }

  const entries = readdirSync(STATIC_DIR);
  const errors: string[] = [];

  // 1. Every declared retained page must exist.
  for (const p of RETAINED_PAGES) {
    if (!entries.includes(p)) errors.push(`declared retained page is missing from source: ${p}`);
  }

  // 2. No undeclared top-level HTML page may exist (fail closed).
  const htmlFiles = entries.filter((f) => f.endsWith(".html"));
  for (const f of htmlFiles) {
    if (!isRetainedPage(f)) {
      errors.push(`unexpected page not covered by the inclusion contract: ${f} ` +
        `(add it to RETAINED_PAGES/RETAINED_COLLECTIONS, or remove it)`);
    }
  }

  if (errors.length > 0) return { ok: false, outDir, pages: [], indexPath: "", errors };

  const pages = htmlFiles.filter(isRetainedPage).sort();

  // 3. Prune stale pages from a previous build. Without this, a page removed from the source
  // would survive in dist/site forever and the inclusion contract would be meaningless.
  // Targeted: only HTML files this build owns are removed — never a blind directory wipe.
  for (const f of readdirSync(outDir)) {
    if (f.endsWith(".html") && !pages.includes(f)) unlinkSync(join(outDir, f));
  }

  // 4. Copy assets verbatim; copy pages with a deterministic release marker injected into <head>
  // so a live audit can prove avorelo.com serves the exact published commit/version.
  const assets = entries.filter((f) => !f.endsWith(".html") && (ASSET_RE.test(f) || NETLIFY_FILES.includes(f)));
  for (const f of assets) copyFileSync(join(STATIC_DIR, f), join(outDir, f));
  const rel = releaseInfo();
  const marker = `<meta name="avorelo-release" content="${rel.version}+${rel.commit}">`;
  // The content pages are a deliberate fixed light design (with a few intentional dark bands).
  // Two mobile-only failure modes darken them and must be opted out of:
  //   1) Content force-darkening: Chrome Android "Auto Dark Theme", Samsung Internet and in-app
  //      webviews (e.g. the LinkedIn browser) algorithmically invert light pages. `color-scheme:
  //      only light` is the strongest opt-out (the `only` keyword forbids UA color adjustment).
  //   2) Chrome tinting: a dark `theme-color` paints the in-app browser's top bar navy, which frames
  //      the page in dark and reads as "dark mode" on a phone even when the page itself is light.
  //      Force a light theme-color that matches the page background (--bg #F5F4F1).
  // Pages that handle color-scheme themselves (the discontinued pages support light+dark) are left alone.
  const colorScheme = `<meta name="color-scheme" content="only light">`;
  const themeColorLight = `<meta name="theme-color" content="#F5F4F1">`;
  for (const f of pages) {
    let html = readFileSync(join(STATIC_DIR, f), "utf8");
    if (!html.includes('name="avorelo-release"')) html = html.replace("</head>", `${marker}\n</head>`);
    if (!/color-scheme/i.test(html)) {
      html = html.replace("</head>", `${colorScheme}\n</head>`);
      html = /<meta name="theme-color"[^>]*>/i.test(html)
        ? html.replace(/<meta name="theme-color"[^>]*>/i, themeColorLight)
        : html.replace("</head>", `${themeColorLight}\n</head>`);
    }
    writeFileSync(join(outDir, f), html);
  }

  // 5. Sitemap, derived from the same page list that was just generated. There is deliberately
  // no second route inventory to drift out of sync: if a page is not built, it cannot be listed.
  writeFileSync(join(outDir, "sitemap.xml"), renderSitemap(pages));

  // 6. Deterministic release manifest (no wall-clock — the commit is the identity).
  writeFileSync(join(outDir, "release.json"), JSON.stringify(rel, null, 2) + "\n");

  return { ok: true, outDir, pages, indexPath: join(outDir, "index.html"), errors: [] };
}

/** Deterministic release metadata: version from package.json, commit from the build env. */
export function releaseInfo(): { version: string; commit: string; license: string; npmDistTag: string; repository: string; homepage: string } {
  let version = "0.0.0";
  try { version = JSON.parse(readFileSync(PKG_PATH, "utf8")).version || version; } catch { /* ignore */ }
  const commit = (process.env.AVORELO_RELEASE_COMMIT || "local").slice(0, 40);
  return {
    version,
    commit,
    license: "Apache-2.0",
    npmDistTag: "latest",
    repository: "https://github.com/HappyLifeSaaS/Avorelo",
    homepage: "https://avorelo.com",
  };
}

export const CANONICAL_ORIGIN = "https://avorelo.com";

/**
 * Pages that are generated but must never be indexed:
 *   - 404: not a destination.
 *   - the discontinued bodies: they are served with a 410 by `_redirects`; listing a gone
 *     resource in a sitemap asks search engines to index a tombstone.
 * Each is marked `noindex` in its own HTML too — this list keeps the sitemap consistent with that.
 */
export const SITEMAP_EXCLUDED = ["404.html", "api-discontinued.html", "refund-discontinued.html", "dashboard-discontinued.html"] as const;

/** Public route for a generated page. Clean URLs mirror the 200 rewrites in `_redirects`. */
export function publicRoute(page: string): string {
  if (page === "index.html") return "/";
  return "/" + page;
}

export function sitemapPages(pages: string[]): string[] {
  return pages.filter((p) => !(SITEMAP_EXCLUDED as readonly string[]).includes(p)).sort();
}

export function renderSitemap(pages: string[]): string {
  const urls = sitemapPages(pages).map((p) => `  <url><loc>${CANONICAL_ORIGIN}${publicRoute(p)}</loc></url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

export const PAGE_FILES = ["index.html", "capabilities.html", "license.html"];
