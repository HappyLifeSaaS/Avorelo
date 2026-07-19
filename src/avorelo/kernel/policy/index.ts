// Avorelo Policy Matrix (Slice 1, minimal). Deterministic, supreme over model output (ADR-4).
// Slice 1 is synthetic (no live tools), so policy here covers: secret-present -> block; out-of-scope -> block.

import { detectSecretClasses } from "../../shared/redaction/index.ts";
import type { PolicyVerdict, WorkContract } from "../../shared/schemas/index.ts";

export type PolicyInput = {
  contract: WorkContract;
  // candidate content the decision would touch (synthetic in Slice 1)
  content?: unknown;
  // an out-of-scope edit path, if any (synthetic)
  touchedPaths?: string[];
};

export type PolicyResult = { verdict: PolicyVerdict; reasonCodes: string[]; secretClasses: string[] };

export function evaluatePolicy(input: PolicyInput): PolicyResult {
  const reasonCodes: string[] = [];
  // 1) Secret present anywhere in candidate content -> hard block (S2). Never the value, only classes.
  const secretClasses = input.content === undefined ? [] : detectSecretClasses(input.content);
  if (secretClasses.length > 0) {
    reasonCodes.push("SECRET_DETECTED");
    return { verdict: "block", reasonCodes, secretClasses };
  }
  // 2) Out-of-allowedPaths edit -> block (scope).
  const allowed = input.contract.allowedPaths;
  if (input.touchedPaths && allowed.length > 0) {
    const outOfScope = input.touchedPaths.filter(
      (p) => !allowed.some((a) => p === a || p.startsWith(a.replace(/\*+$/, ""))),
    );
    if (outOfScope.length > 0) {
      reasonCodes.push("OUT_OF_SCOPE");
      return { verdict: "block", reasonCodes, secretClasses };
    }
  }
  reasonCodes.push("OK");
  return { verdict: "allow", reasonCodes, secretClasses };
}
