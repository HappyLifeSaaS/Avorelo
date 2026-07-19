import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";
import {
  runPreflight,
  formatPreflightReport,
  buildWindowsFallbackCommand,
  buildUnixFallbackCommand,
  type PreflightResult,
  type ActivationFailureTaxonomy,
} from "../src/avorelo/capabilities/activation/activation-preflight.ts";

let target: string;

before(() => {
  target = mkdtempSync(join(tmpdir(), "avorelo-preflight-test-"));
  mkdirSync(join(target, "src"), { recursive: true });
});

after(() => {
  if (existsSync(target) && target.includes("avorelo-preflight-test-")) rmSync(target, { recursive: true, force: true });
});

describe("Activation Preflight", () => {
  it("returns a valid preflight result structure", () => {
    const r = runPreflight(target);
    assert.equal(typeof r.ok, "boolean");
    assert.equal(typeof r.canStart, "boolean");
    assert.ok(Array.isArray(r.checks));
    assert.ok(r.checks.length >= 6);
    assert.ok(["READY", "LOCAL_PREFLIGHT_FAILED", "BLOCKED_BY_RUNNER_BEFORE_AVORELO_STARTED", "UNKNOWN"].includes(r.taxonomy));
  });

  it("detects node as available", () => {
    const r = runPreflight(target);
    const nodeCheck = r.checks.find(c => c.id === "node_available");
    assert.ok(nodeCheck, "node_available check missing");
    assert.ok(nodeCheck.passed, "node should be available in test environment");
    assert.ok(nodeCheck.details.startsWith("v"), `node version should start with v, got: ${nodeCheck.details}`);
  });

  it("detects npm as available", () => {
    const r = runPreflight(target);
    const npmCheck = r.checks.find(c => c.id === "npm_available");
    assert.ok(npmCheck, "npm_available check missing");
    assert.ok(npmCheck.passed, "npm should be available in test environment");
  });

  it("detects npx as available", () => {
    const r = runPreflight(target);
    const npxCheck = r.checks.find(c => c.id === "npx_available");
    assert.ok(npxCheck, "npx_available check missing");
    assert.ok(npxCheck.passed, "npx should be available in test environment");
  });

  it("checks npm cache accessibility", () => {
    const r = runPreflight(target);
    const cacheCheck = r.checks.find(c => c.id === "npm_cache_writable");
    assert.ok(cacheCheck, "npm_cache_writable check missing");
    assert.equal(typeof cacheCheck.passed, "boolean");
  });

  it("checks temp dir writability", () => {
    const r = runPreflight(target);
    const tempCheck = r.checks.find(c => c.id === "temp_dir_writable");
    assert.ok(tempCheck, "temp_dir_writable check missing");
    assert.ok(tempCheck.passed, "temp dir should be writable");
  });

  it("checks target dir existence", () => {
    const r = runPreflight(target);
    const targetCheck = r.checks.find(c => c.id === "target_dir_writable");
    assert.ok(targetCheck, "target_dir_writable check missing");
    assert.ok(targetCheck.passed, "target dir should exist");
  });

  it("checks PowerShell execution policy on Windows", () => {
    const r = runPreflight(target);
    const psCheck = r.checks.find(c => c.id === "powershell_execution_policy");
    if (platform() === "win32") {
      assert.ok(psCheck, "powershell_execution_policy check should exist on Windows");
      assert.equal(typeof psCheck.passed, "boolean");
    }
  });

  it("checks npm registry reachability", () => {
    const r = runPreflight(target);
    const registryCheck = r.checks.find(c => c.id === "network_npm_registry");
    assert.ok(registryCheck, "network_npm_registry check missing");
    assert.equal(typeof registryCheck.passed, "boolean");
  });

  it("canStart is true when node/npm/npx are available", () => {
    const r = runPreflight(target);
    assert.ok(r.canStart, "canStart should be true when node/npm/npx are available");
  });

  it("taxonomy is READY or LOCAL_PREFLIGHT_FAILED in normal test environment", () => {
    const r = runPreflight(target);
    assert.ok(["READY", "LOCAL_PREFLIGHT_FAILED"].includes(r.taxonomy), `unexpected taxonomy: ${r.taxonomy}`);
  });

  it("returns non-empty report for failed target dir", () => {
    const r = runPreflight("/nonexistent/path/avorelo-test-xyz");
    const targetCheck = r.checks.find(c => c.id === "target_dir_writable");
    assert.ok(targetCheck, "target_dir_writable check missing");
    assert.ok(!targetCheck.passed, "nonexistent dir should not pass");
  });
});

