// Avorelo Architecture Invariant Dogfood. Proves later phases consume Secret Boundary rather than
// reimplementing or bypassing it. Local-only, deterministic, no network, synthetic fixtures only.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(SRC, relPath), "utf8");
}

function run() {
  const gates: { gate: string; pass: boolean; detail: string }[] = [];
  const g = (gate: string, pass: boolean, detail = "") => gates.push({ gate, pass, detail });

  // 1. WorkContract routing consumes Secret Boundary — imports evaluateSafeRun, detectInString, redactString
  const routing = readSrc("kernel/work-contract/routing.ts");
  g("routing_imports_evaluateSafeRun", routing.includes('from "../../capabilities/secret-boundary/safe-run.ts"'));
  g("routing_imports_detectInString", routing.includes('from "../../capabilities/secret-boundary/detector.ts"'));
  g("routing_imports_redactString", routing.includes('from "../../capabilities/secret-boundary/redactor.ts"'));
  g("routing_does_not_reimplement_detector", !routing.includes("ghp_[A-Za-z0-9]") && !routing.includes("AKIA[A-Z0-9]"));
  g("routing_block_forces_blocked_route", routing.includes('"blocked"'));

  // 2. Context Compiler uses SafeReferences / redacted boundary outputs
  const cc = readSrc("capabilities/context-compiler/index.ts");
  g("context_compiler_imports_scanContent", cc.includes('from "../secret-boundary/index.ts"'));
  g("context_compiler_imports_classifySource", cc.includes('from "../secret-boundary/source-trust.ts"'));
  g("context_compiler_imports_scanInstructionRisk", cc.includes('from "../secret-boundary/instruction-risk.ts"'));
  g("context_compiler_does_not_reimplement_detector", !cc.includes("ghp_[A-Za-z0-9]") && !cc.includes("AKIA[A-Z0-9]"));
  g("context_compiler_declares_containsRawSecret_false", cc.includes("containsRawSecret: false"));

  // 3. Continuity uses SafeReferences and metadata projection
  const cont = readSrc("capabilities/continuity/index.ts");
  g("continuity_imports_redactString", cont.includes('from "../secret-boundary/redactor.ts"'));
  g("continuity_does_not_reimplement_redactor", !cont.includes("[REDACTED:") || cont.includes("redactString"));
  g("continuity_declares_containsRawSecret_false", cont.includes("containsRawSecret: false"));
  g("continuity_excludedRefs_reason_codes_only", cont.includes("r.safetyReasonCode") || cont.includes(".safetyReasonCode"));

  // 4. Token/Cost rejects forbidden raw fields
  const tc = readSrc("capabilities/token-cost-evidence/index.ts");
  g("token_cost_imports_redactString", tc.includes('from "../secret-boundary/redactor.ts"'));
  g("token_cost_has_forbidden_import_keys", tc.includes("FORBIDDEN_IMPORT_KEYS"));
  g("token_cost_rejects_prompt_field", tc.includes('"prompt"'));
  g("token_cost_rejects_secret_field", tc.includes('"secret"'));
  g("token_cost_does_not_reimplement_detector", !tc.includes("ghp_[A-Za-z0-9]"));

  // 5. Proof Report redacts unsafe text and cannot invent savings
  const pr = readSrc("capabilities/proof-report/index.ts");
  g("proof_report_imports_redactString", pr.includes('from "../secret-boundary/redactor.ts"'));
  g("proof_report_imports_classifyPayload", pr.includes('from "../../shared/redaction/policy.ts"'));
  g("proof_report_has_safeText_defense_in_depth", pr.includes("safeText"));
  g("proof_report_savingsClaimAllowed_defaults_false", pr.includes("savingsClaimAllowed: false"));
  g("proof_report_does_not_reimplement_detector", !pr.includes("ghp_[A-Za-z0-9]"));

  // 6. Value Ledger consumes proof metadata only
  const vl = readSrc("capabilities/value-ledger/index.ts");
  g("value_ledger_imports_redactString", vl.includes('from "../secret-boundary/redactor.ts"'));
  g("value_ledger_does_not_reimplement_detector", !vl.includes("ghp_[A-Za-z0-9]") && !vl.includes("AKIA[A-Z0-9]"));
  g("value_ledger_does_not_claim_roi", !vl.includes('"roi"') && !vl.includes('"ROI"'));

  // 7. Cloud eligibility remains Phase 1 allowlist-derived
  const elig = readSrc("kernel/receipts/eligibility.ts");
  g("cloud_eligibility_has_allowlist_check", elig.includes("allowlisted") || elig.includes("allowlist"));
  g("cloud_eligibility_has_redacted_check", elig.includes("redacted"));

  // 8. Adapter now consumes postToolUseRedact from Secret Boundary
  const adapter = readSrc("adapters/claude-code/index.ts");
  g("adapter_imports_postToolUseRedact", adapter.includes('from "../../capabilities/secret-boundary/runtime-gate.ts"'));
  g("adapter_posttooluse_returns_mutation_fields", adapter.includes("updatedToolOutput") && adapter.includes("updatedMcpToolOutput"));

  // 9. No downstream module reimplements the secret detector patterns
  const downstreamFiles = [routing, cc, cont, tc, pr, vl];
  const detectorPatterns = ["ghp_[A-Za-z0-9]{36}", "AKIA[A-Z0-9]{16}", "sk_live_", "-----BEGIN.*PRIVATE KEY-----"];
  for (const pat of detectorPatterns) {
    g(`no_downstream_reimplements_${pat.slice(0, 12).replace(/[^a-z0-9]/gi, "_")}`,
      !downstreamFiles.some(f => f.includes(pat)));
  }

  const failedGates = gates.filter(x => !x.pass);
  const ok = failedGates.length === 0;
  const summary = {
    ok,
    gates: { total: gates.length, passed: gates.length - failedGates.length, failed: failedGates.map(x => x.gate) },
    detail: { gates },
  };
  process.stdout.write("AVORELO ARCHITECTURE-INVARIANTS DOGFOOD\n" + JSON.stringify(summary, null, 2) + "\n");
  process.exit(ok ? 0 : 1);
}

run();
