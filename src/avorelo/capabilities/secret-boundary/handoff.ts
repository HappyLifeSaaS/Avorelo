// Avorelo Secret Boundary — Worker handoff references (Phase 2). Adapted from old PR #138 (buildWorkerHandoff).
// A handoff carries REFERENCES (paths, ids, SafeReferences), never raw code/secrets/PII. Reality checks:
// worker_handoff_excludes_secrets, worker_handoff_uses_references_not_dumps.

import { redactValue } from "./redactor.ts";
import { makeSafeReference } from "../../shared/safe-reference/index.ts";
import type { SafeReference } from "../../shared/schemas/index.ts";

export type WorkerHandoff = {
  contract: "avorelo.workerHandoff.v1";
  objective: string; // safe, redacted summary
  fileReferences: string[]; // paths only, no contents
  safeReferences: SafeReference[]; // references to any sensitive material
  reasonCodes: string[];
  redacted: true;
  containsRawSecret: false;
  containsRawSource: false;
};

export type BuildHandoffInput = {
  objective: string;
  files?: string[]; // path references only
  // Any material the caller might have wanted to "dump" — it is converted to SafeReferences, never embedded.
  sensitiveMaterial?: { id: string; label: string; sourceKind?: SafeReference["sourceKind"]; riskClass?: SafeReference["riskClass"] }[];
};

/** Build a worker handoff that references rather than dumps. Objective is redacted; no raw content embedded. */
export function buildWorkerHandoff(input: BuildHandoffInput): WorkerHandoff {
  const objective = redactValue(String(input.objective ?? ""), "handoff").redacted as string;
  const safeReferences = (input.sensitiveMaterial ?? []).map((m) =>
    makeSafeReference({ id: m.id, label: m.label, sourceKind: m.sourceKind ?? "handoff", riskClass: m.riskClass ?? "sensitive", safeReasonCodes: ["handoff_reference_only"] }),
  );
  return {
    contract: "avorelo.workerHandoff.v1",
    objective,
    fileReferences: (input.files ?? []).map((f) => String(f)),
    safeReferences,
    reasonCodes: ["references_not_dumps", "no_raw_secret", "no_raw_source"],
    redacted: true,
    containsRawSecret: false,
    containsRawSource: false,
  };
}
