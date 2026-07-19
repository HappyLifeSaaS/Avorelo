// Avorelo Iteration Drift (V1). Capability-layer drift that needs iteration history.
// Detects proof_drift and progress_drift — kernel drift-guard handles scope/method only.

import type { LoopDriftFinding, LoopIterationSummary, LoopCheckResultStatus } from "../../shared/schemas/index.ts";

export type IterationDriftInput = {
  iterations: LoopIterationSummary[];
  currentFilesChanged: string[];
  previousFilesChanged: string[];
};

export function detectProofDrift(input: IterationDriftInput): LoopDriftFinding[] {
  const findings: LoopDriftFinding[] = [];
  if (input.iterations.length < 2) return findings;

  const last = input.iterations[input.iterations.length - 1];
  const prev = input.iterations[input.iterations.length - 2];

  const lastFailed = Object.entries(last.checkResults).filter(([, v]) => v === "failed").map(([k]) => k);
  const prevFailed = Object.entries(prev.checkResults).filter(([, v]) => v === "failed").map(([k]) => k);

  const repeated = lastFailed.filter((c) => prevFailed.includes(c));
  if (repeated.length > 0) {
    findings.push({
      type: "proof_drift",
      severity: "warning",
      description: `Same checks failed 2 consecutive iterations: ${repeated.join(", ")}`,
      evidence: repeated,
      recommendation: "Stop the loop — repeated identical failures indicate the agent is stuck.",
    });
  }

  return findings;
}

export function detectProgressDrift(input: IterationDriftInput): LoopDriftFinding[] {
  const findings: LoopDriftFinding[] = [];
  if (input.iterations.length < 2) return findings;

  if (input.currentFilesChanged.length === 0) {
    findings.push({
      type: "progress_drift",
      severity: "warning",
      description: "No files changed in the current iteration.",
      evidence: [],
      recommendation: "Agent may be stuck. Consider stopping the loop.",
    });
    return findings;
  }

  const curr = new Set(input.currentFilesChanged);
  const prev = new Set(input.previousFilesChanged);
  if (curr.size === prev.size && [...curr].every((f) => prev.has(f))) {
    findings.push({
      type: "progress_drift",
      severity: "info",
      description: "Same files changed as previous iteration.",
      evidence: [...curr],
      recommendation: "Agent may be oscillating between changes. Monitor next iteration.",
    });
  }

  return findings;
}

export function detectIterationDrift(input: IterationDriftInput): LoopDriftFinding[] {
  return [...detectProofDrift(input), ...detectProgressDrift(input)];
}
