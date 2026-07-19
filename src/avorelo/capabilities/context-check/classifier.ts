// Avorelo Agent Context Check — risk classifier. Deterministic, conservative classification.
// No content upload, no secret exposure. Evidence = path + reason only.

import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { ContextSource, ContextFinding, FindingCode, Severity, Confidence, WorkContractRef } from "./types.ts";

const OVERSIZE_WARNING_TOKENS = 8_000;
const OVERSIZE_ATTENTION_TOKENS = 25_000;
const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const STALE_MARKERS = /\b(temp|temporary|workaround|hack|todo|fixme|legacy|remove.after|remove.before|delete.after|delete.before|wip|experiment)\b/i;

export function classify(
  sources: ContextSource[],
  repoRoot: string,
  workContract?: WorkContractRef,
): ContextFinding[] {
  const findings: ContextFinding[] = [];
  const now = Date.now();

  for (const src of sources) {
    findings.push(...checkBrokenReferences(src, repoRoot));
    findings.push(...checkOversizedContext(src));
    findings.push(...checkStaleTemp(src, now));
    findings.push(...checkRuleMatchesNoFiles(src, repoRoot));
  }

  findings.push(...checkBroadScope(sources, workContract));
  findings.push(...checkConflictingInstructions(sources));
  findings.push(...checkExcludedRelevantContext(sources, workContract));
  findings.push(...checkWorkContractMismatch(sources, workContract));

  return findings;
}

function checkBrokenReferences(src: ContextSource, repoRoot: string): ContextFinding[] {
  const findings: ContextFinding[] = [];
  for (const ref of src.references) {
    const resolvedPath = join(repoRoot, dirname(src.path), ref);
    const resolvedFromRoot = join(repoRoot, ref);
    if (!existsSync(resolvedPath) && !existsSync(resolvedFromRoot)) {
      findings.push({
        code: "BROKEN_CONTEXT_REFERENCE",
        severity: "warning",
        confidence: "medium",
        path: src.path,
        message: `Reference "${ref}" not found on disk.`,
        reason: "Referenced file/path does not exist relative to instruction file or repo root.",
        evidence: `source=${src.path} ref=${ref}`,
        relatedPaths: [ref],
        suggestedAction: "Verify the reference path or remove if no longer needed.",
        blocksAutonomousWork: false,
      });
    }
  }
  return findings;
}

function checkOversizedContext(src: ContextSource): ContextFinding[] {
  if (src.estimatedTokens < OVERSIZE_WARNING_TOKENS) return [];
  const severe = src.estimatedTokens >= OVERSIZE_ATTENTION_TOKENS;
  return [{
    code: "OVERSIZED_AGENT_CONTEXT",
    severity: severe ? "needs_attention" : "info",
    confidence: "high",
    path: src.path,
    message: `Instruction file is ~${src.estimatedTokens.toLocaleString()} estimated tokens (${Math.round(src.sizeBytes / 1024)}KB).`,
    reason: "Large instruction files consume context budget and may degrade agent performance.",
    evidence: `size=${src.sizeBytes} tokens=${src.estimatedTokens}`,
    relatedPaths: [],
    suggestedAction: severe
      ? "Consider splitting into focused instruction files or removing stale content."
      : "Review whether all content is actively needed.",
    blocksAutonomousWork: false,
  }];
}

function checkStaleTemp(src: ContextSource, now: number): ContextFinding[] {
  if (!src.path.match(STALE_MARKERS)) return [];
  const ageMs = now - src.lastModified;
  if (ageMs < STALE_THRESHOLD_MS) return [];
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  return [{
    code: "STALE_TEMP_INSTRUCTION",
    severity: "warning",
    confidence: "medium",
    path: src.path,
    message: `Temporary instruction file is ${ageDays} days old (last modified ${new Date(src.lastModified).toISOString().slice(0, 10)}).`,
    reason: "File name suggests temporary/workaround content that may no longer be intentional.",
    evidence: `age=${ageDays}d path=${src.path}`,
    relatedPaths: [],
    suggestedAction: "Review whether this instruction is still needed, or rename if intentional.",
    blocksAutonomousWork: false,
  }];
}

function checkRuleMatchesNoFiles(src: ContextSource, repoRoot: string): ContextFinding[] {
  if (!src.appliesToPaths || src.appliesToPaths.length === 0) return [];
  if (src.appliesToPaths.some(g => g === "**/*" || g === "*")) return [];

  for (const glob of src.appliesToPaths) {
    if (glob.includes("*")) continue;
    const target = join(repoRoot, glob);
    if (!existsSync(target)) {
      return [{
        code: "RULE_MATCHES_NO_FILES",
        severity: "info",
        confidence: "medium",
        path: src.path,
        message: `Rule glob "${glob}" does not match any existing path.`,
        reason: "Rule targets a specific path that does not exist; may be stale or mistyped.",
        evidence: `glob=${glob} source=${src.path}`,
        relatedPaths: [glob],
        suggestedAction: "Verify the target path or update the glob pattern.",
        blocksAutonomousWork: false,
      }];
    }
  }
  return [];
}

