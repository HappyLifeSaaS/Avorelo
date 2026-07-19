// Telemetry closeout final-state guarantees: normal commands create no telemetry/onboarding artifact,
// legacy state is inert, and no telemetry runtime symbols ship. Uses the net-trap for attempt detection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CLI = join(import.meta.dirname, "..", "src", "avorelo", "surfaces", "cli", "avorelo.ts");
const TRAP = join(import.meta.dirname, "helpers", "net-trap.mjs");
const REPO = process.cwd();

function tmp(): string { return mkdtempSync(join(tmpdir(), "avorelo-final-")); }
function run(args: string[], dir: string) {
  const logPath = join(dir, "net-trap.log");
  const r = spawnSync(process.execPath, ["--import", "tsx", "--import", pathToFileURL(TRAP).href, CLI, ...args, "--target", dir],
    { cwd: REPO, env: { ...process.env, NET_TRAP_LOG: logPath }, encoding: "utf8", timeout: 60000 });
  const attempts = existsSync(logPath) ? readFileSync(logPath, "utf8").trim() : "";
  return { r, attempts };
}
function listAvorelo(dir: string): string[] {
  const base = join(dir, ".avorelo");
  return existsSync(base) ? (readdirSync(base, { recursive: true }) as string[]).map(String) : [];
}
function assertNoAnalyticsArtifact(dir: string, label: string) {
  for (const f of listAvorelo(dir)) {
    assert.ok(!/metrics|telemetry|onboarding|events\.jsonl|markers\.json|rollups/i.test(f),
      `${label} created a telemetry/onboarding artifact: ${f}`);
  }
}

for (const args of [["activate"], ["run", "--fixture", "complete-ready"], ["status"], ["doctor"], ["open"]]) {
  test(`no telemetry/onboarding artifact + no egress: avorelo ${args.join(" ")}`, () => {
    const dir = tmp();
    try {
      const { attempts } = run(args, dir);
      assertNoAnalyticsArtifact(dir, args.join(" "));
      assert.equal(attempts, "", `outbound attempt during '${args.join(" ")}':\n${attempts}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test("command finalization creates no event log", () => {
  const dir = tmp();
  try {
    run(["status"], dir);
    assert.ok(!existsSync(join(dir, ".avorelo", "metrics", "events.jsonl")));
    assert.ok(!existsSync(join(dir, ".avorelo", "onboarding", "markers.json")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("malformed legacy telemetry files do not crash normal commands and remain inert/unchanged", () => {
  const dir = tmp();
  try {
    mkdirSync(join(dir, ".avorelo", "metrics"), { recursive: true });
    const legacyPath = join(dir, ".avorelo", "metrics", "events.jsonl");
    const legacy = "{ not json\n{also bad}\n";
    writeFileSync(legacyPath, legacy);
    const { r } = run(["status"], dir);
    assert.notEqual(r.status, null, "status must not crash the runtime");
    assert.equal(readFileSync(legacyPath, "utf8"), legacy, "legacy telemetry file must remain unchanged/inert");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("legacy `telemetry` command is hidden and network-free", () => {
  const dir = tmp();
  try {
    const help = run(["--help"], dir).r.stdout ?? "";
    assert.ok(!/^\s+telemetry\b/m.test(help), "telemetry must not appear in help");
    const { attempts } = run(["telemetry"], dir);
    assert.equal(attempts, "", "legacy telemetry invocation must make no network attempt");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("active source + bundle contain no telemetry runtime symbols or marker state", () => {
  const cliSrc = readFileSync(CLI, "utf8");
  const bundle = readFileSync(join(REPO, "dist", "avorelo.mjs"), "utf8");
  const symbols = [
    "recordCliTelemetry", "sendDueTelemetry", "default_cloud", "/api/telemetry", "app.avorelo.com",
    "buildStoredTelemetryRollups", "firstOpenAt", "firstProductCommandAt", "markers.json", "local-markers",
  ];
  for (const s of symbols) {
    assert.ok(!cliSrc.includes(s), `CLI source must not contain ${s}`);
    assert.ok(!bundle.includes(s), `bundle must not contain ${s}`);
  }
});
