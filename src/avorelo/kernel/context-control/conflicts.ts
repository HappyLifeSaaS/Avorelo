import { randomUUID } from "node:crypto";
import type { ContextMemoryItem, ContextConflict, ConflictType } from "./types.ts";
import { scoreTrust, trustBeats } from "./trust.ts";

export function detectConflicts(items: ContextMemoryItem[]): ContextConflict[] {
  const conflicts: ContextConflict[] = [];

  conflicts.push(...detectProductionStatusConflicts(items));
  conflicts.push(...detectInstructionConflicts(items));
  conflicts.push(...detectHandoffConflicts(items));
  conflicts.push(...detectTestResultConflicts(items));
  conflicts.push(...detectMissingProofConflicts(items));

  return conflicts;
}

function detectProductionStatusConflicts(items: ContextMemoryItem[]): ContextConflict[] {
  const conflicts: ContextConflict[] = [];
  const productionClaims = items.filter((i) =>
    /production[- ]?ready|deployed|live in prod/i.test(i.summary),
  );
  const deployMissing = items.filter((i) =>
    /deploy missing|not deployed|no production receipt|pending deploy/i.test(i.summary),
  );

  for (const claim of productionClaims) {
    for (const missing of deployMissing) {
      const trustClaim = scoreTrust(claim);
      const trustMissing = scoreTrust(missing);
      const stronger = trustBeats(trustMissing, trustClaim) ? missing : claim;
      const weaker = stronger === claim ? missing : claim;

      conflicts.push(makeConflict(
        "production_status_conflict",
        [claim.id, missing.id],
        { itemId: stronger.id, reason: `Stronger evidence: ${scoreTrust(stronger).reason}` },
        { itemId: weaker.id, reason: `Weaker evidence: ${scoreTrust(weaker).reason}` },
        "Treat production status as not verified until a current production verification receipt exists.",
        "Blocks production-ready claim.",
        "Run owner-approved production verification and generate receipt.",
        "pending_verification",
      ));
    }
  }

  return conflicts;
}

function detectInstructionConflicts(items: ContextMemoryItem[]): ContextConflict[] {
  const conflicts: ContextConflict[] = [];
  const instructions = items.filter((i) => i.type === "instruction" || i.type === "policy");

  for (let i = 0; i < instructions.length; i++) {
    for (let j = i + 1; j < instructions.length; j++) {
      const a = instructions[i];
      const b = instructions[j];

      if (a.source.path && b.source.path && a.source.path !== b.source.path) {
        const aIsPolicy = a.type === "policy" || a.source.path.includes("CLAUDE.md");
        const bIsPolicy = b.type === "policy" || b.source.path.includes("CLAUDE.md");

        if (aIsPolicy !== bIsPolicy) {
          const stronger = aIsPolicy ? a : b;
          const weaker = aIsPolicy ? b : a;

          if (hasConflictingContent(stronger.summary, weaker.summary)) {
            conflicts.push(makeConflict(
              "instruction_conflict",
              [a.id, b.id],
              { itemId: stronger.id, reason: `Stronger policy source: ${stronger.source.path}` },
              { itemId: weaker.id, reason: `Weaker instruction source: ${weaker.source.path}` },
              "Stronger explicit policy wins; conflict recorded.",
              "Agent may follow wrong instruction.",
              "Reconcile conflicting instructions between sources.",
              "follow_stronger_policy",
            ));
          }
        }
      }
    }
  }

  return conflicts;
}

function detectHandoffConflicts(items: ContextMemoryItem[]): ContextConflict[] {
  const conflicts: ContextConflict[] = [];
  const handoffs = items.filter((i) => i.type === "handoff");
  const currentState = items.filter((i) =>
    i.source.kind === "git" || i.source.kind === "receipt" || i.source.kind === "dashboard_state",
  );

  for (const handoff of handoffs) {
    if (handoff.freshness.status === "stale" || handoff.freshness.status === "expired") {
      const newerEvidence = currentState.find((s) => {
        const trustS = scoreTrust(s);
        const trustH = scoreTrust(handoff);
        return trustBeats(trustS, trustH);
      });

      if (newerEvidence) {
        conflicts.push(makeConflict(
          "stale_handoff_conflict",
          [handoff.id, newerEvidence.id],
          { itemId: newerEvidence.id, reason: "Newer verified state" },
          { itemId: handoff.id, reason: "Stale handoff document" },
          "Old handoff treated as historical context, not current truth.",
          "Agent might act on stale assumptions.",
          "Verify current state against handoff claims.",
          "exclude_from_working_truth",
        ));
      }
    }
  }

  return conflicts;
}

function detectTestResultConflicts(items: ContextMemoryItem[]): ContextConflict[] {
  const conflicts: ContextConflict[] = [];
  const testPassed = items.filter((i) =>
    i.type === "proof" && /tests?\s+pass/i.test(i.summary),
  );
  const dirtyState = items.filter((i) =>
    /dirty|uncommitted|modified/i.test(i.summary) && i.source.kind === "git",
  );

  for (const test of testPassed) {
    for (const dirty of dirtyState) {
      conflicts.push(makeConflict(
        "test_result_conflict",
        [test.id, dirty.id],
        { itemId: dirty.id, reason: "Current git state shows uncommitted changes" },
        { itemId: test.id, reason: "Tests passed on previous state" },
        "Tests passed on previous state; current state needs re-verification.",
        "Agent might assume tests cover current changes.",
        "Re-run tests after committing current changes.",
        "pending_reverification",
      ));
    }
  }

  return conflicts;
}

function detectMissingProofConflicts(items: ContextMemoryItem[]): ContextConflict[] {
  const conflicts: ContextConflict[] = [];
  const readyClaims = items.filter((i) =>
    /ready|complete|done|verified/i.test(i.summary) &&
    i.trust.level !== "verified",
  );

  for (const claim of readyClaims) {
    const hasProof = items.some((i) =>
      i.type === "proof" &&
      i.trust.level === "verified" &&
      i.scope.feature === claim.scope.feature,
    );

    if (!hasProof) {
      conflicts.push(makeConflict(
        "missing_proof_conflict",
        [claim.id],
        { itemId: claim.id, reason: "Claim exists but no verified proof found" },
        { itemId: claim.id, reason: "Same item — no supporting evidence" },
        "Downgrade to pending verification until proof receipt exists.",
        "Agent might claim completion without evidence.",
        "Generate verification receipt with targeted tests.",
        "pending_verification",
      ));
    }
  }

  return conflicts;
}

function hasConflictingContent(a: string, b: string): boolean {
  const aNeg = /\b(?:do not|don't|must not|never|block|deny|disable)\b/i.test(a);
  const bNeg = /\b(?:do not|don't|must not|never|block|deny|disable)\b/i.test(b);
  if (aNeg !== bNeg) return true;

  const aAllow = /\b(?:allow|enable|permit|can)\b/i.test(a);
  const bAllow = /\b(?:allow|enable|permit|can)\b/i.test(b);
  if (aAllow !== bAllow && (aNeg || bNeg)) return true;

  return false;
}

function makeConflict(
  type: ConflictType,
  itemIds: string[],
  stronger: { itemId: string; reason: string },
  weaker: { itemId: string; reason: string },
  resolution: string,
  impact: string,
  requiredNextProof: string,
  safeDefault: string,
): ContextConflict {
  return {
    schemaVersion: "1.0.0",
    conflictId: `conflict_${randomUUID().slice(0, 8)}`,
    type,
    items: itemIds,
    strongerEvidence: stronger,
    weakerEvidence: weaker,
    resolution,
    impact,
    requiredNextProof,
    safeDefault,
  };
}
