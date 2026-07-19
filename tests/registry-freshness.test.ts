import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { checkUpdateExplicit, EXPLICIT_UPDATE_CHECK_URL } from "../src/avorelo/capabilities/registry-freshness/index.ts";

const TMP = join(import.meta.dirname, ".tmp-freshness-test");

describe("explicit update check (checkUpdateExplicit)", () => {
  beforeEach(() => { rmSync(TMP, { recursive: true, force: true }); mkdirSync(join(TMP, ".avorelo"), { recursive: true }); });
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it("reports up to date when latest is not newer than current", async () => {
    const r = await checkUpdateExplicit({ fetchOverride: async () => "0.0.1" });
    assert.equal(r.source, "registry");
    assert.equal(r.updateAvailable, false);
    assert.equal(r.guidanceCommand, null);
  });

  it("reports update available when latest is newer (semantic, not lexical)", async () => {
    const r = await checkUpdateExplicit({ fetchOverride: async () => "99.0.0" });
    assert.equal(r.updateAvailable, true);
    assert.ok(r.message.includes("99.0.0 is available"));
    assert.equal(r.guidanceCommand, "npm install -g avorelo@latest");
  });

  it("offline/failed registry -> honest 'unavailable', never a false 'up to date'", async () => {
    const r = await checkUpdateExplicit({ fetchOverride: async () => null });
    assert.equal(r.source, "unavailable");
    assert.equal(r.latestVersion, null);
    assert.equal(r.updateAvailable, false);
    assert.ok(/could not check/i.test(r.message));
  });

  it("makes no persistent update-check state (no cache file)", async () => {
    await checkUpdateExplicit({ fetchOverride: async () => "1.2.3" });
    assert.ok(!existsSync(join(TMP, ".avorelo", "registry-freshness-cache.json")));
  });

  it("uses the fixed npm registry URL", () => {
    assert.equal(EXPLICIT_UPDATE_CHECK_URL, "https://registry.npmjs.org/avorelo/latest");
  });
});

describe("doctor CLI exit smoke (no automatic update check)", () => {
  const SMOKE = join(import.meta.dirname, ".tmp-doctor-smoke");
  beforeEach(() => { rmSync(SMOKE, { recursive: true, force: true }); mkdirSync(SMOKE, { recursive: true }); spawnSync("git", ["init", "-q"], { cwd: SMOKE }); });
  afterEach(() => rmSync(SMOKE, { recursive: true, force: true }));

  for (const [label, env] of [["default", {}], ["CI", { CI: "true" }]] as const) {
    it(`doctor exits cleanly and performs no registry check (${label})`, () => {
      const cliPath = join(import.meta.dirname, "..", "dist", "avorelo.mjs");
      const r = spawnSync(process.execPath, [cliPath, "doctor", "--target", SMOKE], {
        env: { ...process.env, ...env }, timeout: 15000, encoding: "utf8",
      });
      const combined = (r.stdout ?? "") + (r.stderr ?? "");
      assert.ok(!combined.includes("UV_HANDLE_CLOSING"), "should not contain libuv assertion");
      assert.notEqual(r.status, 127, "should not exit 127 (assertion crash)");
      assert.ok(!combined.includes("Registry Freshness"), "CE doctor performs no automatic registry check");
    });
  }
});