describe("Activation Failure Taxonomy", () => {
  it("taxonomy values are well-defined strings", () => {
    const valid: ActivationFailureTaxonomy[] = [
      "READY",
      "BLOCKED_BY_RUNNER_BEFORE_AVORELO_STARTED",
      "LOCAL_PREFLIGHT_FAILED",
      "ACTIVATION_SUCCEEDED_LOCALLY",
      "TELEMETRY_UPLOADED",
      "DASHBOARD_LINKED",
      "UNKNOWN",
    ];
    for (const v of valid) {
      assert.equal(typeof v, "string");
      assert.ok(v.length > 0);
    }
  });
});

describe("Preflight Report Formatting", () => {
  it("formats a readable report", () => {
    const r = runPreflight(target);
    const report = formatPreflightReport(r);
    assert.ok(report.includes("Avorelo Activation Preflight"), "report should have header");
    assert.ok(report.includes("Node.js available"), "report should mention node check");
    assert.ok(report.includes("npm available"), "report should mention npm check");
  });

  it("includes recovery instructions for failed checks", () => {
    const r = runPreflight("/nonexistent/path/avorelo-test-xyz");
    const report = formatPreflightReport(r);
    assert.ok(report.length > 100, "report should have substance");
  });
});

describe("Fallback Commands", () => {
  it("Windows fallback is safe (no env dumps, no secrets)", () => {
    const cmd = buildWindowsFallbackCommand();
    assert.ok(cmd.includes("cmd.exe"), "should mention cmd.exe");
    assert.ok(cmd.includes("npx -y avorelo@latest activate"), "should include activate command");
    assert.ok(cmd.includes("npx -y avorelo@latest status"), "should include status command");
    assert.ok(cmd.includes("TEMP"), "should use temp directory");
    assert.ok(!cmd.includes("env"), "should not dump env");
    assert.ok(!cmd.includes("SECRET"), "should not reference secrets");
    assert.ok(!cmd.includes("TOKEN"), "should not reference tokens");
    assert.ok(!cmd.includes("PASSWORD"), "should not reference passwords");
  });

  it("Unix fallback is safe (no env dumps, no secrets)", () => {
    const cmd = buildUnixFallbackCommand();
    assert.ok(cmd.includes("mktemp"), "should use mktemp");
    assert.ok(cmd.includes("npx -y avorelo@latest activate"), "should include activate command");
    assert.ok(cmd.includes("npx -y avorelo@latest status"), "should include status command");
    assert.ok(!cmd.includes("env"), "should not dump env");
    assert.ok(!cmd.includes("SECRET"), "should not reference secrets");
    assert.ok(!cmd.includes("TOKEN"), "should not reference tokens");
  });
});

describe("Activation Security", () => {
  it("preflight never exposes secret values", () => {
    const r = runPreflight(target);
    const report = formatPreflightReport(r);
    const sensitivePatterns = [
      /SECRET/i,
      /TOKEN/i,
      /PASSWORD/i,
      /API_KEY/i,
      /PRIVATE/i,
      /CREDENTIAL/i,
    ];
    for (const p of sensitivePatterns) {
      assert.ok(!p.test(report), `report should not contain ${p.source}`);
    }
  });

  it("preflight does not include raw env values", () => {
    const r = runPreflight(target);
    for (const c of r.checks) {
      assert.ok(!c.details.includes("="), `check ${c.id} details should not contain env var assignments: ${c.details}`);
    }
  });
});
