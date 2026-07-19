// Avorelo Loop Metadata Projection (V1). Capability-layer persistence separate from kernel receipt.
// Persists to .avorelo/loops/loop_<id>.json. References kernel receipt via kernelReceiptRef.
// Does NOT modify writeReceipt() or persistReceipt() — those remain unchanged.

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { redact } from "../../shared/redaction/index.ts";
import type {
  LoopMetadata, LoopStopReason, LoopStopCategory, LoopProofState,
  LoopMode, LoopDriftFinding, LoopIterationSummary, LoopCheckResultStatus,
} from "../../shared/schemas/index.ts";

export type BuildLoopMetadataInput = {
  loopId: string;
  contractId: string;
  kernelReceiptRef: string;
  mode: LoopMode;
  iterationsRun: number;
  maxIterations: number;
  totalRuntimeMs: number;
  stopReason: LoopStopReason;
  stopCategory: LoopStopCategory;
  filesChanged: string[];
  allowedPaths: string[];
  disallowedPaths: string[];
  checksRun: { checkId: string; label: string; result: LoopCheckResultStatus }[];
  driftSummary: LoopDriftFinding[];
  iterations: LoopIterationSummary[];
  safeNextActions: string[];
  openIssues: string[];
};

function classifyFile(file: string, allowed: string[], disallowed: string[]): "in_scope" | "out_of_scope" {
  for (const d of disallowed) {
    const pat = d.replace(/\/?\*+$/, "");
    if (pat && (file === d || file.startsWith(pat))) return "out_of_scope";
  }
  if (allowed.length === 0) return "in_scope";
  for (const a of allowed) {
    const pat = a.replace(/\/?\*+$/, "");
    if (pat && (file === a || file.startsWith(pat))) return "in_scope";
  }
  return "out_of_scope";
}

function deriveProofState(checksRun: BuildLoopMetadataInput["checksRun"], driftSummary: LoopDriftFinding[], stopReason: LoopStopReason): LoopProofState {
  if (stopReason.startsWith("safety_")) return "needs_attention";
  if (stopReason === "escalation_rule_triggered") return "needs_attention";

  const hasCriticalDrift = driftSummary.some((d) => d.severity === "block");
  if (hasCriticalDrift) return "needs_attention";

  const required = checksRun;
  if (required.length === 0) return "not_proved";

  const allPassed = required.every((c) => c.result === "passed");
  const anyFailed = required.some((c) => c.result === "failed");
  const anyNotRun = required.some((c) => c.result === "not_run");

  if (allPassed && !hasCriticalDrift) return "proved";
  if (anyFailed) return "partially_proved";
  if (anyNotRun) return "not_proved";
  return "partially_proved";
}

export function buildLoopMetadata(input: BuildLoopMetadataInput): LoopMetadata {
  const inScope = input.filesChanged.filter((f) => classifyFile(f, input.allowedPaths, input.disallowedPaths) === "in_scope").length;

  return {
    contract: "avorelo.loopMetadata.v1",
    schemaVersion: 1,
    loopId: input.loopId,
    contractId: input.contractId,
    kernelReceiptRef: input.kernelReceiptRef,
    createdAt: new Date().toISOString(),
    mode: input.mode,
    iterationsRun: input.iterationsRun,
    maxIterations: input.maxIterations,
    totalRuntimeMs: input.totalRuntimeMs,
    stopReason: input.stopReason,
    stopCategory: input.stopCategory,
    filesChanged: input.filesChanged,
    filesChangedInScope: inScope,
    filesChangedOutOfScope: input.filesChanged.length - inScope,
    proofState: deriveProofState(input.checksRun, input.driftSummary, input.stopReason),
    checksRun: input.checksRun,
    checksPassed: input.checksRun.filter((c) => c.result === "passed").length,
    checksFailed: input.checksRun.filter((c) => c.result === "failed").length,
    checksNotRun: input.checksRun.filter((c) => c.result === "not_run" || c.result === "skipped").length,
    driftDetected: input.driftSummary.length > 0,
    driftSummary: input.driftSummary,
    iterations: input.iterations,
    safeNextActions: input.safeNextActions,
    openIssues: input.openIssues,
    safety: {
      redacted: true,
      containsRawPrompt: false,
      containsRawSource: false,
      containsRawSecret: false,
      containsTerminalLog: false,
      containsGitDiff: false,
    },
  };
}

function loopDir(dir: string): string {
  return join(dir, ".avorelo", "loops");
}

export function persistLoopMetadata(dir: string, metadata: LoopMetadata): string {
  const d = loopDir(dir);
  mkdirSync(d, { recursive: true });
  const safe = redact(metadata).value as Record<string, unknown>;
  // Restore safety block — redactor strips field names containing "prompt"/"secret"/"source"
  // but these are literal false flags, not values. The safety block is always the same.
  (safe as any).safety = {
    redacted: true,
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
    containsTerminalLog: false,
    containsGitDiff: false,
  };
  const path = join(d, `${metadata.loopId}.json`);
  writeFileSync(path, JSON.stringify(safe, null, 2));
  return path;
}

export function readLoopMetadata(dir: string, loopId: string): LoopMetadata | null {
  const path = join(loopDir(dir), `${loopId}.json`);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as LoopMetadata;
    return data && data.contract === "avorelo.loopMetadata.v1" ? data : null;
  } catch { return null; }
}

export function readLatestLoopMetadata(dir: string): LoopMetadata | null {
  const d = loopDir(dir);
  if (!existsSync(d)) return null;
  try {
    const files = readdirSync(d).filter(f => f.startsWith("loop_") && f.endsWith(".json"));
    if (files.length === 0) return null;
    let latest: LoopMetadata | null = null;
    let latestTime = "";
    for (const f of files) {
      try {
        const data = JSON.parse(readFileSync(join(d, f), "utf8")) as LoopMetadata;
        if (data && data.contract === "avorelo.loopMetadata.v1" && data.createdAt > latestTime) {
          latest = data;
          latestTime = data.createdAt;
        }
      } catch { /* skip corrupt files */ }
    }
    return latest;
  } catch { return null; }
}

export function readActiveLoop(dir: string): { loopId: string; status: string } | null {
  const path = join(loopDir(dir), "active.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch { return null; }
}

export function writeActiveLoop(dir: string, loopId: string, status: string): void {
  const d = loopDir(dir);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "active.json"), JSON.stringify({ loopId, status }));
}

export function clearActiveLoop(dir: string): void {
  const path = join(loopDir(dir), "active.json");
  if (existsSync(path)) {
    writeFileSync(path, JSON.stringify({ loopId: null, status: "none" }));
  }
}
