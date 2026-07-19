import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const CLI = join(import.meta.dirname, "..", "src", "avorelo", "surfaces", "cli", "avorelo.ts");
const FIXTURES = join(import.meta.dirname, "..", "fixtures", "browser-visual-qa", "good");

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "avorelo-browser-cli-"));
}

function cleanup(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

function runCli(args: string[], dir: string) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      AVORELO_FAKE_BROWSER_QA: "1",
      AVORELO_TELEMETRY: "off",
    },
    cwd: dir,
  });
}

test("browser qa run persists safe metadata and latest/explain read it back", () => {
  const dir = sandbox();
  try {
    const run = runCli(["browser", "qa", "run", "--target", dir, "--browser-target", FIXTURES, "--route", "/", "--json"], dir);
    assert.equal(run.status, 0, run.stderr);
    const json = JSON.parse(run.stdout);
    assert.equal(json.contract, "avorelo.browserVisualQa.v1");
    assert.equal(json.containsRawHtml, false);

    const latest = runCli(["browser", "qa", "latest", "--target", dir, "--json"], dir);
    assert.equal(latest.status, 0, latest.stderr);
    const latestJson = JSON.parse(latest.stdout);
    assert.equal(latestJson.routesChecked, 1);

    const explain = runCli(["visual", "qa", "explain", "--target", dir], dir);
    assert.equal(explain.status, 0, explain.stderr);
    assert.ok(explain.stdout.includes("Browser QA decision"));
    assert.ok(explain.stdout.includes("Next:"));
  } finally {
    cleanup(dir);
  }
});
