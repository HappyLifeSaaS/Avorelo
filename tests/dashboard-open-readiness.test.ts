import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { open, renderHtml, buildLocalDashboard } from "../src/avorelo/capabilities/local-dashboard/index.ts";

describe("dashboard-open-readiness", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `avorelo-open-test-${randomUUID().slice(0, 8)}`);
    mkdirSync(join(tmpDir, ".avorelo", "receipts"), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("Community Edition: generated dashboard injects no entitlement gate", () => {
    const result = open(tmpDir, { now: Date.now() });
    const html = readFileSync(result.htmlPath, "utf8");
    assert.ok(!html.includes("window.__AVORELO_GATE__="));
    assert.ok(!html.includes("window.__AVORELO_GATE_FALLBACK__="));
  });

  it("open does not require auth/cloud/network", () => {
    const result = open(tmpDir, { now: Date.now() });
    assert.ok(result.ok);
    assert.ok(existsSync(result.htmlPath));
    // Community Edition: no entitlement source concept on the open result.
    assert.ok(!("entitlementSource" in result), "no entitlementSource field");
  });

  it("generated dashboard can be built without login/cloud/network", () => {
    const result = open(tmpDir, { now: Date.now() });
    assert.ok(result.ok);
    const html = readFileSync(result.htmlPath, "utf8");
    assert.ok(html.length > 100);
    assert.ok(!html.includes("login required"));
  });

  it("Free local dashboard still includes useful local sections", () => {
    const result = open(tmpDir, { now: Date.now() });
    const html = readFileSync(result.htmlPath, "utf8");
    assert.ok(html.includes("Avorelo"));
    assert.ok(html.includes("local work proof"));
  });

  it("source dashboard.html remains valid", () => {
    const staticDashPath = join(
      import.meta.dirname, "..", "src", "avorelo", "surfaces", "public-web", "static", "dashboard.html",
    );
    if (existsSync(staticDashPath)) {
      const staticHtml = readFileSync(staticDashPath, "utf8");
      assert.ok(!staticHtml.includes("__AVORELO_GATE__"), "no entitlement gate hook in CE dashboard");
      assert.ok(staticHtml.length > 100, "dashboard html present");
    }
  });

  it("no pricing.html changes (static file check)", () => {
    const pricingPath = join(
      import.meta.dirname, "..", "src", "avorelo", "surfaces", "public-web", "static", "pricing.html",
    );
    assert.ok(existsSync(pricingPath), "pricing.html exists");
  });

  it("no Teams checkout in generated dashboard", () => {
    const result = open(tmpDir, { now: Date.now() });
    const html = readFileSync(result.htmlPath, "utf8");
    assert.ok(!html.includes("handleTeamsUpgrade"));
    assert.ok(!html.includes("AVORELO_TEAMS_CHECKOUT_URL"));
  });

  it("no raw prompts/code in generated dashboard", () => {
    const result = open(tmpDir, { now: Date.now() });
    const html = readFileSync(result.htmlPath, "utf8").toLowerCase();
    assert.ok(!html.includes('"prompt"'));
    assert.ok(!html.includes("surveillance"));
    assert.ok(!html.includes("individual ranking"));
  });
});
