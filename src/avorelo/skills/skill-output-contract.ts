// Avorelo SkillOutput Contract v1. Machine-readable output from any skill, scanner,
// capability, review, or dogfood. Consumed by personas, Founder cockpit, router, and ledger.
// Reference-only or file-existence-only outputs CANNOT produce plain PASS.

export type SkillOutputStatus =
  | "PASS"                    // ran, evidence verified, no issues
  | "PASS_WITH_HOLDS"         // ran, passed core but has non-blocking holds
  | "PASS_WITH_REFERENCE_ONLY"// only reference/checklist evidence, not executed
  | "HOLD"                    // blocked by dependency but not a failure
  | "HOLD_FOR_BROWSER_PROOF"  // browser tool unavailable
  | "HOLD_FOR_EXTERNAL_TOOL"  // external tool not installed
  | "HOLD_FOR_PRODUCTION_CONFIDENCE" // production confidence partial/missing
  | "FAIL"                    // ran, found issues
  | "MISSING_EVIDENCE"        // required evidence not found
  | "REFERENCE_ONLY"          // only documented, never executed
  | "NOT_AVAILABLE"           // tool/capability does not exist
  | "BLOCKED";                // hard blocker

export type ExecutionMode =
  | "deterministic"           // ran as deterministic local code
  | "scanner"                 // ran as scanner
  | "checklist"               // manual/reference checklist applied
  | "browser"                 // browser-based proof
  | "model_assisted"          // LLM/model helped but did not decide
  | "reference"               // reference-only, not executed
  | "external_tool"           // external tool ran
  | "artifact_readback"       // read existing artifact
  | "not_executed";           // did not run

export type Confidence = "measured" | "estimated" | "inferred" | "unverified";

export type SkillOutput = {
  skillId: string;
  skillName: string;
  category: string;
  layer: string;
  status: SkillOutputStatus;
  executionMode: ExecutionMode;
  sourcePath: string;
  command: string;
  ran: boolean;
  evidencePaths: string[];
  findings: string[];
  confidence: Confidence;
  redacted: true;
  timestamp: number;
  blockers: string[];
  nextAction: string;
  safeForFounder: boolean;
  safeForCloud: boolean;
  blocksActivation: boolean;
  blocksProduction: boolean;
};

/** Validate that a SkillOutput does not violate truth rules */
export function validateSkillOutput(so: SkillOutput): string[] {
  const errors: string[] = [];
  // Reference-only cannot be plain PASS
  if (so.executionMode === "reference" && so.status === "PASS") {
    errors.push(`${so.skillId}: reference-only execution mode cannot produce plain PASS`);
  }
  // Not executed cannot be PASS
  if (so.executionMode === "not_executed" && so.status === "PASS") {
    errors.push(`${so.skillId}: not_executed cannot produce PASS`);
  }
  // Ran=false cannot be PASS
  if (!so.ran && so.status === "PASS") {
    errors.push(`${so.skillId}: ran=false cannot produce PASS`);
  }
  // No evidence paths with PASS
  if (so.status === "PASS" && so.evidencePaths.length === 0 && so.executionMode !== "deterministic") {
    errors.push(`${so.skillId}: PASS without evidence paths (non-deterministic mode)`);
  }
  return errors;
}
