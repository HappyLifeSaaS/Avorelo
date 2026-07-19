// Commit 10: the isolated-consumer activation gate. `avorelo activate` previously exited 1 with no
// output because a leftover `state.billing.status` reference (billing was removed in the entitlement
// cleanup) threw during the final print. This locks in: activation succeeds deterministically,
// writes valid local state, and makes zero outbound attempts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CLI = join(import.meta.dirname, "..", "src", "avorelo", "surfaces", "cli", "avorelo.ts");
const TRAP = pathToFileURL(join(import.meta.dirname, "helpers", "net-trap.mjs")).href;
const REPO = process.cwd();

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "avorelo-activate-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", scripts: { test: "echo ok" } }));
  return dir;
}
function cleanup(dir: string) { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); }

function activate(dir: string, withTrap: boolean, extra: string[] = []) {
  const logPath = join(dir, "trap.log");
  const importArgs = withTrap ? ["--import", "tsx", "--import", TRAP] : ["--import", "tsx"];
  const env = withTrap ? { ...process.env, NET_TRAP_LOG: logPath } : process.env;
  const r = spawnSync(process.execPath, [...importArgs, CLI, "activate", "--target", dir, ...extra],
    { cwd: REPO, env, encoding: "utf8", timeout: 90000 });
  const attempts = existsSync(logPath) ? readFileSync(logPath, "utf8").trim() : "";
  return { r, attempts, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
}

test("activate succeeds deterministically (exit 0) and reports activation", () => {
  const dir = workspace();
  try {
    const { r, out } = activate(dir, false);
    assert.equal(r.status, 0, `activate must exit 0, got ${r.status}:\n${out}`);
    assert.ok(out.includes("Avorelo activated"), "prints activation summary");
    assert.ok(out.includes("Production: not ready"), "reports honest production state");
  } finally { cleanup(dir); }
});

test("activate writes valid local activation state and a receipt", () => {
  const dir = workspace();
  try {
    activate(dir, false);
    const statePath = join(dir, ".avorelo", "activation", "activation-state.json");
    assert.ok(existsSync(statePath), "activation state written");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.contract, "avorelo.activationState.v2");
    assert.equal(state.productionReady, false);
    assert.equal(state.activationMode, "local-first/free");
    // Billing was removed: no billing field should resurface in the persisted state.
    assert.ok(!("billing" in state), "no billing field in CE activation state");
    assert.ok(existsSync(join(dir, ".avorelo", "receipts")), "receipts dir created");
  } finally { cleanup(dir); }
});

test("activate is idempotent — a second run also exits 0", () => {
  const dir = workspace();
  try {
    assert.equal(activate(dir, false).r.status, 0);
    assert.equal(activate(dir, false).r.status, 0, "re-activation must also succeed");
  } finally { cleanup(dir); }
});

test("activate makes zero outbound network attempts", () => {
  const dir = workspace();
  try {
    const { r, attempts } = activate(dir, true);
    assert.equal(r.status, 0, "activate exits 0 under the network trap");
    assert.equal(attempts, "", `activation must make no outbound attempt, got:\n${attempts}`);
  } finally { cleanup(dir); }
});

test("activate output shows no billing/auth/subscription/plan advisory", () => {
  const dir = workspace();
  try {
    const { out } = activate(dir, false);
    for (const term of ["Missing: Billing env", "Missing: Auth env", "Billing:", "Auth:", "Cloud:", "Subscription", "Upgrade to Pro", "Current plan"]) {
      assert.ok(!out.includes(term), `activate output must not contain "${term}"`);
    }
  } finally { cleanup(dir); }
});

test("legacy billing/auth env vars do not change activation exit or output", () => {
  const a = workspace();
  const b = workspace();
  try {
    const plain = activate(a, false);
    const withEnv = spawnSync(process.execPath, ["--import", "tsx", CLI, "activate", "--target", b],
      { cwd: REPO, encoding: "utf8", timeout: 90000, env: {
        ...process.env,
        LEMON_SQUEEZY_API_KEY: "sk_test_should_be_ignored",
        LEMON_SQUEEZY_PRO_CHECKOUT_URL: "https://example.com/x",
        AUTH_SECRET: "ignored", DATABASE_URL: "postgres://ignored",
      } });
    assert.equal(withEnv.status, plain.r.status, "exit code unchanged by hosted env");
    // Neither run advertises a billing/auth env advisory.
    assert.ok(!/Billing env|Auth env|checkout|subscription/i.test(withEnv.stdout ?? ""), "no hosted advisory with env set");
  } finally { cleanup(a); cleanup(b); }
});

test("status output shows no billing/auth/cloud/plan lines after activation", () => {
  const dir = workspace();
  try {
    activate(dir, false);
    const r = spawnSync(process.execPath, ["--import", "tsx", CLI, "status", "--target", dir],
      { cwd: REPO, encoding: "utf8", timeout: 90000 });
    const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
    for (const term of ["billing:", "auth:", "cloud:", "plan:", "subscription", "entitlement"]) {
      assert.ok(!out.toLowerCase().includes(term), `status must not contain "${term}"`);
    }
  } finally { cleanup(dir); }
});

test("malformed legacy activation state does not crash activate (CLI)", () => {
  const dir = workspace();
  try {
    mkdirSync(join(dir, ".avorelo", "activation"), { recursive: true });
    writeFileSync(join(dir, ".avorelo", "activation", "activation-state.json"),
      JSON.stringify({ contract: "avorelo.activationState.v2", plan: "pro", entitlement: "garbage", billing: { x: 1 } }));
    const { r } = activate(dir, false);
    assert.equal(r.status, 0, "activate tolerates malformed legacy state");
  } finally { cleanup(dir); }
});
