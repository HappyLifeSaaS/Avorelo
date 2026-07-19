// Commit 11: Community Edition tolerantly reads legacy local artifacts that carry old hosted fields
// (plan / subscription / entitlement / billing / auth / linked account). It must never crash, never
// render or act on those fields, and never copy them into newly generated state. Absence is the schema.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runFullActivation, persistActivationV2 } from "../src/avorelo/capabilities/activation/activation-runner.ts";
import { open } from "../src/avorelo/capabilities/local-dashboard/index.ts";
import { buildControlCenter } from "../src/avorelo/capabilities/control-center/index.ts";

const NOW = 1_700_000_000_000;
const HOSTED_KEYS = ["billing", "auth", "cloud", "plan", "planTier", "subscription", "entitlement", "entitlementSource", "linkedAccount", "cloudWorkspace"];

function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "avorelo-legacy-"));
  mkdirSync(join(dir, ".avorelo", "activation"), { recursive: true });
  mkdirSync(join(dir, ".avorelo", "receipts"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", scripts: { test: "echo ok" } }));
  return dir;
}
function cleanup(dir: string) { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); }
function writeLegacyState(dir: string, extra: Record<string, unknown>) {
  writeFileSync(join(dir, ".avorelo", "activation", "activation-state.json"),
    JSON.stringify({ contract: "avorelo.activationState.v2", workspaceId: "ws_legacy", ...extra }));
}

// Representative legacy artifacts, each carrying hosted fields CE no longer understands.
const LEGACY_FIXTURES: Array<[string, Record<string, unknown>]> = [
  ["Pro plan", { plan: "pro", planTier: "Pro", entitlement: { plan: "pro", features: ["teams"] } }],
  ["Free plan", { plan: "free", planTier: "Free", entitlement: { plan: "free" } }],
  ["expired subscription", { subscription: { status: "expired", renewsAt: null } }],
  ["active subscription", { subscription: { status: "active", plan: "pro" } }],
  ["linked account", { linkedAccount: { email: "old@example.com", userId: "u_123" }, auth: { status: "CONNECTED" } }],
  ["billing env detected", { billing: { status: "READY", checkoutAvailable: true } }],
  ["auth env detected", { auth: { status: "CONNECTED_LOCAL", sessionAvailable: true } }],
  ["entitlement snapshot", { entitlement: { plan: "pro", source: "lemon_squeezy", allowedFeatures: ["a", "b"] } }],
  ["malformed entitlement", { entitlement: "not-an-object", subscription: 42 }],
  ["unknown future fields", { someFutureHostedField: { nested: true }, cloudWorkspace: "cw_9" }],
];

for (const [label, extra] of LEGACY_FIXTURES) {
  test(`legacy artifact tolerance — ${label}: no crash, no hosted output, no copy-forward`, () => {
    const dir = sandbox();
    try {
      writeLegacyState(dir, extra);

      // 1. Re-activation reads the old state without crashing and writes only the CE schema.
      const state = runFullActivation(dir) as Record<string, unknown>;
      for (const k of HOSTED_KEYS) {
        assert.ok(!(k in state), `${label}: new activation state must not contain "${k}"`);
      }
      persistActivationV2(dir, state as never);
      const persisted = JSON.parse(readFileSync(join(dir, ".avorelo", "activation", "activation-state.json"), "utf8"));
      for (const k of HOSTED_KEYS) {
        assert.ok(!(k in persisted), `${label}: persisted state must not carry legacy "${k}"`);
      }

      // 2. Dashboard opens identically with no entitlement concept.
      const r = open(dir, { now: NOW }) as Record<string, unknown>;
      assert.equal(r.ok, true, `${label}: dashboard opens`);
      assert.ok(!("entitlementSource" in r), `${label}: no entitlementSource on open result`);

      // 3. Control Center exposes no entitlement gate.
      const cc = buildControlCenter(dir, { now: NOW });
      assert.equal((cc.sections as Record<string, unknown>).entitlementGate, undefined, `${label}: no entitlementGate`);
    } finally { cleanup(dir); }
  });
}

test("legacy artifact tolerance — missing state: activation succeeds and writes CE schema", () => {
  const dir = sandbox();
  try {
    // No pre-existing activation state at all.
    const state = runFullActivation(dir) as Record<string, unknown>;
    assert.equal(state.contract, "avorelo.activationState.v2");
    for (const k of HOSTED_KEYS) assert.ok(!(k in state), `missing-state activation must not contain "${k}"`);
  } finally { cleanup(dir); }
});

test("standalone legacy entitlement/billing files are inert (not read, no crash)", () => {
  const dir = sandbox();
  try {
    // Drop old standalone hosted artifacts; CE must ignore them entirely.
    writeFileSync(join(dir, ".avorelo", "entitlement.json"), JSON.stringify({ plan: "pro", source: "lemon" }));
    writeFileSync(join(dir, ".avorelo", "subscription.json"), JSON.stringify({ status: "active" }));
    writeFileSync(join(dir, ".avorelo", "billing.json"), JSON.stringify({ customerId: "c_1" }));
    const state = runFullActivation(dir) as Record<string, unknown>;
    for (const k of HOSTED_KEYS) assert.ok(!(k in state), `inert legacy files must not leak "${k}"`);
    const r = open(dir, { now: NOW });
    assert.equal(r.ok, true);
  } finally { cleanup(dir); }
});
