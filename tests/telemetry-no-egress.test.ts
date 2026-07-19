// Commit 1 (C3): command finalization performs NO outbound network attempt.
// Uses the net-trap preload, which records attempts even when swallowed by a catch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CLI = join(import.meta.dirname, "..", "src", "avorelo", "surfaces", "cli", "avorelo.ts");
const TRAP = join(import.meta.dirname, "helpers", "net-trap.mjs");
const REPO = process.cwd();

function runTrapped(args: string[], target: string) {
  const logPath = join(target, "net-trap.log");
  const r = spawnSync(process.execPath, ["--import", "tsx", "--import", pathToFileURL(TRAP).href, CLI, ...args, "--target", target], {
    cwd: REPO, env: { ...process.env, NET_TRAP_LOG: logPath }, encoding: "utf8", timeout: 60000,
  });
  const attempts = existsSync(logPath) ? readFileSync(logPath, "utf8").trim() : "";
  return { r, attempts };
}

// Includes the "default_cloud" env that previously drove telemetry POSTs — must still make no attempt.
for (const args of [["status"], ["doctor"], ["activate"], ["open"]]) {
  test(`finalization makes no outbound attempt: avorelo ${args.join(" ")}`, () => {
    const dir = mkdtempSync(join(tmpdir(), "avorelo-egress-"));
    try {
      const { attempts } = runTrapped(args, dir);
      assert.equal(attempts, "", `outbound attempt(s) during '${args.join(" ")}':\n${attempts}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test("the telemetry subsystem no longer exists in the source tree", () => {
  // Stronger than "no cloud endpoint": the whole telemetry client + server stack was
  // removed in Milestone D (it had no CE runtime consumer). There is nothing to configure.
  for (const p of ["src/avorelo/telemetry", "src/avorelo/server/telemetry"]) {
    assert.equal(existsSync(join(REPO, p)), false, `${p} must not exist`);
  }
});
