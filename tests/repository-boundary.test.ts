// Community Edition repository boundary: the repo itself carries no hosted deployment,
// CI, or environment configuration. Proves the discontinued hosted backend can no longer
// be deployed or started from any canonical file, that package scripts and workflows
// reference only existing local targets, and that netlify.toml stays static-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();
const read = (p: string) => readFileSync(join(REPO, p), "utf8");
const has = (p: string) => existsSync(join(REPO, p));

test("no hosted deployment configuration files exist", () => {
  for (const f of ["railway.json", "railway.toml", "Procfile", "Dockerfile", "docker-compose.yml", "docker-compose.yaml", "nixpacks.toml"]) {
    assert.equal(has(f), false, `${f} must not exist (hosted deploy config)`);
  }
});

test("no hosted environment example files exist", () => {
  for (const f of [".env.example", ".env.test.example", ".env.production", ".env.production.example"]) {
    assert.equal(has(f), false, `${f} must not exist — Community Edition needs no environment configuration`);
  }
});

test("CI workflow has no hosted database / integration job", () => {
  const ci = read(".github/workflows/ci.yml");
  for (const needle of ["postgres:", "DATABASE_URL", "test:integration", "pg_isready", "better-auth", "drizzle", "healthcheckPath"]) {
    assert.ok(!ci.includes(needle), `ci.yml must not reference ${needle}`);
  }
});

test("CI workflow retains the Community Edition verification job", () => {
  const ci = read(".github/workflows/ci.yml");
  for (const needle of ["npm ci", "npm run build", "npm run test:local", "npm run naming-check", "npm run check:hosted-language"]) {
    assert.ok(ci.includes(needle), `ci.yml must run ${needle}`);
  }
});

test("package.json has no hosted-server or DB scripts, and no start script", () => {
  const pkg = JSON.parse(read("package.json"));
  const scripts = pkg.scripts ?? {};
  assert.ok(!("start" in scripts), "no `npm start` (was the hosted cloud-api server launcher)");
  for (const [name, cmd] of Object.entries<string>(scripts)) {
    assert.ok(!/drizzle-kit|db:migrate|db:generate|db:studio|cloud-api\/server|webhook-server|surfaces\/cli\/avorelo\.ts webhook/.test(cmd),
      `script "${name}" must not invoke a hosted target: ${cmd}`);
  }
});

test("package has zero production dependencies; only esbuild+tsx dev toolchain", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.deepEqual(pkg.dependencies ?? {}, {});
  assert.deepEqual(Object.keys(pkg.devDependencies ?? {}).sort(), ["esbuild", "tsx"]);
});

test("executable scripts and workflows use local tools, not network-capable package-exec fallback", () => {
  const pkg = JSON.parse(read("package.json"));
  // Retained tooling must run the locally installed binary via npm-script PATH resolution.
  // `npx`/`npm exec` would silently DOWNLOAD a missing tool instead of failing clearly.
  for (const [name, cmd] of Object.entries<string>(pkg.scripts ?? {})) {
    assert.ok(!/\bnpx\s+(esbuild|tsx|drizzle-kit|-y|--yes)\b/.test(cmd),
      `script "${name}" must invoke the local binary, not a package-exec fallback: ${cmd}`);
    assert.ok(!/\bnpm exec\b|\bcurl\b|\bwget\b|Invoke-WebRequest/.test(cmd),
      `script "${name}" must not fetch tooling over the network: ${cmd}`);
  }
  const ci = read(".github/workflows/ci.yml");
  assert.ok(!/\bnpx\s+(esbuild|tsx|-y|--yes)\b|\bnpm exec\b|\bcurl\b|\bwget\b/.test(ci),
    "ci.yml must not fetch tooling over the network");
});

test("the canonical dogfood aggregate requires no proprietary external CLI", () => {
  const pkg = JSON.parse(read("package.json"));
  const all = pkg.scripts["dogfood:all"] ?? "";
  // These need a real, authenticated Claude Code / Codex CLI — they are optional maintainer
  // checks, never part of the canonical required gate.
  for (const gated of ["dogfood:claude-code-adapter", "dogfood:codex-adapter"]) {
    assert.ok(!all.includes(gated), `dogfood:all must not include external-CLI-gated ${gated}`);
    assert.ok(pkg.scripts["dogfood:optional-real-tools"]?.includes(gated),
      `${gated} must live in the explicitly optional dogfood:optional-real-tools`);
  }
  // No "live" naming implying hosted production behavior.
  assert.ok(!("dogfood:live" in pkg.scripts), "dogfood:live renamed (ambiguous post-hosted-removal)");
  assert.ok("dogfood:optional-claude-live" in pkg.scripts, "optional Claude-CLI runner names its prerequisite");
});

test("every package script's node target file exists", () => {
  const pkg = JSON.parse(read("package.json"));
  for (const [name, cmd] of Object.entries<string>(pkg.scripts ?? {})) {
    for (const m of cmd.matchAll(/node (?:--[^\s]+ )*([^\s"']+\.(?:ts|js|mjs))/g)) {
      const target = m[1];
      if (target.includes("*") || target.startsWith("--")) continue;
      assert.ok(has(target), `script "${name}" references missing file: ${target}`);
    }
  }
});

test("netlify.toml is static-only (no remote proxy, no functions)", () => {
  const toml = read("netlify.toml");
  assert.ok(toml.includes("publish"), "publishes the static site");
  assert.ok(!/\[functions\]/.test(toml), "no Netlify functions");
  assert.ok(!/https?:\/\/[^\s\"]*avorelo\.com/.test(toml), "no proxy to a hosted origin");
});

test("static _redirects serves /api/* and /feedback as static 410, no remote proxy", () => {
  const redirects = read("src/avorelo/surfaces/public-web/static/_redirects");
  assert.ok(!/https?:\/\/\S+\s+200\b/.test(redirects), "no remote 200 proxy");
  assert.ok(!redirects.includes("app.avorelo.com"), "no app.avorelo.com proxy");
  assert.ok(/\/api\/\*\s+\/api-discontinued\.html\s+410/.test(redirects), "/api/* is a static 410");
});
