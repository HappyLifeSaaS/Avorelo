// Skills Layer Dogfood.
// Proves: skill selection, skill registry, skill receipt, hidden by default.

import { selectSkill, getSkillRegistry, createSkillReceipt } from "../kernel/skills/index.ts";

type ScenarioResult = { scenario: string; pass: boolean; detail: string };
const results: ScenarioResult[] = [];
const NOW = 1718500000000;

function record(scenario: string, pass: boolean, detail: string) { results.push({ scenario, pass, detail }); }
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(`ASSERT: ${msg}`); }

// S1: all 5 skills registered
try {
  const registry = getSkillRegistry();
  assert(registry.length >= 5, `${registry.length} skills`);
  const ids = registry.map(s => s.id);
  assert(ids.includes("skill-format"), "format");
  assert(ids.includes("skill-lint"), "lint");
  assert(ids.includes("skill-test"), "test");
  assert(ids.includes("skill-scaffold"), "scaffold");
  assert(ids.includes("skill-status"), "status");
  record("registry_complete", true, `${registry.length} skills`);
} catch (e: any) { record("registry_complete", false, e.message); }

// S2: skill selection matches intent
try {
  const format = selectSkill("format the code");
  assert(format.matched?.id === "skill-format", "format matched");
  const lint = selectSkill("run lint check");
  assert(lint.matched?.id === "skill-lint", "lint matched");
  const test = selectSkill("run test suite");
  assert(test.matched?.id === "skill-test", "test matched");
  const scaffold = selectSkill("scaffold a new component");
  assert(scaffold.matched?.id === "skill-scaffold", "scaffold matched");
  const status = selectSkill("check status");
  assert(status.matched?.id === "skill-status", "status matched");
  record("skill_selection", true, "all 5 skills match correctly");
} catch (e: any) { record("skill_selection", false, e.message); }

// S3: unmatched intent returns null
try {
  const result = selectSkill("deploy to production");
  assert(result.matched === null, "no match for deploy");
  assert(result.reasonCodes.includes("NO_SKILL_MATCHED"), "has NO_SKILL_MATCHED");
  record("no_match", true, "unmatched returns null");
} catch (e: any) { record("no_match", false, e.message); }

// S4: all skills hidden
try {
  const registry = getSkillRegistry();
  for (const skill of registry) {
    assert(skill.hidden === true, `${skill.id} hidden`);
  }
  record("all_hidden", true, "all skills hidden");
} catch (e: any) { record("all_hidden", false, e.message); }

// S5: skill receipt correct contract
try {
  const skill = getSkillRegistry()[0]!;
  const receipt = createSkillReceipt(skill, "deterministic-local", true, ["SKILL_EXECUTED"], NOW);
  assert(receipt.contract === "avorelo.skillReceipt.v1", "contract");
  assert(receipt.receiptId.startsWith("skr_"), "receipt id");
  assert(receipt.containsRawPrompt === false, "no raw prompt");
  assert(receipt.containsRawSecret === false, "no raw secret");
  assert(receipt.containsRawOutput === false, "no raw output");
  record("receipt_contract", true, `receipt=${receipt.receiptId}`);
} catch (e: any) { record("receipt_contract", false, e.message); }

// S6: skill safety classes are all safe
try {
  const registry = getSkillRegistry();
  for (const skill of registry) {
    assert(skill.safetyClass === "safe", `${skill.id} safety=${skill.safetyClass}`);
  }
  record("all_safe", true, "all initial skills are safe");
} catch (e: any) { record("all_safe", false, e.message); }

// Summary
const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;

console.log("\n=== Skills Layer Dogfood ===\n");
for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.scenario}: ${r.detail}`);
console.log(`\n${passed} passed, ${failed} failed of ${results.length} scenarios`);

if (failed > 0) {
  console.error("\nFAILED scenarios:");
  for (const r of results.filter(r => !r.pass)) console.error(`  ✗ ${r.scenario}: ${r.detail}`);
  process.exit(1);
}
