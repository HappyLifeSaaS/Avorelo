import { execFileSync, spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = join(import.meta.dirname, "..", "src", "avorelo", "surfaces", "cli", "avorelo.ts");

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "avorelo-session-continuity-cli-"));
}

function runGit(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function seedRepo(dir: string): void {
  mkdirSync(join(dir, "src", "avorelo", "capabilities", "workflow-radar"), { recursive: true });
  mkdirSync(join(dir, "tests"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "sandbox" }, null, 2));
  writeFileSync(join(dir, "src", "avorelo", "capabilities", "workflow-radar", "index.ts"), "export const workflowRadar = true;\n");
  writeFileSync(join(dir, "tests", "session-continuity.test.ts"), "test\n");
  writeFileSync(join(dir, "tests", "session-continuity-cli.test.ts"), "test\n");
  runGit(dir, ["init"]);
  runGit(dir, ["config", "user.email", "cli@example.com"]);
  runGit(dir, ["config", "user.name", "CLI"]);
  runGit(dir, ["add", "."]);
  runGit(dir, ["commit", "-m", "initial"]);
  const planningBase = runGit(dir, ["rev-parse", "HEAD"]);
  runGit(dir, ["checkout", "-b", "feature/session-continuity-smart-handoff"]);
  runGit(dir, ["update-ref", "refs/remotes/origin/planning/architecture-approval-v1", planningBase]);
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

test("session handoff creates a safe metadata-only JSON artifact", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    writeFileSync(join(dir, "src", "avorelo", "capabilities", "workflow-radar", "index.ts"), "export const workflowRadar = false;\n");
    const result = runCli(["session", "handoff", "--target", dir, "--task", "add session continuity handoff", "--json"]);
    assert.equal(result.status, 1, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.contract, "avorelo.sessionContinuityHandoff.v1");
    assert.equal(json.containsRawPrompt, false);
    assert.equal(json.containsFullTranscript, false);
    assert.equal(json.contentStorageClass, "safe_metadata_only");
  } finally {
    cleanup(dir);
  }
});

test("session handoff latest returns the persisted artifact", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    writeFileSync(join(dir, "src", "avorelo", "capabilities", "workflow-radar", "index.ts"), "export const workflowRadar = false;\n");
    const create = runCli(["session", "handoff", "--target", dir, "--task", "add session continuity handoff", "--json"]);
    assert.equal(create.status, 1, create.stderr);
    const latest = runCli(["session", "handoff", "latest", "--target", dir, "--json"]);
    assert.equal(latest.status, 1, latest.stderr);
    const json = JSON.parse(latest.stdout);
    assert.equal(json.contract, "avorelo.sessionContinuityHandoff.v1");
    assert.equal(json.containsRawEnvValue, false);
  } finally {
    cleanup(dir);
  }
});

test("session handoff --from-workflow-radar consumes the existing assessment", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    writeFileSync(join(dir, "src", "avorelo", "capabilities", "workflow-radar", "index.ts"), "export const workflowRadar = false;\n");
    const radar = runCli(["workflow", "radar", "--target", dir, "--task", "add session continuity handoff", "--json"]);
    assert.equal(radar.status, 1, radar.stderr);
    const result = runCli(["session", "handoff", "--target", dir, "--from-workflow-radar", "--json"]);
    assert.equal(result.status, 1, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.workflowRadar.source, "latest_assessment");
  } finally {
    cleanup(dir);
  }
});

test("session handoff can print the continuation prompt in text mode", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const result = runCli(["session", "handoff", "--target", dir, "--task", "summarize current workstream", "--include-continuation-prompt"]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes("Continuation prompt:"));
    assert.ok(result.stdout.includes("Use branch: feature/session-continuity-smart-handoff"));
  } finally {
    cleanup(dir);
  }
});

test("session handoff check --path returns a safe path-level decision", () => {
  const dir = sandbox();
  try {
    seedRepo(dir);
    const result = runCli(["session", "handoff", "check", "--target", dir, "--path", "dist/site/index.html", "--json"]);
    assert.equal(result.status, 1, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.contract, "avorelo.sessionContinuityPathCheck.v1");
    assert.equal(json.category, "generated_output");
    assert.equal(json.doNotTouch, true);
  } finally {
    cleanup(dir);
  }
});
