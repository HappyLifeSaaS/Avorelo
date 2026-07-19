// Avorelo Migration Scorecard (Slice 4.5). Deterministic migration candidate scoring.
// THE ONE RULE: owns no policy/evidence/receipt truth. Produces a migration scorecard
// and receipt from a candidate inventory. Every migration candidate must have an owner,
// a mode, and a required proof set. No silent dropping.

import type { MigrationCandidate, MigrationReceipt, MigrationMode } from "../../shared/schemas/index.ts";
import { redact } from "../../shared/redaction/index.ts";

export type ScorecardInput = {
  candidates: MigrationCandidate[];
  receiptId?: string;
};

export type ScorecardResult = {
  receipt: MigrationReceipt;
  accepted: MigrationCandidate[];
  deferred: MigrationCandidate[];
  rejected: MigrationCandidate[];
  errors: string[];
};

const ACCEPT_MODES: Set<MigrationMode> = new Set([
  "REBUILD_NOW", "REWRITE_CLEAN", "TRANSFER_CODE_IF_CONTRACT_COMPATIBLE",
]);
const DEFER_MODES: Set<MigrationMode> = new Set([
  "REBUILD_LATER", "CONCEPT_ONLY", "MINE_LATER",
  "PRESERVE_AS_REQUIREMENT", "PRESERVE_AS_EVIDENCE", "PRESERVE_AS_REFERENCE",
]);
const REJECT_MODES: Set<MigrationMode> = new Set([
  "DEPRECATE_DUPLICATE", "REJECT_UNSAFE", "REJECT_SUPERSEDED",
]);

/**
 * Validate and score a migration candidate inventory.
 * Returns a receipt with Found/Fixed/Proved/Needs Attention.
 * Deterministic. No LLM. No network.
 */
export function scoreInventory(input: ScorecardInput): ScorecardResult {
  const errors: string[] = [];
  const accepted: MigrationCandidate[] = [];
  const deferred: MigrationCandidate[] = [];
  const rejected: MigrationCandidate[] = [];

  for (const c of input.candidates) {
    // Validate: every candidate must have an owner and migration mode
    if (!c.canonicalOwner || c.canonicalOwner.trim() === "") {
      errors.push(`${c.candidateId}: missing canonical owner`);
    }
    if (c.migrationMode === "UNKNOWN_NEEDS_REVIEW") {
      errors.push(`${c.candidateId}: migration mode is UNKNOWN_NEEDS_REVIEW — needs decision`);
    }
    // Validate: no candidate accepted without required proof
    if (ACCEPT_MODES.has(c.migrationMode) && c.requiredProof.length === 0) {
      errors.push(`${c.candidateId}: accepted for migration but has no required proof`);
    }
    // Validate: duplication risk flagged
    if (c.duplicationRisk) {
      errors.push(`${c.candidateId}: duplication risk — would create second owner for this concern`);
    }

    // Classify
    if (ACCEPT_MODES.has(c.migrationMode)) accepted.push(c);
    else if (DEFER_MODES.has(c.migrationMode)) deferred.push(c);
    else if (REJECT_MODES.has(c.migrationMode)) rejected.push(c);
    else deferred.push(c); // unknown = deferred, not silently dropped
  }

  const found = input.candidates.map(c => `${c.candidateId}: ${c.capability} (${c.migrationMode})`);
  const fixed = [
    ...accepted.map(c => `accepted: ${c.candidateId} → ${c.canonicalOwner}`),
    ...rejected.map(c => `rejected: ${c.candidateId} (${c.migrationMode})`),
  ];
  const proved = accepted
    .filter(c => c.requiredProof.length > 0)
    .map(c => `${c.candidateId}: requires ${c.requiredProof.join(", ")}`);
  const needsAttention = [
    ...errors,
    ...deferred.map(c => `deferred: ${c.candidateId} — ${c.migrationMode}`),
  ];

  const receipt: MigrationReceipt = {
    receiptId: input.receiptId ?? `mig_${Date.now()}`,
    generatedAt: Date.now(),
    found: redact(found).value as string[],
    fixed: redact(fixed).value as string[],
    proved: redact(proved).value as string[],
    needsAttention: redact(needsAttention).value as string[],
    candidateCount: input.candidates.length,
    acceptedCount: accepted.length,
    deferredCount: deferred.length,
    rejectedCount: rejected.length,
    redaction: "applied",
  };

  return { receipt, accepted, deferred, rejected, errors };
}

/**
 * Validate that no legacy brand names leak into runtime paths.
 * Returns an array of violations.
 */
export function checkLegacyBrandLeaks(paths: string[]): string[] {
  const LEGACY = [/\bcco\b/i, /\bwuz\b/i, /\bclaudecode-optimizer\b/i];
  const violations: string[] = [];
  for (const p of paths) {
    for (const pattern of LEGACY) {
      if (pattern.test(p)) {
        violations.push(`legacy brand in path: ${p}`);
      }
    }
  }
  return violations;
}
