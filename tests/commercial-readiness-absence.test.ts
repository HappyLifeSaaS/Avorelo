// Milestone F1: the payment-readiness capability is gone, and cannot come back.
//
// Disposition was Case A — it evaluated *Avorelo's own* discontinued hosted billing, not a user
// project's payment implementation. The evidence was unambiguous:
//   - `EntitlementState.plan: "free" | "pro" | "teams"` — Avorelo's own SaaS tiers
//   - `planTier: "Pro"` on the work contract — Avorelo's own tier
//   - `PaymentProvider = "lemon_squeezy"` — the only permitted value
//   - `entitlementReadBack` — Avorelo's own entitlement system
//   - "Lemon Squeezy is the canonical adapter; Stripe is not a direction" — Avorelo's roadmap
//   - company-loop's `revenue_billing` persona: "billingLive=false. HOLD_NOT_LIVE",
//     recommendedFix "Connect test-mode billing when approved"
// None of that describes anything a Community Edition user does. Case B (a provider-neutral
// evaluator of a *user's* payment integration) would have required different inputs entirely.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { buildCapabilityRouteDecision } from "../src/avorelo/kernel/work-controls/index.ts";

const ROOT = process.cwd();

/** Active implementation surfaces. Excludes historical maps, which legitimately record the past. */
const ACTIVE_DIRS = ["src", "tests"];
const HISTORICAL_TOOLS = new Set([
  join("tools", "audit-old-core-parity.ts"),   // old->new parity map; records the removal
  join("tools", "legacy-reference-map.ts"),    // legacy area map; records the removal
]);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|mjs|js|html|json)$/.test(p)) out.push(p);
  }
  return out;
}

test("the payment-readiness capability is deleted", () => {
  assert.equal(existsSync(join(ROOT, "src", "avorelo", "capabilities", "payment-readiness")), false,
    "the capability directory must be gone");
  assert.equal(existsSync(join(ROOT, "tests", "slice5-payment.test.ts")), false,
    "its test file must be gone");
});

test("no active source references the removed capability", () => {
  const offenders: string[] = [];
  for (const d of ACTIVE_DIRS) {
    for (const f of walk(join(ROOT, d))) {
      const rel = f.slice(ROOT.length + 1);
      const body = readFileSync(f, "utf8");
      // This test file names the identifiers on purpose, to document the removal.
      if (rel.endsWith("commercial-readiness-absence.test.ts")) continue;
      if (/evaluatePaymentReadiness|capabilities\/payment-readiness/.test(body)) offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], `active source still references the removed capability: ${offenders.join(", ")}`);
});

test("no tool imports the removed capability", () => {
  for (const f of walk(join(ROOT, "tools"))) {
    const rel = f.slice(ROOT.length + 1);
    const body = readFileSync(f, "utf8");
    assert.ok(!/import .*payment-readiness/.test(body), `${rel} imports the removed capability`);
    if (HISTORICAL_TOOLS.has(rel)) continue; // may name it as history
    assert.ok(!/payment-readiness/.test(body), `${rel} references the removed capability`);
  }
});

test("the capability registry no longer offers payment-readiness", () => {
  const schemas = readFileSync(join(ROOT, "src", "avorelo", "shared", "schemas", "index.ts"), "utf8");
  assert.ok(!/"payment-readiness"/.test(schemas), "CapabilityId must not include payment-readiness");
});

test("company-loop no longer runs a billing persona for Avorelo's own revenue", () => {
  for (const f of ["index.ts", "persona-contracts.ts", "persona-runner.ts"]) {
    const body = readFileSync(join(ROOT, "src", "avorelo", "capabilities", "company-loop", f), "utf8");
    assert.ok(!/revenue_billing/.test(body), `company-loop/${f} still declares the revenue_billing persona`);
    assert.ok(!/cap-payment-readiness/.test(body), `company-loop/${f} still binds the removed capability`);
    assert.ok(!/lemon_squeezy|Lemon Squeezy/.test(body), `company-loop/${f} still names the payment provider`);
  }
});

test("company-loop remains coherent after the persona removal", async () => {
  const { runCompanyLoop } = await import("../src/avorelo/capabilities/company-loop/index.ts");
  const result = runCompanyLoop();
  assert.ok(Array.isArray(result.personas), "company-loop still produces personas");
  assert.ok(result.personas.length > 0, "company-loop must still have personas");
  assert.ok(!result.personas.some((p: any) => p.persona === "revenue_billing"), "revenue_billing persona is gone");
  // The rollup must still add up: every persona is counted exactly once.
  const counted = result.rollup.pass + result.rollup.hold + result.rollup.needsAttention + result.rollup.blocked;
  assert.equal(counted, result.personas.length, "rollup must account for every persona");
});

test("a user's payment-touching work still raises risk, without an Avorelo billing capability", () => {
  // The generic signal survives: detecting that the *user's* work touches a payment surface is a
  // legitimate local heuristic. What is gone is routing it into Avorelo's own billing evaluator.
  const decision = buildCapabilityRouteDecision({
    taskType: "code_generation",
    riskClass: "high",
    proofTier: "tests",
    approvalPolicy: "require_manual_review",
    proposalHints: ["billing_change"],
    paymentTouched: true,
    deepMode: true,
  });
  assert.ok(!decision.selectedCapabilities.includes("payment-readiness"), "no removed capability may be selected");
  assert.ok(!decision.expectedEvidence.includes("billing_readback"), "no Avorelo billing read-back is expected");
  assert.ok(decision.requiredApprovals.includes("manual_review"), "payment-touching work still needs review");
  assert.ok(decision.selectedCapabilities.length > 0, "routing still selects real capabilities");
});

test("no capability claims Lemon Squeezy is part of the runtime", () => {
  for (const f of walk(join(ROOT, "src", "avorelo", "capabilities"))) {
    const body = readFileSync(f, "utf8");
    assert.ok(!/canonical adapter/i.test(body), `${f.slice(ROOT.length + 1)} claims a canonical payment adapter`);
  }
});

test("the removed capability page has not reappeared on the site", () => {
  const STATIC = join(ROOT, "src", "avorelo", "surfaces", "public-web", "static");
  assert.equal(existsSync(join(STATIC, "capability-payment-launch-readiness.html")), false,
    "the payment capability page must stay removed");
  for (const f of readdirSync(STATIC).filter((x) => x.endsWith(".html"))) {
    const body = readFileSync(join(STATIC, f), "utf8");
    assert.ok(!/payment-readiness/.test(body), `${f} references the removed capability`);
    assert.ok(!/Lemon Squeezy/.test(body), `${f} names the discontinued payment provider`);
  }
});
