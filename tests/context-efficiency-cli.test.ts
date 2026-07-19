import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const CLI = join(import.meta.dirname, "..", "src", "avorelo", "surfaces", "cli", "avorelo.ts");

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "avorelo-context-eff-cli-"));
}

function seedRepo(dir: string): void {
  mkdirSync(join(dir, "tests"), { recursive: true });
  mkdirSync(join(dir, "src", "avorelo", "surfaces", "public-web", "static"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "sandbox" }, null, 2));
  writeFileSync(join(dir, "tests", "context-efficiency.test.ts"), "test file");
  writeFileSync(join(dir, "tests", "context-efficiency-cli.test.ts"), "cli test file");
  writeFileSync(join(dir, "src", "avorelo", "surfaces", "public-web", "static", "pricing.html"), "<html></html>");
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

test("context brief creates a safe metadata-only JSON artifact", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const result = runCli(["context", "brief", "--target", dir, "--task", "update public web pricing page copy", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.contract, "avorelo.contextEfficiencyBrief.v1");
    assert.equal(json.containsRawPrompt, false);
    assert.equal(json.containsRawSource, false);
    assert.equal(json.contentStorageClass, "safe_metadata_only");
  } finally {
    cleanup(dir);
  }
});

test("context brief latest returns the persisted artifact", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const create = runCli(["context", "brief", "--target", dir, "--task", "fix src/avorelo/capabilities/context-efficiency/index.ts", "--json"]);
    assert.equal(create.status, 0, create.stderr);
    const latest = runCli(["context", "brief", "latest", "--target", dir, "--json"]);
    assert.equal(latest.status, 0, latest.stderr);
    const json = JSON.parse(latest.stdout);
    assert.equal(json.contract, "avorelo.contextEfficiencyBrief.v1");
    assert.equal(json.containsRawEnvValue, false);
  } finally {
    cleanup(dir);
  }
});

test("context brief check --path returns safe next action for one path", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const result = runCli(["context", "brief", "check", "--target", dir, "--path", "dist/site/index.html", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.contract, "avorelo.contextEfficiencyPathCheck.v1");
    assert.equal(json.recommendation, "exclude");
    assert.ok(String(json.safeNextAction).length > 0);
  } finally {
    cleanup(dir);
  }
});
