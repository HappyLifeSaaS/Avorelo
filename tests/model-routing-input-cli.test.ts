import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const CLI = join(import.meta.dirname, "..", "src", "avorelo", "surfaces", "cli", "avorelo.ts");

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "avorelo-model-routing-input-cli-"));
}

function seedRepo(dir: string): void {
  mkdirSync(join(dir, "tests"), { recursive: true });
  mkdirSync(join(dir, "src", "avorelo", "capabilities", "model-routing-input"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "sandbox" }, null, 2));
  writeFileSync(join(dir, "tests", "model-routing-input.test.ts"), "test file");
  writeFileSync(join(dir, "tests", "model-routing-input-cli.test.ts"), "cli test file");
  writeFileSync(join(dir, "src", "avorelo", "capabilities", "model-routing-input", "index.ts"), "export const ok = true;\n");
}

function cleanup(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, AVORELO_TELEMETRY: "off" },
  });
}

test("model route creates a safe metadata-only persisted profile", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const result = runCli(["model", "route", "--target", dir, "--task", "add metadata-only model routing profile support", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.contract, "avorelo.modelRoutingInputProfile.v1");
    assert.equal(json.containsRawPrompt, false);
    assert.equal(json.containsProviderPayload, false);
    assert.equal(json.contentStorageClass, "safe_metadata_only");
  } finally {
    cleanup(dir);
  }
});

test("model route latest returns the persisted artifact", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const create = runCli(["model", "route", "--target", dir, "--task", "add metadata-only model routing profile support", "--json"]);
    assert.equal(create.status, 0, create.stderr);
    const latest = runCli(["model", "route", "latest", "--target", dir, "--json"]);
    assert.equal(latest.status, 0, latest.stderr);
    const json = JSON.parse(latest.stdout);
    assert.equal(json.contract, "avorelo.modelRoutingInputProfile.v1");
    assert.equal(json.containsRawEnvValue, false);
  } finally {
    cleanup(dir);
  }
});

test("model route --from-context-brief consumes the existing context brief", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const brief = runCli(["context", "brief", "--target", dir, "--task", "add metadata-only model routing profile support", "--json"]);
    assert.equal(brief.status, 0, brief.stderr);
    const result = runCli(["model", "route", "--target", dir, "--from-context-brief", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.taskSource, "context_efficiency_latest");
    assert.equal(json.contextEfficiency.source, "latest_brief");
  } finally {
    cleanup(dir);
  }
});

test("model route check --path returns a safe path-level decision", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const result = runCli(["model", "route", "check", "--target", dir, "--path", "dist/site/index.html", "--json"]);
    assert.equal(result.status, 1, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.contract, "avorelo.modelRoutingInputPathCheck.v1");
    assert.equal(json.recommendedMode, "blocked_needs_decision");
    assert.ok(String(json.safeNextAction).length > 0);
  } finally {
    cleanup(dir);
  }
});
