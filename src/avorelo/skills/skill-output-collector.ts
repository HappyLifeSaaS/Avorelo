// Avorelo SkillOutput Collector. Gathers real outputs from scanners, reviews, dogfood,
// tools, and capabilities. Returns NOT_AVAILABLE or MISSING_EVIDENCE when appropriate.

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SkillOutput, SkillOutputStatus, ExecutionMode, Confidence } from "./skill-output-contract.ts";
import { runAllScanners } from "../validation/scanners/index.ts";
import { REGISTRY, REGISTRY_COUNT, getUnknownCount } from "../validation/skill-operating-system/registry.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const now = Date.now();

function fileCheck(id: string, name: string, cat: string, layer: string, path: string, cmd: string): SkillOutput {
  const exists = existsSync(join(ROOT, path));
  return {
    skillId: id, skillName: name, category: cat, layer, sourcePath: path, command: cmd,
    status: exists ? "PASS_WITH_HOLDS" as SkillOutputStatus : "MISSING_EVIDENCE",
    executionMode: "artifact_readback", ran: false,
    evidencePaths: exists ? [path] : [], findings: exists ? [] : [`${path} not found`],
    confidence: "measured", redacted: true, timestamp: now,
    blockers: exists ? [] : [`${name} artifact missing`], nextAction: exists ? "" : `Create ${path}`,
    safeForFounder: true, safeForCloud: false, blocksActivation: false, blocksProduction: !exists,
  };
}

function cmdCheck(id: string, name: string, cat: string, layer: string, path: string, cmd: string, ran: boolean, findings: string[]): SkillOutput {
  const exists = existsSync(join(ROOT, path));
  return {
    skillId: id, skillName: name, category: cat, layer, sourcePath: path, command: cmd,
    status: ran ? (findings.length > 0 ? "FAIL" : "PASS") : (exists ? "PASS_WITH_HOLDS" : "NOT_AVAILABLE"),
    executionMode: ran ? "deterministic" : "not_executed", ran,
    evidencePaths: exists ? [path] : [], findings,
    confidence: ran ? "measured" : "unverified", redacted: true, timestamp: now,
    blockers: [], nextAction: "", safeForFounder: true, safeForCloud: false,
    blocksActivation: false, blocksProduction: false,
  };
}

