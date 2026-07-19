// Commit 10: the shipped-artifact egress boundary. The npm bundle, the packed manifest, and the
// canonical static site must contain no active hosted transport. Allowed exceptions, documented
// in the allowed-egress matrix: the explicit npm registry update check, and static
// GitHub/npm/docs links that are printed (never fetched).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();
const BUNDLE = join(REPO, "dist", "avorelo.mjs");

before(() => {
  // Ensure the shipped bundle is current before scanning it.
  const r = spawnSync("npm", ["run", "build"], { cwd: REPO, encoding: "utf8", shell: true, timeout: 120000 });
  assert.equal(r.status, 0, `build failed:\n${r.stdout}\n${r.stderr}`);
  assert.ok(existsSync(BUNDLE), "bundle exists after build");
});

// Origins that must never appear as active transport in the shipped CLI bundle.
const FORBIDDEN_ORIGINS = [
  "app.avorelo.com",
  ".railway.app",
  "railway.com",
  "api.lemonsqueezy.com",
  "AVORELO_DOGFOOD_LEARNING_ENDPOINT",
  "AVORELO_DOGFOOD_ALPHA_KEY",
  "X-Avorelo-Alpha-Key",
];

// Hosts allowed to appear as URLs: the explicit update-check registry, and static
// GitHub/npm/docs links that are only ever printed to the user.
const ALLOWED_URL_HOSTS = [
  "registry.npmjs.org",  // the one explicit fetch: `avorelo update-check`
  "github.com",          // printed support/issue links
  "www.npmjs.com",
  "npmjs.com",
  "nodejs.org",          // printed docs link (Node install guidance)
  "www.w3.org",          // XML/SVG namespace URI in generated HTML — declaration, not a fetch
  "schema.org",          // JSON-LD @context in metadata, not a fetch
  "www.sitemaps.org",    // sitemap XML namespace URI (E3A) — declaration, not a fetch
  "avorelo.com",         // canonical origin rendered into sitemap <loc> values (E3A) — see below
];

test("shipped bundle contains no forbidden hosted origin", () => {
  const bundle = readFileSync(BUNDLE, "utf8");
  for (const origin of FORBIDDEN_ORIGINS) {
    assert.ok(!bundle.includes(origin), `bundle must not reference ${origin}`);
  }
});

test("shipped bundle contains no active entitlement/hosted-auth identifiers or copy", () => {
  const bundle = readFileSync(BUNDLE, "utf8");
  const forbidden = [
    // identifiers
    "entitlementSource", "billingEnvDetected", "authEnvDetected", "allowedLegacyFeatures",
    "resolveSubscriptionEntitlements", "LEMON_SQUEEZY_", "__AVORELO_GATE__",
    // user-visible copy
    "Missing: Billing env", "Missing: Auth env", "Upgrade to Pro", "Current plan",
    "Subscription required", "Manage subscription", "Billing settings",
    "Sign in to continue", "Link your account",
  ];
  const hits = forbidden.filter((f) => bundle.includes(f));
  assert.deepEqual(hits, [], `bundle contains forbidden hosted identifiers/copy: ${hits.join(", ")}`);
});

test("every http(s) URL in the shipped bundle is on the allowed-egress allowlist", () => {
  const bundle = readFileSync(BUNDLE, "utf8");
  const urls = bundle.match(/https?:\/\/[a-z0-9.-]+/gi) ?? [];
  const offenders = urls.filter((u) => {
    const host = u.replace(/^https?:\/\//i, "").toLowerCase();
    return !ALLOWED_URL_HOSTS.some((h) => host === h || host.startsWith(h + "/") || host === h);
  });
  assert.deepEqual([...new Set(offenders)], [], `unexpected URLs in bundle: ${[...new Set(offenders)].join(", ")}`);
});

test("the only network-fetch URL in the bundle is the fixed npm registry check", () => {
  const bundle = readFileSync(BUNDLE, "utf8");
  assert.ok(bundle.includes("https://registry.npmjs.org/avorelo/latest"), "explicit update-check URL present");

  // The hosted app origin must never appear at all — that was the thing that could phone home.
  assert.ok(!/app\.avorelo\.com/i.test(bundle), "no hosted app origin");

  // `https://avorelo.com` now appears because E3A renders it into sitemap <loc> values. It is a
  // string the site generator writes into XML, never a request target. Assert the distinction
  // instead of the absence: no fetch/request call in the bundle may reference it.
  for (const call of bundle.match(/\b(?:fetch|request|get|post)\s*\([^)]{0,200}/gi) ?? []) {
    assert.ok(!/avorelo\.com/i.test(call), `avorelo.com used as a request target: ${call.slice(0, 120)}`);
  }
  // And it must only ever be built into a sitemap URL, not a base for API paths.
  for (const m of bundle.matchAll(/https:\/\/avorelo\.com(\/[a-z0-9./-]*)?/gi)) {
    assert.ok(!/\/api\//i.test(m[0]), `avorelo.com API path in bundle: ${m[0]}`);
  }
  // The runtime net-trap (tests/helpers/net-trap.mjs) independently proves zero egress.
});

test("package.json ships zero runtime dependencies (no hosted transport)", () => {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  assert.deepEqual(pkg.dependencies ?? {}, {}, "runtime dependencies must be empty");
  // The hosted stack lives only in devDependencies (backend, Milestone D) — never shipped.
  const files: string[] = pkg.files ?? [];
  assert.ok(files.every((f) => !/dogfood-learning|telemetry|webhook/i.test(f)), "no hosted files in allowlist");
});

test("canonical static _redirects has no remote API proxy", () => {
  const redirects = readFileSync(join(REPO, "src/avorelo/surfaces/public-web/static/_redirects"), "utf8");
  // No proxy rule to a hosted origin (a rewrite with status 200 to an external URL).
  assert.ok(!/https?:\/\/\S+\s+200\b/.test(redirects), "no remote 200 proxy rule");
  assert.ok(!redirects.includes("app.avorelo.com"), "no app.avorelo.com proxy");
  // /api/* is served as a static 410 (gone), not proxied.
  assert.ok(/\/api\/\*\s+\/api-discontinued\.html\s+410/.test(redirects), "/api/* returns static 410");
});
