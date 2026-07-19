// Fake tool adapters for CI testing. No real tool installations required.

import type { ToolAvailability, ToolAdapterId, WellKnownAdapterId, ReviewRound, ReviewVerdict, MultiAgentReviewResult } from "../types.ts";

export function fakeAvailability(
  id: ToolAdapterId,
  status: "available" | "unavailable" | "unknown" | "cooldown",
  now: number,
  signals: string[] = [],
): ToolAvailability {
  return {
    adapterId: id,
    status,
    detectionMethod: "fake_for_test",
    version: status === "available" ? "1.0.0-fake" : null,
    signals: signals.length > 0 ? signals : [status === "available" ? `fake_${id}_installed` : `fake_${id}_not_found`],
    failureClass: status === "available" ? null : "not_detected",
    checkedAt: now,
  };
}

export function fakeAllAvailable(now: number): Record<WellKnownAdapterId, "available"> {
  return {
    "deterministic-local": "available",
    "manual-gate": "available",
    "scanner": "available",
    "semgrep": "available",
    "playwright-proof": "available",
    "github-actions": "available",
    "claude-code": "available",
    "codex": "available",
    "gemini-cli": "available",
    "aider": "available",
    "cursor": "available",
  };
}

export function fakeNoneAvailable(now: number): Record<WellKnownAdapterId, "unavailable"> {
  return {
    "deterministic-local": "unavailable",
    "manual-gate": "unavailable",
    "scanner": "unavailable",
    "semgrep": "unavailable",
    "playwright-proof": "unavailable",
    "github-actions": "unavailable",
    "claude-code": "unavailable",
    "codex": "unavailable",
    "gemini-cli": "unavailable",
    "aider": "unavailable",
    "cursor": "unavailable",
  };
}

export function fakeOnlyLocal(now: number): Record<WellKnownAdapterId, "available" | "unavailable"> {
  return {
    "deterministic-local": "available",
    "manual-gate": "available",
    "scanner": "available",
    "semgrep": "available",
    "playwright-proof": "unavailable",
    "github-actions": "unavailable",
    "claude-code": "unavailable",
    "codex": "unavailable",
    "gemini-cli": "unavailable",
    "aider": "unavailable",
    "cursor": "unavailable",
  };
}

export function fakeOnlyClaudeCode(now: number): Record<WellKnownAdapterId, "available" | "unavailable"> {
  return {
    "deterministic-local": "available",
    "manual-gate": "available",
    "scanner": "available",
    "semgrep": "available",
    "playwright-proof": "unavailable",
    "github-actions": "unavailable",
    "claude-code": "available",
    "codex": "unavailable",
    "gemini-cli": "unavailable",
    "aider": "unavailable",
    "cursor": "unavailable",
  };
}

export function fakeOnlyCodex(now: number): Record<WellKnownAdapterId, "available" | "unavailable"> {
  return {
    "deterministic-local": "available",
    "manual-gate": "available",
    "scanner": "available",
    "semgrep": "available",
    "playwright-proof": "unavailable",
    "github-actions": "unavailable",
    "claude-code": "unavailable",
    "codex": "available",
    "gemini-cli": "unavailable",
    "aider": "unavailable",
    "cursor": "unavailable",
  };
}

export function fakeReviewRound(
  round: number,
  executorAdapter: ToolAdapterId,
  reviewerAdapter: ToolAdapterId,
  verdict: ReviewVerdict,
  verifierPassed: boolean | null = null,
): ReviewRound {
  return {
    round,
    executorAdapter,
    reviewerAdapter,
    verdict,
    reasonCodes: [`FAKE_REVIEW_ROUND_${round}`, `VERDICT:${verdict}`],
    durationMs: 50 + round * 10,
    verifierPassed,
    containsRawModelOutput: false,
  };
}

export function fakeMultiAgentReviewResult(opts?: {
  enabled?: boolean;
  rounds?: ReviewRound[];
  finalVerdict?: ReviewVerdict;
  modelConsensusOnly?: boolean;
  routedToManualGate?: boolean;
}): MultiAgentReviewResult {
  const rounds = opts?.rounds ?? [];
  return {
    attempted: opts?.enabled !== false,
    roundsCompleted: rounds.length,
    maxRoundsReached: false,
    finalVerdict: opts?.finalVerdict ?? (rounds.length > 0 ? rounds[rounds.length - 1].verdict : null),
    rounds,
    totalDurationMs: rounds.reduce((sum, r) => sum + r.durationMs, 0),
    reasonCodes: rounds.flatMap((r) => r.reasonCodes),
    modelConsensusOnly: opts?.modelConsensusOnly ?? false,
    externalProofRequired: false,
    routedToManualGate: opts?.routedToManualGate ?? false,
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
    containsRawModelOutput: false,
  };
}
