// Community Edition package boundary (renamed from webhook-billing-boundary): proves the shipped
// package is local-first and hosted-free — no hosted production/dev dependencies, no hosted server
// imports, no DB/auth/billing transport in the bundle, legacy hosted env vars are inert, and the
// claim/sync/billing tombstones stay local and network-free.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CLI = join(import.meta.dirname, "..", "src", "avorelo", "surfaces", "cli", "avorelo.ts");
const TRAP = pathToFileURL(join(import.meta.dirname, "helpers", "net-trap.mjs")).href;
const REPO = process.cwd();

// Legacy hosted env (billing/webhook/auth/db) that must never be required or reactivate hosted behavior.
const HOSTED_ENV = [
  "LEMON_SQUEEZY_API_KEY", "LEMON_SQUEEZY_WEBHOOK_SECRET", "LEMON_SQUEEZY_STORE_ID", "LEMON_SQUEEZY_MODE",
  "LEMON_SQUEEZY_PRO_CHECKOUT_URL", "LEMON_SQUEEZY_CUSTOMER_PORTAL_URL",
  "AUTH_SECRET", "DATABASE_URL", "APP_BASE_URL", "WEBHOOK_SERVER_PORT",
];

function tmp() { return mkdtempSync(join(tmpdir(), "avorelo-pkgbound-")); }
function run(args: string[], dir: string, env: Record<string, string | undefined> = {}) {
  const logPath = join(dir, "trap.log");
  const merged = { ...process.env, NET_TRAP_LOG: logPath, ...env };
  const r = spawnSync(process.execPath, ["--import", "tsx", "--import", TRAP, CLI, ...args, "--target", dir],
    { cwd: REPO, env: merged, encoding: "utf8", timeout: 60000 });
  const attempts = existsSync(logPath) ? readFileSync(logPath, "utf8").trim() : "";
  return { r, attempts, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
}
function strippedEnv(): Record<string, string | undefined> {
  const e: Record<string, string | undefined> = {};
  for (const k of HOSTED_ENV) e[k] = undefined;
  return e;
}

test("1+2. no hosted server command: absent from help and inert on direct invocation", () => {
  const dir = tmp();
  try {
    const help = run(["--help"], dir).out;
    assert.ok(!/webhook/i.test(help), "no webhook command in help");
    const wh = run(["webhook"], dir);
    assert.ok(/AI Work Control|Commands|init \[/i.test(wh.out), "unknown command falls through to help");
    assert.equal(wh.attempts, "", "starts no server / makes no attempt");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("3+4. an inert invocation (--help) binds no port, starts no server, makes no network/client init", () => {
  const dir = tmp();
  try {
    const { attempts } = run(["--help"], dir);
    assert.equal(attempts, "", `--help attempted server/network: ${attempts}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("5. normal commands work with ALL billing/webhook/auth/db env absent", () => {
  const dir = tmp();
  try {
    for (const cmd of [["status"], ["doctor"], ["activate"]]) {
      const { r, attempts } = run(cmd, dir, strippedEnv());
      assert.notEqual(r.status, null, `${cmd[0]} crashed`);
      assert.equal(attempts, "", `${cmd[0]} attempted server/network`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("6. setting legacy webhook/billing/db env vars does NOT reactivate hosted behavior", () => {
  const dir = tmp();
  try {
    const env: Record<string, string> = {};
    for (const k of HOSTED_ENV) env[k] = "x-should-be-ignored";
    const { r, attempts, out } = run(["status"], dir, env);
    assert.notEqual(r.status, null);
    assert.equal(attempts, "", "hosted env must not start a server or trigger a request");
    assert.ok(!/webhook server|lemon|checkout/i.test(out), "no hosted behavior surfaced");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("7. claim/sync/billing tombstones remain network-free", () => {
  const dir = tmp();
  try {
    for (const cmd of ["claim", "sync", "billing"]) {
      const { attempts, out } = run([cmd], dir);
      assert.equal(attempts, "", `${cmd} tombstone must be network-free`);
      assert.ok(/discontinued/i.test(out), `${cmd} tombstone message`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("8+9. bundle contains no hosted server / DB / auth / billing transport symbols", () => {
  const bundle = readFileSync(join(REPO, "dist", "avorelo.mjs"), "utf8");
  for (const s of ["serveWebhook", "handleWebhook", "webhook-server", "api.lemonsqueezy.com",
    "verifyWebhookSignature", "api/webhooks/lemon", "createCheckout", "customer-portal", "checkout-api",
    "getDb", "drizzle-orm", "better-auth", "app.avorelo.com"]) {
    assert.equal((bundle.match(new RegExp(s.replace(/[.]/g, "\\."), "g")) ?? []).length, 0, `bundle must not contain ${s}`);
  }
});

test("10. shipped package has no hosted dependencies (only the esbuild/tsx build toolchain)", () => {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  assert.deepEqual(pkg.dependencies ?? {}, {}, "no production dependencies");
  // The hosted stack (hono / better-auth / drizzle / postgres) must be gone from BOTH lists.
  const dev = pkg.devDependencies ?? {};
  for (const d of ["hono", "@hono/node-server", "better-auth", "drizzle-orm", "drizzle-kit", "postgres"]) {
    assert.ok(!(d in dev), `${d} must not be a dependency of Community Edition`);
  }
  // Only the local build/test toolchain remains as dev-only.
  assert.deepEqual(Object.keys(dev).sort(), ["esbuild", "tsx"], "only esbuild + tsx remain as devDependencies");
});
