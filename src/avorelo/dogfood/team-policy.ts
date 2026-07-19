// Dogfood: team policy — verifies policy creation, evaluation, constraint merging,
// validation, and no-raw-persistence contracts.

import {
  createDefaultTeamPolicy, createStrictTeamPolicy, evaluateTeamPolicy,
  applyTeamPolicyToConstraints, validateTeamPolicy,
} from "../kernel/tool-adapters/team-policy.ts";
import { defaultPolicyConstraints } from "../kernel/tool-adapters/policies.ts";

type Gate = { gate: string; pass: boolean; detail: string };
const gates: Gate[] = [];

function check(gate: string, pass: boolean, detail = "") {
  gates.push({ gate, pass, detail });
  if (!pass) console.error(`FAIL: ${gate} — ${detail}`);
}

// G1: default policy contract
const def = createDefaultTeamPolicy("test-team");
check("default_contract", def.contract === "avorelo.teamPolicy.v1");
check("default_team_name", def.teamName === "test-team");
check("default_effect_allow", def.defaultEffect === "allow");

// G2: ownership contract
check("ownership_model", def.modelMayDecide === false);
check("ownership_scanner", def.scannerMayDecide === false);
check("ownership_gate", def.finalDecisionOwner === "kernel/stop-continue-gate");

// G3: no-raw-persistence
check("no_raw_prompt", def.containsRawPrompt === false);
check("no_raw_source", def.containsRawSource === false);
check("no_raw_secret", def.containsRawSecret === false);
check("no_raw_output", def.containsRawOutput === false);

// G4: strict policy
const strict = createStrictTeamPolicy("strict");
check("strict_denies_cursor", strict.deniedAdapters?.includes("cursor") === true);
check("strict_requires_sandbox", strict.requireSandbox === true);
check("strict_requires_proof", strict.requireProofCollection === true);
check("strict_local_only", strict.requireLocalOnly === true);
check("strict_deny_data", strict.denyDataCollection === true);
check("strict_risk_ceiling", strict.maxRiskCeiling === "medium");
check("strict_has_rules", strict.rules.length >= 2);

// G5: evaluate allow
const allowResult = evaluateTeamPolicy(createDefaultTeamPolicy("t"), "claude-code", "high", "no_training");
check("eval_allow", allowResult.effect === "allow");
check("eval_no_raw_prompt", allowResult.containsRawPrompt === false);

// G6: evaluate deny for denied adapter
const denyResult = evaluateTeamPolicy(strict, "cursor", "low", "unknown");
check("eval_deny_cursor", denyResult.effect === "deny");
check("eval_deny_reason", denyResult.reasonCodes.includes("TEAM_POLICY_ADAPTER_DENIED"));

// G7: evaluate deny for risk ceiling
const riskResult = evaluateTeamPolicy(strict, "claude-code", "high", "no_training");
check("eval_deny_risk", riskResult.effect === "deny");

// G8: evaluate deny for training policy
const trainResult = evaluateTeamPolicy(strict, "codex", "medium", "training_included");
check("eval_deny_training", trainResult.effect === "deny");

// G9: allowed-adapters list
const restricted = createDefaultTeamPolicy("t");
restricted.allowedAdapters = ["claude-code"];
const notAllowed = evaluateTeamPolicy(restricted, "gemini-cli", "medium", "no_training");
check("eval_not_allowed", notAllowed.effect === "deny");

// G10: constraint merging
const base = defaultPolicyConstraints();
const merged = applyTeamPolicyToConstraints(strict, base);
check("merge_local_only", merged.localOnly === true);
check("merge_sandbox", merged.requireSandbox === true);
check("merge_proof", merged.requireProofCollection === true);
check("merge_denied", merged.deniedAdapters?.includes("cursor") === true);

// G11: stricter risk ceiling wins
const lowRisk = createDefaultTeamPolicy("t");
lowRisk.maxRiskCeiling = "low";
const lowMerged = applyTeamPolicyToConstraints(lowRisk, defaultPolicyConstraints());
check("merge_stricter_risk", lowMerged.maxRiskCeiling === "low");

// G12: validation passes for valid policy
check("validate_default", validateTeamPolicy(createDefaultTeamPolicy("t")).valid === true);
check("validate_strict", validateTeamPolicy(createStrictTeamPolicy("t")).valid === true);

// G13: validation catches invalid ownership
const badPolicy = createDefaultTeamPolicy("t") as any;
badPolicy.modelMayDecide = true;
check("validate_bad_ownership", validateTeamPolicy(badPolicy).valid === false);

// Report
const passed = gates.filter(g => g.pass).length;
const failed = gates.filter(g => !g.pass).length;
console.log(`\nTeam Policy dogfood: ${passed}/${gates.length} passed, ${failed} failed`);
if (failed > 0) {
  for (const g of gates.filter(g => !g.pass)) console.error(`  FAIL: ${g.gate} — ${g.detail}`);
  process.exit(1);
}
console.log("All team policy gates passed.");
