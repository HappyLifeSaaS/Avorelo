// Community Edition contract: one open local-capability model. No payment/account/cloud gating.
// B4: supported commands work with ALL billing/auth/cloud env vars absent — no plan/login/entitlement.
// B2: pre-existing legacy entitlement artifacts are tolerated (ignored) without crashing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { open } from "../src/avorelo/capabilities/local-dashboard/index.ts";
import { buildControlCenter } from "../src/avorelo/capabilities/control-center/index.ts";

const CLI = join(import.meta.dirname, "..", "src", "avorelo", "surfaces", "cli", "avorelo.ts");

// Every billing/auth/cloud/telemetry variable that exists anywhere in the repo.
const STRIP = [
  "APP_BASE_URL", "AUTH_SECRET", "DATABASE_URL", "API_KEY", "CORS_ORIGINS", "WEBHOOK_SERVER_PORT",
  "AVORELO_TELEMETRY", "AVORELO_TELEMETRY_ENDPOINT",
  "LEMON_SQUEEZY_API_KEY", "LEMON_SQUEEZY_MODE", "LEMON_SQUEEZY_STORE_ID", "LEMON_SQUEEZY_WEBHOOK_SECRET",
  "LEMON_SQUEEZY_PRO_CHECKOUT_URL", "LEMON_SQUEEZY_CUSTOMER_PORTAL_URL",
  "LEMON_SQUEEZY_PRO_MONTHLY_VARIANT_ID", "LEMON_SQUEEZY_PRO_YEARLY_VARIANT_ID",
  "LEMON_SQUEEZY_TEAMS_MONTHLY_VARIANT_ID", "LEMON_SQUEEZY_TEAMS_YEARLY_VARIANT_ID",
];

const FORBIDDEN = [
  "Upgrade to Pro", "Subscription required", "Sign in to continue", "Link your account",
  "Start checkout", "Customer portal", "Manage subscription", "Current plan", "Billing settings",
  "app.avorelo.com", "/api/billing",
];

function cleanEnv(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...process.env };
  for (const k of STRIP) delete e[k];
  return e;
}

const REPO = process.cwd(); // run from repo root so the `tsx` loader resolves
function runCli(args: string[], target: string) {
  return spawnSync(process.execPath, ["--import", "tsx", CLI, ...args, "--target", target], {
    cwd: REPO, env: cleanEnv(), encoding: "utf8", timeout: 60000,
  });
}

function withTmp(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "avorelo-ce-"));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("B4: supported commands run with no billing/auth/cloud env and surface no plan/login", () => {
  withTmp((dir) => {
    for (const args of [["--help"], ["status"], ["doctor"], ["control-center"], ["capabilities"], ["open"]]) {
      const r = runCli(args, dir);
      const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
      assert.notEqual(r.status, null, `command ${args[0]} did not crash the runtime`);
      for (const phrase of FORBIDDEN) {
        assert.ok(!out.includes(phrase), `command '${args.join(" ")}' surfaced forbidden text: ${phrase}`);
      }
      assert.ok(!/subscription (required|missing|not found)/i.test(out), `${args[0]} reported subscription problem`);
    }
  });
});

test("B4: discontinued claim/sync/billing give accurate, network-free tombstones", () => {
  const expected: Record<string, string> = {
    claim: "account linking has been discontinued",
    sync: "cloud sync has been discontinued",
    billing: "hosted billing has been discontinued",
  };
  withTmp((dir) => {
    for (const cmd of ["claim", "sync", "billing"]) {
      const r = runCli([cmd], dir);
      const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
      assert.ok(out.includes(expected[cmd]), `${cmd} must name its discontinued service: ${expected[cmd]}`);
      // No reactivation / cloud / network language.
      for (const phrase of ["Sign in", "log in", "login", "Upgrade", "checkout", "app.avorelo.com", "/api/", "link your account", "subscribe"]) {
        assert.ok(!out.toLowerCase().includes(phrase.toLowerCase()), `${cmd} leaked reactivation text: ${phrase}`);
      }
    }
  });
});

test("B3: claim/sync/billing are hidden from --help", () => {
  withTmp((dir) => {
    const help = `${runCli(["--help"], dir).stdout ?? ""}`;
    for (const cmd of ["claim", "sync", "billing"]) {
      assert.ok(!new RegExp(`^\\s+${cmd}\\b`, "m").test(help), `${cmd} must not appear in help`);
    }
  });
});

test("B4: open + control-center write no entitlement/subscription artifact", () => {
  withTmp((dir) => {
    open(dir, { now: 1_700_000_000_000 });
    buildControlCenter(dir, { now: 1_700_000_000_000 });
    const avoreloDir = join(dir, ".avorelo");
    const files = existsSync(avoreloDir) ? readdirSync(avoreloDir, { recursive: true }) as string[] : [];
    for (const f of files) {
      assert.ok(!/subscription|entitlement|billing|claim/i.test(String(f)), `wrote hosted artifact: ${f}`);
    }
  });
});

test("B2: pre-existing legacy entitlement artifacts are tolerated (Pro/expired/linked/malformed)", () => {
  const legacy: Record<string, string> = {
    "subscription.json": JSON.stringify({ plan: "pro", status: "active", effectivePlan: "pro" }),
    "subscription-expired.json": JSON.stringify({ plan: "pro", status: "expired", endsAt: "2020-01-01" }),
    "claim.json": JSON.stringify({ workspaceId: "ws_legacy", claimedAt: "2020-01-01", source: "cli_claim" }),
    "subscription-malformed.json": "{ this is : not json",
  };
  for (const [name, content] of Object.entries(legacy)) {
    withTmp((dir) => {
      mkdirSync(join(dir, ".avorelo"), { recursive: true });
      writeFileSync(join(dir, ".avorelo", name), content);
      // Must not throw, and must produce the open model (no entitlement section).
      const r = open(dir, { now: 1_700_000_000_000 });
      assert.ok(r.ok);
      assert.ok(!("entitlementSource" in r), "no entitlementSource field");
      const cc = buildControlCenter(dir, { now: 1_700_000_000_000 });
      assert.equal((cc.sections as Record<string, unknown>).entitlementGate, undefined);
    });
  }
});

test("B2: missing snapshot behaves identically (open model, no crash)", () => {
  withTmp((dir) => {
    const r = open(dir, { now: 1_700_000_000_000 });
    assert.ok(r.ok);
    assert.ok(!("entitlementSource" in r), "no entitlementSource field");
  });
});
