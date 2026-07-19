// Avorelo Skill OS Dogfood. Proves routing selects/skips correctly for 10 scenarios.
import { routeSkills, type TaskFrame } from "../validation/skill-operating-system/router.ts";
import { REGISTRY, REGISTRY_COUNT, getUnknownCount } from "../validation/skill-operating-system/registry.ts";

const failures: string[] = [];

function scenario(name: string, frame: TaskFrame, checks: (r: ReturnType<typeof routeSkills>) => void) {
  const r = routeSkills(frame);
  try { checks(r); } catch (e) { failures.push(`${name}: ${(e as Error).message}`); }
}

const base: TaskFrame = { taskType: "code", changedFiles: [], touchedLayers: [], riskClass: "low", browserAvailable: false, deepMode: false, paymentTouched: false, dashboardTouched: false, publicCopyTouched: false, mcpTouched: false, skillConfigTouched: false };

// S1: Docs-only low-risk
scenario("S1_docs_only", { ...base, taskType: "docs", riskClass: "low" }, (r) => {
  if (r.selected.length > r.skipped.length) throw new Error("docs-only should skip most skills");
});

// S2: Security/config change
scenario("S2_security_change", { ...base, riskClass: "high", touchedLayers: ["Kernel"] }, (r) => {
  const secIds = r.selected.filter(s => s.category.includes("security") || s.category === "code_security");
  if (secIds.length === 0) throw new Error("security change should select security skills");
});

// S3: UI change no browser
scenario("S3_ui_no_browser", { ...base, dashboardTouched: true, browserAvailable: false }, (r) => {
  const browserExec = r.selected.filter(s => s.adoptionDecision === "BACKLOG_REQUIRES_BROWSER");
  if (browserExec.length > 0) throw new Error("browser skills should not be selected when browser unavailable");
});

// S4: MCP/tool change
scenario("S4_mcp_change", { ...base, mcpTouched: true }, (r) => {
  const mcpSkills = r.selected.filter(s => s.category === "mcp_tooling" || s.id.includes("mcp"));
  if (mcpSkills.length === 0) throw new Error("MCP change should select MCP skills");
});

// S5: Payment change
scenario("S5_payment_change", { ...base, paymentTouched: true }, (r) => {
  if (r.selected.length === 0) throw new Error("payment change should select skills");
});

// S6: Public copy change
scenario("S6_public_copy", { ...base, publicCopyTouched: true }, (r) => {
  if (r.selected.length === 0) throw new Error("public copy change should select claim/value skills");
});

// S7: Architecture change
scenario("S7_architecture", { ...base, touchedLayers: ["Kernel"] }, (r) => {
  const archSkills = r.selected.filter(s => s.category === "architecture");
  if (archSkills.length === 0) throw new Error("kernel change should select architecture skills");
});

// S8: Deep mode
scenario("S8_deep_mode", { ...base, deepMode: true }, (r) => {
  if (r.selected.length < 20) throw new Error("deep mode should select many skills");
});

// S9: High-cost on low-risk
scenario("S9_no_overactivation", { ...base, riskClass: "low" }, (r) => {
  const highCost = r.selected.filter(s => s.contextCost === "high");
  if (highCost.length > 0) throw new Error("high-cost skills should not run on low-risk without deep mode");
});

// S10: Registry completeness
if (getUnknownCount() > 0) failures.push("S10: registry has UNKNOWN items");
if (REGISTRY.some(i => !i.activationTriggers.length)) failures.push("S10: item missing activationTriggers");
if (REGISTRY.some(i => !i.antiTriggers.length)) failures.push("S10: item missing antiTriggers");
if (REGISTRY.some(i => !i.requiredEvidence.length)) failures.push("S10: item missing requiredEvidence");

const summary = {
  ok: failures.length === 0,
  registryCount: REGISTRY_COUNT,
  unknownCount: getUnknownCount(),
  scenarios: 10,
  scenariosPassed: 10 - failures.filter(f => f.startsWith("S")).length,
  activeItems: REGISTRY.filter(i => i.currentStatus === "active").length,
  backlogItems: REGISTRY.filter(i => i.currentStatus === "backlog").length,
  rejectedItems: REGISTRY.filter(i => i.currentStatus === "rejected").length,
  failures,
};
process.stdout.write("AVORELO SKILL OS DOGFOOD\n" + JSON.stringify(summary, null, 2) + "\n");
process.exit(failures.length === 0 ? 0 : 1);
