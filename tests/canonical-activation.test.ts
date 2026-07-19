import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildActivationState, writeActivationState, readActivationState,
  verifyActivationState, repairActivationState,
  ACTIVATION_STATE_CONTRACT, ACTIVATION_STATE_DIR, ACTIVATION_STATE_FILE,
} from "../src/avorelo/capabilities/activation/activation-state.ts";

let target: string;

before(() => {
  target = mkdtempSync(join(tmpdir(), "avorelo-test-activation-"));
  mkdirSync(join(target, "src"), { recursive: true });
});

after(() => {
  if (existsSync(target) && target.includes("avorelo-test-activation-")) {
    rmSync(target, { recursive: true, force: true });
  }
});

describe("Canonical Activation", () => {
  // 1. default activation creates .avorelo/activation/activation-state.json
  it("creates activation-state.json", () => {
    const state = buildActivationState(target);
    const path = writeActivationState(target, state);
    assert.ok(existsSync(path));
    assert.ok(path.endsWith(ACTIVATION_STATE_FILE));
  });

  // 2. activation state contract is avorelo.activationState.v1
  it("has correct contract", () => {
    const state = readActivationState(target);
    assert.ok(state);
    assert.equal(state.contract, ACTIVATION_STATE_CONTRACT);
  });

  // 3. activation state is redacted
  it("is redacted", () => {
    const state = readActivationState(target)!;
    assert.equal(state.redacted, true);
  });

  // 4. activation mode is local-first/free
  it("mode is local-first/free", () => {
    const state = readActivationState(target)!;
    assert.equal(state.activationMode, "local-first/free");
  });

  // 5. activation does not require billing
  it("does not require billing", () => {
    // F2: activation no longer writes a billing block at all. It previously emitted
    // provider "lemon_squeezy" / status "HOLD_NOT_LIVE" into every user's local state — a
    // hosted-era residue describing Avorelo's own discontinued billing. "No billing" is a
    // stronger guarantee than "billing switched off".
    const state = readActivationState(target)! as any;
    assert.equal(state.billing, undefined, "no billing state may be written");
  });

  // 6. activation does not require auth
  it("does not require auth", () => {
    const state = readActivationState(target)!;
    assert.equal(state.cloud.authLive, false);
  });

  // 7. activation does not require cloud sync
  it("does not require cloud sync", () => {
    const state = readActivationState(target)!;
    assert.equal(state.cloud.cloudSyncLive, false);
    assert.equal(state.cloud.status, "HOLD_NOT_LIVE");
  });

  // 8. activation does not claim production readiness
  it("does not claim production readiness", () => {
    const state = readActivationState(target)!;
    assert.equal(state.productionReady, false);
  });

  // 9. status reads activation state
  it("readActivationState returns written state", () => {
    const state = readActivationState(target);
    assert.ok(state);
    assert.equal(state.activationStatus, "active_with_holds");
  });

  // 10. open reads/generates local dashboard (tested via dashboard availability flag)
  it("tracks local dashboard availability", () => {
    const state = readActivationState(target)!;
    assert.equal(typeof state.localDashboard.available, "boolean");
  });

  // 11. activation receipt is local and redacted
  it("receipts array is local", () => {
    const state = readActivationState(target)!;
    assert.ok(Array.isArray(state.receipts));
  });

  // 12. corrupt activation state gives safe repair message
  it("handles corrupt state", () => {
    const dir = join(target, ACTIVATION_STATE_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ACTIVATION_STATE_FILE), '{"contract":"wrong"}');
    const result = repairActivationState(target);
    assert.equal(result.repaired, false);
    assert.ok(result.message.includes("avorelo activate"), `Expected repair message to suggest re-activate, got: ${result.message}`);
    // Verify also fails
    const verify = verifyActivationState(target);
    assert.equal(verify.valid, false);
    // Restore valid state
    const state = buildActivationState(target);
    writeActivationState(target, state);
  });

  // 13. rerun is idempotent
  it("idempotent rerun", () => {
    const state1 = buildActivationState(target);
    writeActivationState(target, state1);
    const state2 = buildActivationState(target);
    writeActivationState(target, state2);
    const readBack = readActivationState(target);
    assert.ok(readBack);
    assert.equal(readBack.contract, ACTIVATION_STATE_CONTRACT);
  });

  // 14. hook installation is not default
  it("default activation does not install hooks", () => {
    const state = readActivationState(target)!;
    const hookStep = state.setupSteps.find(s => s.id === "hooks_installed");
    assert.equal(hookStep, undefined);
  });

  // 16. Lemon Squeezy remains NOT LIVE
  it("no payment provider appears in local state", () => {
    // F2: the state used to name Lemon Squeezy as Avorelo's provider and mark it HOLD_NOT_LIVE.
    // Community Edition has no billing, so no provider is named at all.
    const state = readActivationState(target)! as any;
    assert.equal(state.billing, undefined, "no billing block");
    assert.ok(!JSON.stringify(state).toLowerCase().includes("lemon"), "no payment provider named in state");
  });

  // 18. Founder shows activation and production separately (tested via state)
  it("activation and production are separate", () => {
    const state = readActivationState(target)!;
    assert.equal(state.activationStatus, "active_with_holds");
    assert.equal(state.productionReady, false);
  });

  // 23. old .claude/cco is not canonical truth
  it("does not create .claude/cco", () => {
    assert.ok(!existsSync(join(target, ".claude", "cco")));
  });

  // 28. no secrets in state
  it("no secrets in state file", () => {
    const raw = readFileSync(join(target, ACTIVATION_STATE_DIR, ACTIVATION_STATE_FILE), "utf8");
    assert.ok(!raw.includes("AKIA"));
    assert.ok(!raw.includes("ghp_"));
    assert.ok(!raw.includes("sk-"));
    assert.ok(!raw.includes("-----BEGIN"));
  });

  // 32. production readiness remains blocked
  it("production readiness blocked", () => {
    const state = readActivationState(target)!;
    assert.equal(state.productionReady, false);
  });

  // 33. payments remain not live
  it("payments not live", () => {
    const state = readActivationState(target)! as any;
    assert.equal(state.billing, undefined, "no billing state at all");
  });

  // 34. auth/cloud remain not live
  it("auth/cloud not live", () => {
    const state = readActivationState(target)!;
    assert.equal(state.cloud.authLive, false);
    assert.equal(state.cloud.cloudSyncLive, false);
  });

  // Verify activation state invariants
  it("verifyActivationState passes", () => {
    const result = verifyActivationState(target);
    assert.ok(result.valid, `Checks: ${JSON.stringify(result.checks.filter(c => !c.passed))}`);
  });

  // No old naming leakage in state
  it("no old naming leakage", () => {
    const raw = readFileSync(join(target, ACTIVATION_STATE_DIR, ACTIVATION_STATE_FILE), "utf8").toLowerCase();
    assert.ok(!raw.includes('"wuz'));
    assert.ok(!raw.includes('"cco'));
    assert.ok(!raw.includes("claudecode-optimizer"));
  });

  // Setup steps present
  it("setup steps populated", () => {
    const state = readActivationState(target)!;
    assert.ok(state.setupSteps.length >= 3);
    assert.ok(state.setupSteps.some(s => s.id === "workspace_detected"));
    assert.ok(state.setupSteps.some(s => s.id === "avorelo_dir_writable"));
    assert.ok(state.setupSteps.some(s => s.id === "activation_state_written"));
  });

  // Holds are documented
  it("holds documented", () => {
    // F2: the billing hold is gone with the billing state. A "hold" says a feature exists but is
    // switched off; billing does not exist in Community Edition, so advertising a hold for it
    // would imply it is merely pending.
    const state = readActivationState(target)!;
    assert.ok(state.holds.length >= 3, `expected the remaining holds, got ${state.holds.length}`);
    assert.ok(!state.holds.some(h => h.includes("billing")), "no billing hold — billing does not exist");
    assert.ok(state.holds.some(h => h.includes("auth")));
    assert.ok(state.holds.some(h => h.includes("production")));
  });

  // readActivationState returns null for missing state
  it("returns null for non-existent state", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "avorelo-test-empty-"));
    const result = readActivationState(emptyDir);
    assert.equal(result, null);
    rmSync(emptyDir, { recursive: true, force: true });
  });

  // Regression: the CLI `activate` writes a v2 state with NO cloud/billing/auth block at all.
  // verifyActivationState must treat an absent cloud block as "not live" (like it already does
  // for billing and auth), not as a live-sync violation. This is the exact shape that made
  // `avorelo verify` exit 1 after a fresh Community Edition activation.
  it("verify accepts a v2 state with no cloud/billing/auth block", () => {
    const dir = mkdtempSync(join(tmpdir(), "avorelo-test-v2-nocloud-"));
    try {
      mkdirSync(join(dir, ACTIVATION_STATE_DIR), { recursive: true });
      const v2 = {
        contract: "avorelo.activationState.v2",
        activationMode: "local-first/free",
        productionReady: false,
        redacted: true,
        setupSteps: [],
      };
      writeFileSync(join(dir, ACTIVATION_STATE_DIR, ACTIVATION_STATE_FILE), JSON.stringify(v2, null, 2));
      const result = verifyActivationState(dir);
      const cloud = result.checks.find((c) => c.id === "cloud_sync_not_live");
      assert.ok(cloud?.passed, "absent cloud block must satisfy cloud_sync_not_live");
      assert.ok(result.valid, `verify should pass: ${JSON.stringify(result.checks.filter((c) => !c.passed))}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