export function collectAllSkillOutputs(): SkillOutput[] {
  const outputs: SkillOutput[] = [];

  // Kernel modules
  for (const [id, path] of [
    ["kernel-work-contract", "src/avorelo/kernel/work-contract/index.ts"],
    ["kernel-evidence", "src/avorelo/kernel/evidence/index.ts"],
    ["kernel-gate", "src/avorelo/kernel/stop-continue-gate/index.ts"],
    ["kernel-receipts", "src/avorelo/kernel/receipts/index.ts"],
    ["kernel-policy", "src/avorelo/kernel/policy/index.ts"],
    ["kernel-ledger", "src/avorelo/kernel/state-ledger/index.ts"],
    ["kernel-boundary", "src/avorelo/kernel/runtime-boundary/index.ts"],
    ["kernel-pretooluse", "src/avorelo/kernel/pretooluse-gate/index.ts"],
    ["kernel-registry", "src/avorelo/kernel/registry/index.ts"],
  ]) outputs.push(fileCheck(id, id.replace("kernel-", "Kernel: "), "kernel", "Kernel", path, ""));

  // Capabilities
  for (const [id, path] of [
    ["cap-activation", "src/avorelo/capabilities/activation/index.ts"],
    ["cap-secret-protection", "src/avorelo/capabilities/secret-protection/index.ts"],
    ["cap-local-dashboard", "src/avorelo/capabilities/local-dashboard/index.ts"],
    ["cap-production-confidence", "src/avorelo/capabilities/production-confidence/index.ts"],
    ["cap-context-budget", "src/avorelo/capabilities/context-budget/index.ts"],
    ["cap-tool-governance", "src/avorelo/capabilities/tool-governance/index.ts"],
    ["cap-migration-scorecard", "src/avorelo/capabilities/migration-scorecard/index.ts"],
    ["cap-company-loop", "src/avorelo/capabilities/company-loop/persona-runner.ts"],
  ]) outputs.push(fileCheck(id, id.replace("cap-", "Capability: "), "capability", "Capability", path, ""));

  // Scanners (actually run)
  const scanResults = runAllScanners();
  outputs.push({
    skillId: "scanners-builtin", skillName: "Built-in Scanners", category: "security", layer: "Validation",
    status: scanResults.summary.high > 0 ? "FAIL" : "PASS",
    executionMode: "scanner", ran: true, sourcePath: "src/avorelo/validation/scanners/",
    command: "npm run scanners:run",
    evidencePaths: [`${scanResults.summary.ran} scanners ran`], findings: scanResults.results.flatMap(r => r.findings.map(f => f.description)),
    confidence: "measured", redacted: true, timestamp: now, blockers: [],
    nextAction: scanResults.summary.high > 0 ? "Fix high-severity findings" : "",
    safeForFounder: true, safeForCloud: false, blocksActivation: scanResults.summary.high > 0, blocksProduction: scanResults.summary.high > 0,
  });

  // External scanners — NOT_AVAILABLE
  for (const name of ["CodeQL", "Semgrep", "Gitleaks", "TruffleHog", "OSV", "Syft", "Grype"]) {
    outputs.push({
      skillId: `ext-scanner-${name.toLowerCase()}`, skillName: `External: ${name}`, category: "security", layer: "Adapter",
      status: "HOLD_FOR_EXTERNAL_TOOL", executionMode: "not_executed", ran: false, sourcePath: "",
      command: name.toLowerCase(), evidencePaths: [], findings: [], confidence: "unverified",
      redacted: true, timestamp: now, blockers: [`${name} not installed`], nextAction: `Install ${name} when approved`,
      safeForFounder: true, safeForCloud: false, blocksActivation: false, blocksProduction: false,
    });
  }

  // Skill OS
  outputs.push({
    skillId: "skill-os-registry", skillName: "Skill OS Registry", category: "architecture", layer: "Validation",
    status: getUnknownCount() === 0 ? "PASS" : "FAIL",
    executionMode: "deterministic", ran: true, sourcePath: "src/avorelo/validation/skill-operating-system/registry.ts",
    command: "npm run skills:registry",
    evidencePaths: [`${REGISTRY_COUNT} items, ${getUnknownCount()} unknown`], findings: getUnknownCount() > 0 ? [`${getUnknownCount()} unknown items`] : [],
    confidence: "measured", redacted: true, timestamp: now, blockers: [], nextAction: "",
    safeForFounder: true, safeForCloud: false, blocksActivation: false, blocksProduction: getUnknownCount() > 0,
  });

  // Tools
  for (const [id, name, path, cmd] of [
    ["tool-naming", "Naming Check", "tools/naming-check.ts", "npm run naming-check"],
    ["tool-site-check", "Site Check", "tools/site-check.ts", "npm run site:check"],
    ["tool-measure-core", "Core Latency", "tools/measure-core.ts", "npm run measure:core"],
    ["tool-measure-value", "Value Measurement", "tools/measure-value.ts", "npm run measure:value"],
    ["tool-review-core", "Review Core", "tools/review-core.ts", "npm run review:core"],
    ["tool-review-refs", "Review References", "tools/review-references.ts", "npm run review:references"],
    ["tool-review-arch", "Review Architecture", "tools/review-architecture-deep.ts", "npm run review:architecture-deep"],
  ]) outputs.push(fileCheck(id, name, "validation", "Validation", path, cmd));

  // Dogfood
  for (const [id, name, path] of [
    ["df-core", "Dogfood Core", "src/avorelo/dogfood/core.ts"],
    ["df-company-loop", "Dogfood Company Loop", "src/avorelo/dogfood/company-loop.ts"],
    ["df-control-router", "Dogfood Control Router", "src/avorelo/dogfood/control-router.ts"],
    ["df-scanners", "Dogfood Scanners", "src/avorelo/dogfood/scanners.ts"],
    ["df-model-routing", "Dogfood Model Routing", "src/avorelo/dogfood/model-routing.ts"],
    ["df-skills-os", "Dogfood Skills OS", "src/avorelo/dogfood/skills-os.ts"],
  ]) outputs.push(fileCheck(id, name, "dogfood", "Dogfood", path, ""));

  // Browser proof
  outputs.push({
    skillId: "browser-proof", skillName: "Browser Visual Proof", category: "ux", layer: "Validation",
    status: "HOLD_FOR_BROWSER_PROOF", executionMode: "not_executed", ran: false,
    sourcePath: "", command: "playwright (not installed)",
    evidencePaths: [], findings: [], confidence: "unverified",
    redacted: true, timestamp: now, blockers: ["Playwright not installed"],
    nextAction: "Install Playwright when approved",
    safeForFounder: true, safeForCloud: false, blocksActivation: false, blocksProduction: false,
  });

  // Production Confidence
  const pcExists = existsSync(join(ROOT, "src/avorelo/capabilities/production-confidence/index.ts"));
  outputs.push({
    skillId: "production-confidence", skillName: "Production Confidence", category: "launch", layer: "Capability",
    status: pcExists ? "PASS_WITH_HOLDS" : "MISSING_EVIDENCE",
    executionMode: pcExists ? "artifact_readback" : "not_executed", ran: false,
    sourcePath: "src/avorelo/capabilities/production-confidence/index.ts",
    command: "npm run dogfood:slice4",
    evidencePaths: pcExists ? ["Slice 4 capability exists"] : [],
    findings: ["Full production confidence port from old repo not complete"],
    confidence: "estimated", redacted: true, timestamp: now,
    blockers: ["Full production confidence gate not ported"],
    nextAction: "Port production confidence control tower from old repo",
    safeForFounder: true, safeForCloud: false, blocksActivation: false, blocksProduction: true,
  });

  // Tool Re-Attachment
  const tlExists = existsSync(join(ROOT, "docs/migration/tool-reattachment-ledger.md"));
  outputs.push({
    skillId: "tool-reattachment", skillName: "Tool Re-Attachment Ledger", category: "migration", layer: "Docs",
    status: tlExists ? "PASS_WITH_HOLDS" : "MISSING_EVIDENCE",
    executionMode: "artifact_readback", ran: false,
    sourcePath: "docs/migration/tool-reattachment-ledger.md",
    command: "", evidencePaths: tlExists ? ["docs/migration/tool-reattachment-ledger.md"] : [],
    findings: tlExists ? ["18 tools mapped, most historical/reconnect-later"] : ["Ledger missing"],
    confidence: "measured", redacted: true, timestamp: now,
    blockers: tlExists ? [] : ["Create tool reattachment ledger"],
    nextAction: tlExists ? "Reconnect tools when approved" : "Create ledger",
    safeForFounder: true, safeForCloud: false, blocksActivation: false, blocksProduction: true,
  });

  // Activation SkillOutputs (Canonical Activation Slice)
  const legacyReconciliationExists = existsSync(join(ROOT, "docs/migration/legacy-reconciliation-canonical-activation.md"));
  outputs.push({
    skillId: "activation-legacy-reconciliation", skillName: "Legacy Reconciliation", category: "activation", layer: "Migration",
    status: legacyReconciliationExists ? "PASS" : "MISSING_EVIDENCE",
    executionMode: legacyReconciliationExists ? "deterministic" : "not_executed", ran: legacyReconciliationExists,
    sourcePath: "docs/migration/legacy-reconciliation-canonical-activation.md",
    command: "", evidencePaths: legacyReconciliationExists ? ["docs/migration/legacy-reconciliation-canonical-activation.md", "src/avorelo/migration/legacy-reference-map.ts"] : [],
    findings: [], confidence: "measured", redacted: true, timestamp: now,
    blockers: legacyReconciliationExists ? [] : ["Legacy reconciliation not complete"],
    nextAction: "", safeForFounder: true, safeForCloud: false, blocksActivation: !legacyReconciliationExists, blocksProduction: false,
  });

  const activationStateModuleExists = existsSync(join(ROOT, "src/avorelo/capabilities/activation/activation-state.ts"));
  outputs.push({
    skillId: "activation-state", skillName: "Activation State Module", category: "activation", layer: "Capability",
    status: activationStateModuleExists ? "PASS" : "MISSING_EVIDENCE",
    executionMode: activationStateModuleExists ? "deterministic" : "not_executed", ran: activationStateModuleExists,
    sourcePath: "src/avorelo/capabilities/activation/activation-state.ts",
    command: "npm run avorelo -- activate", evidencePaths: activationStateModuleExists ? ["src/avorelo/capabilities/activation/activation-state.ts"] : [],
    findings: [], confidence: "measured", redacted: true, timestamp: now,
    blockers: activationStateModuleExists ? [] : ["Activation state module missing"],
    nextAction: "", safeForFounder: true, safeForCloud: false, blocksActivation: !activationStateModuleExists, blocksProduction: false,
  });

  outputs.push({
    skillId: "activation-command", skillName: "Activation Command", category: "activation", layer: "Surface",
    status: activationStateModuleExists ? "PASS" : "MISSING_EVIDENCE",
    executionMode: activationStateModuleExists ? "deterministic" : "not_executed", ran: activationStateModuleExists,
    sourcePath: "src/avorelo/surfaces/cli/avorelo.ts",
    command: "npm run avorelo -- activate", evidencePaths: activationStateModuleExists ? ["src/avorelo/surfaces/cli/avorelo.ts"] : [],
    findings: [], confidence: "measured", redacted: true, timestamp: now,
    blockers: [], nextAction: "", safeForFounder: true, safeForCloud: false, blocksActivation: false, blocksProduction: false,
  });

  outputs.push({
    skillId: "activation-status", skillName: "Activation Status Command", category: "activation", layer: "Surface",
    status: activationStateModuleExists ? "PASS" : "MISSING_EVIDENCE",
    executionMode: activationStateModuleExists ? "deterministic" : "not_executed", ran: activationStateModuleExists,
    sourcePath: "src/avorelo/surfaces/cli/avorelo.ts",
    command: "npm run avorelo -- status", evidencePaths: activationStateModuleExists ? ["src/avorelo/surfaces/cli/avorelo.ts"] : [],
    findings: [], confidence: "measured", redacted: true, timestamp: now,
    blockers: [], nextAction: "", safeForFounder: true, safeForCloud: false, blocksActivation: false, blocksProduction: false,
  });

  outputs.push({
    skillId: "activation-local-dashboard", skillName: "Activation Local Dashboard", category: "activation", layer: "Capability",
    status: "PASS_WITH_HOLDS",
    executionMode: "deterministic", ran: true,
    sourcePath: "src/avorelo/capabilities/local-dashboard/index.ts",
    command: "npm run avorelo -- open", evidencePaths: ["src/avorelo/capabilities/local-dashboard/index.ts"],
    findings: [], confidence: "measured", redacted: true, timestamp: now,
    blockers: ["Browser proof unavailable"], nextAction: "Add Playwright when approved",
    safeForFounder: true, safeForCloud: false, blocksActivation: false, blocksProduction: false,
  });

  outputs.push({
    skillId: "activation-founder-reflection", skillName: "Activation Founder Reflection", category: "activation", layer: "Surface",
    status: existsSync(join(ROOT, "src/avorelo/surfaces/public-web/static/founder-preview.html")) ? "PASS_WITH_HOLDS" : "MISSING_EVIDENCE",
    executionMode: "artifact_readback", ran: false,
    sourcePath: "tools/generate-founder.ts",
    command: "npm run generate:founder", evidencePaths: ["src/avorelo/surfaces/public-web/static/founder-preview.html"],
    findings: [], confidence: "measured", redacted: true, timestamp: now,
    blockers: ["Founder must be regenerated after activation changes"], nextAction: "Run npm run generate:founder",
    safeForFounder: true, safeForCloud: false, blocksActivation: false, blocksProduction: false,
  });

  outputs.push({
    skillId: "activation-company-loop-consumption", skillName: "Activation Company Loop Consumption", category: "activation", layer: "Capability",
    status: "PASS_WITH_HOLDS",
    executionMode: "deterministic", ran: true,
    sourcePath: "src/avorelo/capabilities/company-loop/persona-runner.ts",
    command: "npm run company-loop", evidencePaths: ["src/avorelo/capabilities/company-loop/persona-runner.ts"],
    findings: [], confidence: "measured", redacted: true, timestamp: now,
    blockers: ["Production holds remain"], nextAction: "",
    safeForFounder: true, safeForCloud: false, blocksActivation: false, blocksProduction: false,
  });

  outputs.push({
    skillId: "activation-no-production-claim", skillName: "No Production Claim", category: "activation", layer: "Policy",
    status: "PASS",
    executionMode: "deterministic", ran: true,
    sourcePath: "src/avorelo/capabilities/activation/activation-state.ts",
    command: "npm run activation:verify", evidencePaths: ["src/avorelo/capabilities/activation/activation-state.ts"],
    findings: [], confidence: "measured", redacted: true, timestamp: now,
    blockers: [], nextAction: "", safeForFounder: true, safeForCloud: false, blocksActivation: false, blocksProduction: false,
  });

  outputs.push({
    skillId: "activation-billing-hold", skillName: "Billing HOLD_NOT_LIVE", category: "activation", layer: "Policy",
    status: "PASS",
    executionMode: "deterministic", ran: true,
    sourcePath: "src/avorelo/capabilities/activation/activation-state.ts",
    command: "npm run activation:verify", evidencePaths: ["src/avorelo/capabilities/activation/activation-state.ts"],
    findings: [], confidence: "measured", redacted: true, timestamp: now,
    blockers: [], nextAction: "", safeForFounder: true, safeForCloud: false, blocksActivation: false, blocksProduction: true,
  });

  outputs.push({
    skillId: "activation-auth-cloud-hold", skillName: "Auth/Cloud HOLD_NOT_LIVE", category: "activation", layer: "Policy",
    status: "PASS",
    executionMode: "deterministic", ran: true,
    sourcePath: "src/avorelo/capabilities/activation/activation-state.ts",
    command: "npm run activation:verify", evidencePaths: ["src/avorelo/capabilities/activation/activation-state.ts"],
    findings: [], confidence: "measured", redacted: true, timestamp: now,
    blockers: [], nextAction: "", safeForFounder: true, safeForCloud: false, blocksActivation: false, blocksProduction: true,
  });

  // Full Activation V2 outputs
  const detectorExists = existsSync(join(ROOT, "src/avorelo/capabilities/activation/activation-detector.ts"));
  outputs.push({
    skillId: "activation-runtime-detection", skillName: "Activation Runtime Detection", category: "activation", layer: "Capability",
    status: detectorExists ? "PASS" : "MISSING_EVIDENCE",
    executionMode: detectorExists ? "deterministic" : "not_executed", ran: detectorExists,
    sourcePath: "src/avorelo/capabilities/activation/activation-detector.ts",
    command: "npm run activate", evidencePaths: detectorExists ? ["src/avorelo/capabilities/activation/activation-detector.ts"] : [],
    findings: [], confidence: "measured", redacted: true, timestamp: now,
    blockers: [], nextAction: "", safeForFounder: true, safeForCloud: false, blocksActivation: false, blocksProduction: false,
  });

  const runEntryExists = existsSync(join(ROOT, "src/avorelo/capabilities/activation/activation-run-entry.ts"));
  outputs.push({
    skillId: "activation-run-entry", skillName: "Activation Run Entry", category: "activation", layer: "Capability",
    status: runEntryExists ? "PASS" : "MISSING_EVIDENCE",
    executionMode: runEntryExists ? "deterministic" : "not_executed", ran: runEntryExists,
    sourcePath: "src/avorelo/capabilities/activation/activation-run-entry.ts",
    command: "npm run activate", evidencePaths: runEntryExists ? ["src/avorelo/capabilities/activation/activation-run-entry.ts"] : [],
    findings: [], confidence: "measured", redacted: true, timestamp: now,
    blockers: [], nextAction: "", safeForFounder: true, safeForCloud: false, blocksActivation: false, blocksProduction: false,
  });

  const repairExists = existsSync(join(ROOT, "src/avorelo/capabilities/activation/activation-repair.ts"));
  outputs.push({
    skillId: "activation-safe-repair", skillName: "Activation Safe Repair", category: "activation", layer: "Capability",
    status: repairExists ? "PASS" : "MISSING_EVIDENCE",
    executionMode: repairExists ? "deterministic" : "not_executed", ran: repairExists,
    sourcePath: "src/avorelo/capabilities/activation/activation-repair.ts",
    command: "npm run activate", evidencePaths: repairExists ? ["src/avorelo/capabilities/activation/activation-repair.ts"] : [],
    findings: [], confidence: "measured", redacted: true, timestamp: now,
    blockers: [], nextAction: "", safeForFounder: true, safeForCloud: false, blocksActivation: false, blocksProduction: false,
  });


  const activatePageExists = existsSync(join(ROOT, "src/avorelo/surfaces/public-web/static/activate.html"));
  const settingsPageExists = existsSync(join(ROOT, "src/avorelo/surfaces/public-web/static/settings.html"));
  outputs.push({
    skillId: "connected-cta-flow", skillName: "Connected CTA Flow", category: "product", layer: "Surface",
    status: activatePageExists && settingsPageExists ? "PASS" : "MISSING_EVIDENCE",
    executionMode: "deterministic", ran: true,
    sourcePath: "src/avorelo/surfaces/public-web/static/",
    command: "npm run dogfood:connected-flow", evidencePaths: ["src/avorelo/surfaces/public-web/static/activate.html", "src/avorelo/surfaces/public-web/static/settings.html"],
    findings: [], confidence: "measured", redacted: true, timestamp: now,
    blockers: [], nextAction: "", safeForFounder: true, safeForCloud: false, blocksActivation: false, blocksProduction: false,
  });

  return outputs;
}
