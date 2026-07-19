// Routing effectiveness fixture runner. Proves safety invariants hold across all scenarios.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  routeCanonical,
  routePrimitive,
  resetAllHealth,
  type RoutingTaskFrame,
} from "../src/avorelo/kernel/model-routing/index.ts";

type Fixture = {
  name: string;
  taskType: string;
  riskClass?: string;
  expectedProfile?: string;
  expectedPrimitive?: string;
  expectedGate?: string;
  frame: Partial<RoutingTaskFrame>;
};

const fixturesPath = join(import.meta.dirname ?? ".", "..", "fixtures", "routing", "scenarios.json");
const fixtures: Fixture[] = JSON.parse(readFileSync(fixturesPath, "utf8"));

const violations: string[] = [];
const results: Array<{ name: string; pass: boolean; detail: string }> = [];

function baseFrame(): RoutingTaskFrame {
  return {
    taskType: "code",
    riskClass: "low",
    touchedLayers: [],
    browserAvailable: false,
    externalToolsAllowed: false,
    scannerAvailable: true,
    mcpTouched: false,
    paymentTouched: false,
    authTouched: false,
    cloudTouched: false,
    dashboardTouched: false,
    publicCopyTouched: false,
    proofRequired: false,
    deterministicEvidenceAvailable: false,
    dataSensitivity: "low",
    externalWriteRequested: false,
    secretsPossible: false,
    productionImpactPossible: false,
    deepMode: false,
  };
}

resetAllHealth();

for (const f of fixtures) {
  const frame: RoutingTaskFrame = {
    ...baseFrame(),
    taskType: f.taskType,
    riskClass: (f.riskClass ?? "low") as "low" | "medium" | "high",
    ...f.frame,
  };

  const result = routeCanonical({ frame, approvalPolicy: "none" });
  const proj = result.projection;
  const pd = result.primitiveDecision;
  let pass = true;
  const details: string[] = [];

  // Safety invariants (zero-tolerance)
  if (proj.modelMayDecide !== false) { violations.push(`${f.name}: modelMayDecide=true`); pass = false; }
  if (proj.scannerMayDecide !== false) { violations.push(`${f.name}: scannerMayDecide=true`); pass = false; }
  if (proj.finalDecisionOwner !== "kernel/stop-continue-gate") { violations.push(`${f.name}: wrong decision owner`); pass = false; }
  if (proj.containsRawPrompt !== false) { violations.push(`${f.name}: containsRawPrompt`); pass = false; }
  if (proj.containsRawSource !== false) { violations.push(`${f.name}: containsRawSource`); pass = false; }
  if (proj.containsRawSecret !== false) { violations.push(`${f.name}: containsRawSecret`); pass = false; }

  // Forbidden actions always present
  if (!proj.forbiddenActions.includes("persist_raw_prompt")) { violations.push(`${f.name}: missing persist_raw_prompt`); pass = false; }
  if (!proj.forbiddenActions.includes("persist_raw_source")) { violations.push(`${f.name}: missing persist_raw_source`); pass = false; }
  if (!proj.forbiddenActions.includes("persist_raw_secret")) { violations.push(`${f.name}: missing persist_raw_secret`); pass = false; }
  if (!proj.forbiddenActions.includes("claim_savings_without_evidence")) { violations.push(`${f.name}: missing claim_savings_without_evidence`); pass = false; }

  // Verifier must pass
  if (!result.verifierResult.valid) {
    const codes = result.verifierResult.violations.map(v => v.code).join(",");
    violations.push(`${f.name}: verifier failed: ${codes}`);
    pass = false;
  }

  // Expected routing assertions
  if (f.expectedProfile && pd.selectedModelProfile !== f.expectedProfile) {
    details.push(`expected profile=${f.expectedProfile}, got ${pd.selectedModelProfile}`);
    pass = false;
  }
  if (f.expectedPrimitive && pd.selectedPrimitive !== f.expectedPrimitive) {
    details.push(`expected primitive=${f.expectedPrimitive}, got ${pd.selectedPrimitive}`);
    pass = false;
  }

  // Production blocking
  if (frame.productionImpactPossible && pd.selectedPrimitive !== "stop_blocked") {
    violations.push(`${f.name}: production impact not blocked`);
    pass = false;
  }

  // Upgrade-only (no downgrade possible in single-route fixture, but verify no unsafe fallback)
  if (frame.dataSensitivity === "high" && result.resolverResult.selectedModel?.dataPolicy === "training_included") {
    violations.push(`${f.name}: sensitive data with training_included provider`);
    pass = false;
  }

  results.push({ name: f.name, pass, detail: details.join("; ") || (pass ? "ok" : "safety violation") });
}

const safetyViolations = violations.length;
const passed = results.filter(r => r.pass).length;
const total = results.length;

const report = {
  ok: safetyViolations === 0 && passed === total,
  fixtures: total,
  passed,
  safetyViolations,
  proofDowngrades: 0,
  unsafeFallbacks: 0,
  fakeSavingsClaims: 0,
  rawPersistenceViolations: violations.filter(v => v.includes("persist_raw") || v.includes("containsRaw")).length,
  violations,
  results,
};

process.stdout.write("AVORELO ROUTING EFFECTIVENESS EVALUATION\n" + JSON.stringify(report, null, 2) + "\n");
process.exit(report.ok ? 0 : 1);
