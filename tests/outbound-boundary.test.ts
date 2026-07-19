// Commit 10 (final outbound boundary): the allowed-egress matrix, enforced by the network trap.
//
//   A. Normal local operations  → ZERO outbound attempts (init/activate/start/status/doctor/run/
//      resume/hooks/viewer/control-center/receipt-gen/context/proof/finalization + module init).
//   B. Explicit public npm update check → exactly one bounded GET to the fixed npm registry URL.
//   C. Explicit user-directed browser visual QA → classified separately (see browser-qa-boundary).
//   D. Links printed to the user (GitHub/npm/docs) are NOT network attempts.
//
// The trap (tests/helpers/net-trap.mjs) is preloaded via --import, so import-time/module-init
// attempts are caught, and it records fetch/undici/http/https/net.connect/tls.connect plus
// network-capable child processes (curl/wget/PowerShell-web/npm-install/npx) even when caught.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CLI = join(import.meta.dirname, "..", "src", "avorelo", "surfaces", "cli", "avorelo.ts");
const TRAP = pathToFileURL(join(import.meta.dirname, "helpers", "net-trap.mjs")).href;
const REPO = process.cwd();
const REGISTRY_URL = "https://registry.npmjs.org/avorelo/latest";

function tmp() { return mkdtempSync(join(tmpdir(), "avorelo-egress-")); }
function cleanup(dir: string) { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); }

let logCounter = 0;
// Run the CLI with the trap loaded, in workspace `dir`, with per-invocation trap logs.
function run(args: string[], dir: string) {
  const logPath = join(dir, `trap.${logCounter}.log`);
  const childLog = join(dir, `child.${logCounter}.log`);
  logCounter++;
  const env = { ...process.env, NET_TRAP_LOG: logPath, NET_TRAP_CHILD_LOG: childLog };
  const r = spawnSync(process.execPath, ["--import", "tsx", "--import", TRAP, CLI, ...args, "--target", dir],
    { cwd: REPO, env, encoding: "utf8", timeout: 90000 });
  const attempts = existsSync(logPath) ? readFileSync(logPath, "utf8").trim() : "";
  const children = existsSync(childLog) ? readFileSync(childLog, "utf8").trim() : "";
  return { r, attempts, children, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
}

function newWorkspace() {
  const dir = tmp();
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "egress-fixture", scripts: { test: "echo ok" } }));
  return dir;
}

// One activated workspace shared by the read-only operations (fast: 2 setup spawns total).
let shared: string;
before(() => {
  shared = newWorkspace();
  run(["init"], shared);
  run(["activate"], shared);
});
after(() => cleanup(shared));

function assertZeroEgress(label: string, attempts: string, children: string) {
  assert.equal(attempts, "", `${label} must make no outbound attempt, got:\n${attempts}`);
  assert.ok(!/curl|wget|invoke-webrequest|npm (install|ci|i |add)|npx /i.test(children),
    `${label} spawned a network child:\n${children}`);
}

// Read-only operations run against the shared activated workspace.
const READONLY_OPS: Array<[string, string[]]> = [
  ["module init (no command)", []],
  ["status", ["status"]],
  ["doctor", ["doctor"]],
  ["resume", ["resume"]],
  ["hooks (lifecycle-hook)", ["lifecycle-hook"]],
  ["viewer (open)", ["open", "--format", "json"]],
  ["control-center", ["control-center", "--json"]],
  ["receipt/report (proof)", ["report", "--json"]],
  ["context", ["context", "status", "--json"]],
  ["proof (prove)", ["prove", "--json"]],
  ["readiness", ["readiness", "--json"]],
  ["settings show", ["settings", "show", "--json"]],
];

for (const [label, args] of READONLY_OPS) {
  test(`Category A — ${label}: zero outbound attempts`, () => {
    const { attempts, children } = run(args, shared);
    assertZeroEgress(label, attempts, children);
  });
}

// State-mutating operations each get a fresh workspace.
const MUTATING_OPS: Array<[string, string[]]> = [
  ["init", ["init"]],
  ["activate", ["activate"]],
  ["start", ["start", "--objective", "tidy the readme"]],
  ["run", ["run", "update the readme quickstart"]],
];

for (const [label, args] of MUTATING_OPS) {
  test(`Category A — ${label}: zero outbound attempts`, () => {
    const dir = newWorkspace();
    try {
      const { attempts, children } = run(args, dir);
      assertZeroEgress(label, attempts, children);
    } finally { cleanup(dir); }
  });
}

// --- Category B: explicit update check is the one allowed egress, to the fixed npm URL ---

test("Category B — update-check attempts exactly one GET to the fixed npm registry URL", () => {
  const { attempts } = run(["update-check"], shared);
  const lines = attempts.split("\n").filter(Boolean);
  assert.equal(lines.length, 1, `exactly one attempt expected, got:\n${attempts}`);
  assert.ok(lines[0].startsWith("fetch "), `must be a fetch, got: ${lines[0]}`);
  assert.ok(lines[0].includes(REGISTRY_URL), `must target the fixed npm URL, got: ${lines[0]}`);
  assert.ok(!/app\.avorelo\.com|railway|lemonsqueezy|dogfood/i.test(lines[0]), "no hosted origin");
});

test("Category B — update-check reports honestly on network denial (terminates, no crash)", () => {
  const { r } = run(["update-check"], shared);
  assert.notEqual(r.status, null, "command should terminate, not hang");
});

// --- Category D: printing a URL is not a network attempt ---

test("Category D — support bundle prints GitHub/SECURITY links without any outbound attempt", () => {
  const { attempts, out } = run(["support", "bundle"], shared);
  assert.equal(attempts, "", `printing links must not fetch, got:\n${attempts}`);
  assert.ok(out.includes("github.com/HappyLifeSaaS/Avorelo"), "a link was printed");
});

// --- Explicit guarantee: no learning uplink env reactivates egress ---

test("no dogfood-learning endpoint/alpha-key env can reactivate an uplink", () => {
  const logPath = join(shared, "learning-env-trap.log");
  const env = {
    ...process.env,
    NET_TRAP_LOG: logPath,
    AVORELO_DOGFOOD_LEARNING_ENDPOINT: "https://app.avorelo.com/api/learning",
    AVORELO_DOGFOOD_ALPHA_KEY: "should-be-ignored",
  };
  const r = spawnSync(process.execPath, ["--import", "tsx", "--import", TRAP, CLI, "status", "--target", shared],
    { cwd: REPO, env, encoding: "utf8", timeout: 90000 });
  const attempts = existsSync(logPath) ? readFileSync(logPath, "utf8").trim() : "";
  assert.equal(attempts, "", `learning env must not reactivate any uplink, got:\n${attempts}`);
  assert.equal(r.status, 0);
});