function checkBroadScope(sources: ContextSource[], wc?: WorkContractRef): ContextFinding[] {
  if (!wc || !wc.allowedPaths || wc.allowedPaths.length === 0) return [];
  const findings: ContextFinding[] = [];

  for (const src of sources) {
    if (!src.appliesToPaths) continue;
    const hasBroadGlob = src.appliesToPaths.some(g => g === "**/*" || g === "*" || g === "**");
    if (!hasBroadGlob) continue;

    const scopeNarrow = wc.allowedPaths.every(p => p.split("/").length >= 2);
    if (scopeNarrow) {
      findings.push({
        code: "BROAD_INSTRUCTION_SCOPE",
        severity: "warning",
        confidence: "low",
        path: src.path,
        message: "Rule applies to all files but Work Contract scope is narrow.",
        reason: "Broad instruction may pull the agent outside the intended task scope.",
        evidence: `glob=${src.appliesToPaths.join(",")} contractScope=${wc.allowedPaths.join(",")}`,
        relatedPaths: wc.allowedPaths,
        suggestedAction: "Review whether this broad rule is intentional for the current task.",
        blocksAutonomousWork: false,
      });
    }
  }
  return findings;
}

function checkConflictingInstructions(sources: ContextSource[]): ContextFinding[] {
  const families = new Set(sources.map(s => s.agentFamily));
  if (families.size < 2) return [];

  const hasClaude = sources.some(s => s.agentFamily === "claude");
  const hasCursor = sources.some(s => s.agentFamily === "cursor");
  if (!hasClaude || !hasCursor) return [];

  return [{
    code: "POSSIBLE_CONFLICTING_INSTRUCTIONS",
    severity: "info",
    confidence: "low",
    path: sources[0].path,
    message: "Multiple agent instruction families detected (Claude + Cursor).",
    reason: "Different tools may receive different instructions; verify they are consistent.",
    evidence: `families=${[...families].join(",")}`,
    relatedPaths: sources.filter(s => s.agentFamily === "claude" || s.agentFamily === "cursor").map(s => s.path),
    suggestedAction: "Verify that instructions across tools are consistent for this task.",
    blocksAutonomousWork: false,
  }];
}

function checkExcludedRelevantContext(sources: ContextSource[], wc?: WorkContractRef): ContextFinding[] {
  if (!wc) return [];
  const findings: ContextFinding[] = [];

  // Source-level excludedPaths (from structured adapter metadata, if available)
  if (wc.allowedPaths && wc.allowedPaths.length > 0) {
    for (const src of sources) {
      if (!src.excludedPaths || src.excludedPaths.length === 0) continue;
      for (const excl of src.excludedPaths) {
        const relevant = wc.allowedPaths.some(ap => ap.includes(excl) || excl.includes(ap));
        if (relevant) {
          findings.push({
            code: "EXCLUDED_RELEVANT_CONTEXT",
            severity: "warning",
            confidence: "low",
            path: src.path,
            message: `Excluded path "${excl}" may be relevant to the current task scope.`,
            reason: "An instruction file excludes a path that overlaps with the Work Contract scope.",
            evidence: `excluded=${excl} contractScope=${wc.allowedPaths.join(",")}`,
            relatedPaths: [excl],
            suggestedAction: "Review whether this exclusion is intentional for the current task.",
            blocksAutonomousWork: false,
          });
        }
      }
    }
  }

  // Work Contract excludedPaths: deterministic structured exclusions from the user
  if (wc.excludedPaths && wc.excludedPaths.length > 0) {
    for (const src of sources) {
      const srcPath = src.path.toLowerCase();
      for (const excl of wc.excludedPaths) {
        const exclLower = excl.toLowerCase();
        const sourceOverlaps = srcPath.includes(exclLower) || exclLower.includes(srcPath);
        const appliesOverlaps = src.appliesToPaths?.some(ap =>
          ap.toLowerCase().includes(exclLower) || exclLower.includes(ap.toLowerCase())
        );
        if (sourceOverlaps || appliesOverlaps) {
          findings.push({
            code: "EXCLUDED_RELEVANT_CONTEXT",
            severity: "warning",
            confidence: "medium",
            path: src.path,
            message: `Instruction source overlaps with excluded path "${excl}" from Work Contract.`,
            reason: "Work Contract explicitly excludes this path, but an instruction source covers it.",
            evidence: `excluded=${excl} source=${src.path}`,
            relatedPaths: [excl],
            suggestedAction: "Review whether this instruction file should be active given the exclusion.",
            blocksAutonomousWork: false,
          });
        }
      }
    }
  }

  return findings;
}

function checkWorkContractMismatch(sources: ContextSource[], wc?: WorkContractRef): ContextFinding[] {
  if (!wc || !wc.nonGoals || wc.nonGoals.length === 0) return [];
  const findings: ContextFinding[] = [];
  const nonGoalPatterns = wc.nonGoals.map(ng => ng.toLowerCase());

  for (const src of sources) {
    const pathLower = src.path.toLowerCase();
    for (const ng of nonGoalPatterns) {
      const words = ng.split(/\s+/).filter(w => w.length > 3);
      const match = words.some(w => pathLower.includes(w));
      if (match) {
        findings.push({
          code: "WORK_CONTRACT_CONTEXT_MISMATCH",
          severity: "warning",
          confidence: "low",
          path: src.path,
          message: `Instruction file path suggests content related to a non-goal: "${ng}".`,
          reason: "Agent instruction may direct work toward an area explicitly excluded by the Work Contract.",
          evidence: `path=${src.path} nonGoal=${ng}`,
          relatedPaths: [],
          suggestedAction: "Verify this instruction does not conflict with the task's non-goals.",
          blocksAutonomousWork: false,
        });
      }
    }
  }
  return findings;
}
