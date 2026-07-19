// Avorelo Evidence Router (Slice 1). Deterministic grading of artifacts into 4 levels + READY eligibility.
// THE ONE RULE: it GRADES; it never decides READY (that is the Stop/Continue Gate). ADR-3.

import type { EvidenceArtifact, GradedEvidence, EvidenceLevel } from "../../shared/schemas/index.ts";

// Deterministic max-grade per artifact kind. A submitter cannot grade UP; the router caps it.
// Kills "no-404 = proof" (http_status_ok caps at NAVIGATION) and "redirect = payment" (redirect caps at INTERACTION).
const KIND_MAX: Record<EvidenceArtifact["kind"], EvidenceLevel | null> = {
  http_status_ok: "NAVIGATION",
  redirect: "INTERACTION",
  ui_action_accepted: "INTERACTION",
  // Slice 4: test pass / screenshot / user confirmation are SIGNALS, not user outcomes — capped below OUTCOME.
  // This is the deterministic home of "test-pass ≠ outcome", "screenshot ≠ proof", "user-said-so ≠ outcome".
  test_passed: "INTERACTION",
  screenshot: "INTERACTION",
  user_confirmed: "INTERACTION",
  persisted_state_change: "OUTCOME",
  // Slice 4: reading the ACTUAL source of truth and finding it matches expected is the strongest outcome signal.
  source_of_truth_readback: "OUTCOME",
  aftermath_correct: "POST_ACTION",
  fixture: null, // simulated -> rejected for readiness
};

export function gradeArtifact(a: EvidenceArtifact): GradedEvidence {
  return { artifactId: a.artifactId, level: KIND_MAX[a.kind], ref: a.ref };
}

export function gradeAll(artifacts: EvidenceArtifact[]): GradedEvidence[] {
  return artifacts.map(gradeArtifact);
}

/** The set of non-null levels present (the fold of evidence for a contract). */
export function levelsPresent(graded: GradedEvidence[]): EvidenceLevel[] {
  const set = new Set<EvidenceLevel>();
  for (const g of graded) if (g.level) set.add(g.level);
  return Array.from(set);
}

/** READY eligibility = OUTCOME AND POST_ACTION present (ADR-3). NAV/INT alone, redirect, fixture -> not eligible. */
export function isReadyEligible(graded: GradedEvidence[]): boolean {
  const levels = levelsPresent(graded);
  return levels.includes("OUTCOME") && levels.includes("POST_ACTION");
}

/** Plausibility / anti-gaming: a readiness claim must reference resolvable, non-fixture evidence. */
export function plausibleForReady(graded: GradedEvidence[]): boolean {
  const usable = graded.filter((g) => g.level !== null);
  if (usable.length === 0) return false;
  // every usable item must carry a ref (no claim without an evidence reference)
  return usable.every((g) => typeof g.ref === "string" && g.ref.length > 0);
}
