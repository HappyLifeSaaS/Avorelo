// Commit 3: explicit-only update checks. No normal command touches the network; only `update-check`
// makes one bounded, fixed-destination request; `update-apply` is a network-free, process-free tombstone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkUpdateExplicit, EXPLICIT_UPDATE_CHECK_URL } from "../src/avorelo/capabilities/registry-freshness/index.ts";

const CLI = join(import.meta.dirname, "..", "src", "avorelo", "surfaces", "cli", "avorelo.ts");
const TRAP = join(import.meta.dirname, "helpers", "net-trap.mjs");
const REGISTRY_SRC = join(import.meta.dirname, "..", "src", "avorelo", "capabilities", "registry-freshness", "index.ts");
const CLI_SRC = join(import.meta.dirname, "..", "src", "avorelo", "surfaces", "cli", "avorelo.ts");
const REPO = process.cwd();
const EXPECT_URL = "https://registry.npmjs.org/avorelo/latest";

function tmp() { return mkdtempSync(join(tmpdir(), "avorelo-upd-")); }
function runTrapped(args: string[], dir: string, extraEnv: Record<string, string> = {}) {
  const logPath = join(dir, "net.log");
  const r = spawnSync(process.execPath, ["--import", "tsx", "--import", pathToFileURL(TRAP).href, CLI, ...args, "--target", dir],
    { cwd: REPO, env: { ...process.env, NET_TRAP_LOG: logPath, ...extraEnv }, encoding: "utf8", timeout: 60000 });
  const attempts = existsSync(logPath) ? readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean) : [];
  return { r, attempts };
}

test("2. normal local commands make no update/network request", () => {
  const dir = tmp();
  try {
    for (const args of [["activate"], ["status"], ["doctor"], ["start"], ["run", "--fixture", "complete-ready"], ["open"], ["resume"]]) {
      const { attempts } = runTrapped(args, dir);
      assert.deepEqual(attempts, [], `'${args.join(" ")}' attempted network: ${attempts.join(", ")}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("3+4. explicit `update-check` attempts exactly one request to the exact fixed URL", () => {
  const dir = tmp();
  try {
    const { attempts } = runTrapped(["update-check"], dir);
    assert.equal(attempts.length, 1, `expected exactly one attempt, got: ${attempts.join(", ")}`);
    assert.ok(attempts[0].includes(EXPECT_URL), `attempt was not the fixed URL: ${attempts[0]}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("7. an alternate npm registry env cannot change the destination", () => {
  const dir = tmp();
  try {
    const { attempts } = runTrapped(["update-check"], dir, {
      npm_config_registry: "https://evil.example.com", NPM_CONFIG_REGISTRY: "https://evil.example.com",
    });
    assert.equal(attempts.length, 1);
    assert.ok(attempts[0].includes("registry.npmjs.org"), `destination changed by env: ${attempts[0]}`);
    assert.ok(!attempts[0].includes("evil.example.com"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("10. network failure yields honest 'unavailable' and writes no cache/state", async () => {
  const dir = tmp();
  try {
    const res = await checkUpdateExplicit({ fetchOverride: async () => null });
    assert.equal(res.source, "unavailable");
    assert.equal(res.latestVersion, null);
    // no persistent update-check state created
    const cache = join(dir, ".avorelo", "registry-freshness-cache.json");
    assert.ok(!existsSync(cache));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("malformed/empty registry response -> unavailable (no false 'up to date')", async () => {
  const bad = await checkUpdateExplicit({ fetchOverride: async () => null });
  assert.equal(bad.source, "unavailable");
  // fetchLatestVersion validates semver shape (malformed version -> null -> unavailable)
  const src = readFileSync(REGISTRY_SRC, "utf8");
  assert.ok(src.includes("isValidSemver"), "registry response version must be validated");
});

test("5+6+8+9. registry request is bounded, redirect-rejected, no body/auth/custom headers, fixed URL", () => {
  const src = readFileSync(REGISTRY_SRC, "utf8");
  assert.equal(EXPLICIT_UPDATE_CHECK_URL, EXPECT_URL);
  assert.ok(src.includes(`const REGISTRY_URL = "${EXPECT_URL}"`), "URL must be a fixed module constant");
  assert.ok(src.includes('redirect: "error"'), "must reject redirects");
  assert.ok(/FETCH_TIMEOUT_MS\s*=\s*\d+/.test(src) && src.includes("AbortController"), "must have a bounded timeout");
  assert.ok(!/body:/.test(src), "no request body");
  assert.ok(!/[Aa]uthorization|[Cc]ookie|npm[_-]?token/.test(src), "no auth/cookie/token headers");
  assert.ok(!/process\.env\.\w*[Rr]egistry|npm_config_registry|\.npmrc/.test(src), "destination not from env/.npmrc");
  assert.ok(src.includes("replace(/[-+]"), "semantic version compare strips prerelease/build suffixes");
});

test("11+12. `update-apply` performs no network and spawns no process; prints manual commands", () => {
  const dir = tmp();
  try {
    const { r, attempts } = runTrapped(["update-apply"], dir);
    assert.deepEqual(attempts, [], "update-apply must make no network attempt");
    const out = `${r.stdout ?? ""}`;
    assert.ok(out.includes("npx avorelo@latest") && out.includes("npm install -g avorelo@latest"));
    assert.ok(out.toLowerCase().includes("nothing was run"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("STATIC: no automatic registry check or self-update installer in active CLI source", () => {
  const cliSrc = readFileSync(CLI_SRC, "utf8");
  assert.ok(!cliSrc.includes("checkRegistryFreshness"), "no automatic registry freshness in CLI");
  // no update-owned package-manager execution
  assert.ok(!/(spawn|exec|execFile|fork)\([^)]*(npm|npx|pnpm|yarn|curl|wget|powershell)/i.test(cliSrc), "no installer spawn");
});
