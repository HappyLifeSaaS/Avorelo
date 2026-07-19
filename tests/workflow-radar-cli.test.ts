import { execFileSync, spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = join(import.meta.dirname, "..", "src", "avorelo", "surfaces", "cli", "avorelo.ts");

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "avorelo-workflow-radar-cli-"));
}

function runGit(dir: string, args: string[]): void {
  execFileSync("git", args, { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
}

function seedRepo(dir: string): void {
  mkdirSync(join(dir, "src", "avorelo", "capabilities", "workflow-radar"), { recursive: true });
  mkdirSync(join(dir, "tests"), { recursive: true });
  mkdirSync(join(dir, "docs", "release"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "sandbox" }, null, 2));
  writeFileSync(join(dir, "src", "avorelo", "capabilities", "workflow-radar", "index.ts"), "export const workflowRadar = true;\n");
  writeFileSync(join(dir, "tests", "workflow-radar.test.ts"), "test\n");
  writeFileSync(join(dir, "tests", "workflow-radar-cli.test.ts"), "test\n");
  writeFileSync(join(dir, "docs", "release", "runbook.md"), "release\n");
  runGit(dir, ["init"]);
  runGit(dir, ["config", "user.email", "cli@example.com"]);
  runGit(dir, ["config", "user.name", "CLI"]);
  runGit(dir, ["add", "."]);
  runGit(dir, ["commit", "-m", "initial"]);
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

test("workflow radar creates a safe metadata-only persisted artifact", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    writeFileSync(join(dir, "src", "avorelo", "capabilities", "workflow-radar", "index.ts"), "export const workflowRadar = false;\n");
    const result = runCli(["workflow", "radar", "--target", dir, "--task", "update workflow radar capability", "--json"]);
    assert.equal(result.status, 1, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.contract, "avorelo.workflowRadar.v1");
    assert.equal(json.containsRawPrompt, false);
    assert.equal(json.containsProviderPayload, false);
    assert.equal(json.contentStorageClass, "safe_metadata_only");
  } finally {
    cleanup(dir);
  }
});

test("workflow radar latest returns the persisted artifact", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    writeFileSync(join(dir, "src", "avorelo", "capabilities", "workflow-radar", "index.ts"), "export const workflowRadar = false;\n");
    const create = runCli(["workflow", "radar", "--target", dir, "--task", "update workflow radar capability", "--json"]);
    assert.equal(create.status, 1, create.stderr);
    const latest = runCli(["workflow", "radar", "latest", "--target", dir, "--json"]);
    assert.equal(latest.status, 1, latest.stderr);
    const json = JSON.parse(latest.stdout);
    assert.equal(json.contract, "avorelo.workflowRadar.v1");
    assert.equal(json.containsRawEnvValue, false);
  } finally {
    cleanup(dir);
  }
});

test("workflow radar --from-context-brief consumes the existing brief", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    writeFileSync(join(dir, "src", "avorelo", "capabilities", "workflow-radar", "index.ts"), "export const workflowRadar = false;\n");
    const brief = runCli(["context", "brief", "--target", dir, "--task", "update workflow radar capability", "--json"]);
    assert.equal(brief.status, 0, brief.stderr);
    const result = runCli(["workflow", "radar", "--target", dir, "--from-context-brief", "--json"]);
    assert.equal(result.status, 1, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.contextBrief.source, "latest_brief");
  } finally {
    cleanup(dir);
  }
});

test("workflow radar check --path returns a safe path-level decision", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const result = runCli(["workflow", "radar", "check", "--target", dir, "--path", "docs/release/runbook.md", "--json"]);
    assert.equal(result.status, 1, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.contract, "avorelo.workflowRadarPathCheck.v1");
    assert.equal(json.recommendedNextAction, "stop_and_review");
    assert.ok(String(json.safeNextAction).length > 0);
  } finally {
    cleanup(dir);
  }
});
