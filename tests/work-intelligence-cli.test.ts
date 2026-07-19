import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { runRuntimeSession } from "../src/avorelo/capabilities/runtime-flow/index.ts";

const CLI = join(import.meta.dirname, "..", "src", "avorelo", "surfaces", "cli", "avorelo.ts");
const NOW = Date.parse("2026-06-20T00:00:00.000Z");

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "avorelo-work-cli-"));
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

test("work latest returns the outcome receipt in json", () => {
  const dir = sandbox();
  try {
    runRuntimeSession({ task: "update the README quickstart wording", dir, createdAt: "2026-06-20T00:00:00.000Z", now: NOW });
    const result = runCli(["work", "latest", "--target", dir, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.outcomeStatus, "open");
    assert.equal(json.containsRawPrompt, false);
  } finally {
    cleanup(dir);
  }
});

test("work latest json redacts emails, remote URLs, env-style values, and absolute paths", () => {
  const dir = sandbox();
  try {
    runRuntimeSession({
      task: "refresh docs for alice@example.com using https://github.com/HappyLifeSaaS/Avorelo with API_TOKEN=abc123 from C:\\Users\\alice\\Secrets\\notes.txt",
      dir,
      createdAt: "2026-06-20T00:00:00.000Z",
      now: NOW,
    });
    const result = runCli(["work", "latest", "--target", dir, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const json = JSON.parse(result.stdout);
    const serialized = JSON.stringify(json);
    assert.ok(!serialized.includes("alice@example.com"));
    assert.ok(!serialized.includes("https://github.com/HappyLifeSaaS/Avorelo"));
    assert.ok(!serialized.includes("API_TOKEN=abc123"));
    assert.ok(!serialized.includes("C:\\Users\\alice\\Secrets\\notes.txt"));
    assert.equal(json.containsRawEnvValue, false);
    assert.ok(String(json.objectiveSummary).includes("[REDACTED:email]"));
  } finally {
    cleanup(dir);
  }
});

test("work resume-packet renders a Codex-safe packet", () => {
  const dir = sandbox();
  try {
    runRuntimeSession({ task: "update the README quickstart wording", dir, createdAt: "2026-06-20T00:00:00.000Z", now: NOW });
    const result = runCli(["work", "resume-packet", "--target", dir, "--agent", "codex"]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes("Codex resume packet"));
    assert.ok(result.stdout.includes("Safe next actions"));
  } finally {
    cleanup(dir);
  }
});

test("work hygiene aggregates artifact, receipt, and capability warnings with deterministic exit codes", () => {
  const dir = sandbox();
  try {
    runRuntimeSession({ task: "update generated-pages.ts homepage copy", dir, createdAt: "2026-06-20T00:00:00.000Z", now: NOW });
    const result = runCli(["work", "hygiene", "--target", dir, "--json"]);
    assert.equal(result.status, 1, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.ok(Array.isArray(json.artifact.warnings));
    assert.ok(json.artifact.warnings.some((warning: { code: string }) => warning.code === "GENERATED_OUTPUT_EDITED_AS_SOURCE"));
  } finally {
    cleanup(dir);
  }
});

test("work context-waste exits non-zero when waste warnings exist", () => {
  const dir = sandbox();
  try {
    runRuntimeSession({ task: "change billing webhook handler", dir, createdAt: "2026-06-20T00:00:00.000Z", now: NOW });
    const result = runCli(["work", "context-waste", "--target", dir]);
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stdout.includes("Context waste"));
  } finally {
    cleanup(dir);
  }
});

test("work latest rebuilds from canonical local truth when the cached summary is corrupted", () => {
  const dir = sandbox();
  try {
    runRuntimeSession({ task: "update the README quickstart wording", dir, createdAt: "2026-06-20T00:00:00.000Z", now: NOW });
    const wiDir = join(dir, ".avorelo", "work-intelligence");
    mkdirSync(wiDir, { recursive: true });
    writeFileSync(join(wiDir, "latest.json"), "{not-json");
    const result = runCli(["work", "latest", "--target", dir, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.containsRawPrompt, false);
    assert.ok(typeof json.objectiveSummary === "string" && json.objectiveSummary.length > 0);
  } finally {
    cleanup(dir);
  }
});
