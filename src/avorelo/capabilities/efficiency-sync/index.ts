// Avorelo Sanitized Cloud Sync for Efficiency Metadata v1 (Phase 9, Layer 4). Deterministic, local-first.
// Cloud sync may carry ONLY sanitized metadata PROJECTIONS — never full local artifacts. Reuses the existing
// projection helpers + the Phase-1 cloud-eligibility gate + redaction policy. No network, no credentials.
// projectionOnly is always true; fullArtifactsSynced is always false. Failing projections → blocked (codes only).

import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { classifyPayload } from "../../shared/redaction/policy.ts";
import { evaluateReceiptSafety } from "../../kernel/receipts/eligibility.ts";
import { loadTokenCostEvidence, buildTokenCostEvidenceSyncMetadata } from "../token-cost-evidence/index.ts";
import { buildProofReportFromLocalEvidence, buildProofReportSyncMetadata } from "../proof-report/index.ts";
import { loadValueLedgerEntries, buildValueLedgerSyncMetadata } from "../value-ledger/index.ts";
import { loadLatestContinuity, buildContinuitySyncMetadata } from "../continuity/index.ts";
import type {
  EfficiencyMetadataSyncEnvelope,
  EfficiencyMetadataProjection,
  EfficiencyMetadataBlockedProjection,
  EfficiencyMetadataSource,
  EfficiencyMetadataSyncMode,
} from "../../shared/schemas/index.ts";

// Field names that only exist on FULL local artifacts — their presence means this is NOT a projection.
const FULL_ARTIFACT_KEYS = new Set(
  [
    "objective", "selectedrefs", "excludedrefs", "saferefs", "safereferences", "sections", "entries",
    "decisionsmade", "contextsummary", "safenextactions", "proofmissing", "openquestions", "avoidrepeating",
    "found", "verified", "fixedorprepared", "needsattention", "next", "summary", "notes", "findings",
    "tokens", "cost", "carryforward",
  ].map((k) => k),
);

function normKey(k: string): string { return k.toLowerCase().replace(/[^a-z0-9]/g, ""); }

/** Screen a candidate projection's metadata. Returns reason codes; empty array = eligible. */
export function screenProjectionMetadata(metadata: unknown): string[] {
  const reasons: string[] = [];
  if (!metadata || typeof metadata !== "object") return ["not_an_object"];
  for (const k of Object.keys(metadata as Record<string, unknown>)) {
    if (FULL_ARTIFACT_KEYS.has(normKey(k))) reasons.push(`full_artifact_field:${k}`);
  }
  const c = classifyPayload(metadata);
  if (!c.safe) reasons.push(...c.violations.map((v) => `unsafe:${v}`));
  const elig = evaluateReceiptSafety({ allowlisted: true, redacted: true, payload: metadata, reasonCodes: ["REDACTED"] });
  if (!elig.eligible) reasons.push(...elig.reasons.map((r) => `ineligible:${r}`));
  return Array.from(new Set(reasons));
}

export type ProjectionCandidate = { source: EfficiencyMetadataSource; contract: string; metadata: Record<string, unknown>; createdAt?: string };

function projectionId(source: string, metadata: Record<string, unknown>): string {
  return "proj_" + createHash("sha256").update(`${source}:${JSON.stringify(metadata)}`).digest("hex").slice(0, 12);
}

/** Classify a candidate into eligible projection or blocked (reason codes only — no payload). */
export function classifyCandidate(c: ProjectionCandidate): { eligible?: EfficiencyMetadataProjection; blocked?: EfficiencyMetadataBlockedProjection } {
  const reasons = screenProjectionMetadata(c.metadata);
  if (reasons.length === 0) {
    return { eligible: { projectionId: projectionId(c.source, c.metadata), source: c.source, contract: c.contract, createdAt: c.createdAt ?? new Date().toISOString(), metadata: c.metadata, eligibility: { cloudEligible: true, reasonCodes: ["allowlist_metadata_only"] } } };
  }
  return { blocked: { source: c.source, contract: c.contract, blockedReasonCodes: reasons, safeSummary: `blocked: ${c.source} projection failed eligibility (${reasons.length} reason code(s))` } };
}

/** Collect projection candidates from local-first stores via the existing sanitized projection helpers. */
export function collectEfficiencyMetadataProjections(target: string): ProjectionCandidate[] {
  const out: ProjectionCandidate[] = [];
  for (const e of loadTokenCostEvidence(target)) {
    const m = buildTokenCostEvidenceSyncMetadata(e);
    out.push({ source: "token_cost_evidence", contract: m.contract, metadata: m as unknown as Record<string, unknown>, createdAt: m.createdAt });
  }
  // Proof report: built from local evidence; only its sanitized projection is collected (never the full report).
  try {
    const report = buildProofReportFromLocalEvidence(target);
    const m = buildProofReportSyncMetadata(report);
    out.push({ source: "proof_report", contract: m.contract, metadata: m as unknown as Record<string, unknown>, createdAt: m.createdAt });
  } catch { /* no report */ }
  const ledger = loadValueLedgerEntries(target);
  if (ledger.length > 0) {
    const m = buildValueLedgerSyncMetadata(ledger);
    out.push({ source: "value_ledger", contract: m.contract, metadata: m as unknown as Record<string, unknown>, createdAt: m.createdAtRange.last ?? new Date().toISOString() });
  }
  const cont = loadLatestContinuity(target);
  if (cont) {
    const m = buildContinuitySyncMetadata(cont);
    out.push({ source: "continuity", contract: m.contract, metadata: m as unknown as Record<string, unknown>, createdAt: m.createdAt });
  }
  return out;
}

export type BuildEnvelopeInput = { candidates: ProjectionCandidate[]; mode?: EfficiencyMetadataSyncMode; createdAt?: string };

/** Build the sync envelope from candidates. Eligible projections carry metadata; blocked carry codes only. */
export function buildEfficiencyMetadataSyncEnvelope(input: BuildEnvelopeInput): EfficiencyMetadataSyncEnvelope {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const eligible: EfficiencyMetadataProjection[] = [];
  const blocked: EfficiencyMetadataBlockedProjection[] = [];
  for (const c of input.candidates) {
    const r = classifyCandidate(c);
    if (r.eligible) eligible.push(r.eligible);
    else if (r.blocked) blocked.push(r.blocked);
  }
  const sourceCounts = {
    tokenCost: input.candidates.filter((c) => c.source === "token_cost_evidence").length,
    proofReports: input.candidates.filter((c) => c.source === "proof_report").length,
    valueLedger: input.candidates.filter((c) => c.source === "value_ledger").length,
    contextPackets: input.candidates.filter((c) => c.source === "context_packet").length,
    continuityPackets: input.candidates.filter((c) => c.source === "continuity").length,
  };
  return {
    contract: "avorelo.efficiencyMetadataSync.v1", schemaVersion: 1, createdAt,
    envelopeId: "env_" + createHash("sha256").update(`${createdAt}:${eligible.length}:${blocked.length}`).digest("hex").slice(0, 12),
    mode: input.mode ?? "dry_run",
    sourceCounts, eligible, blocked,
    safety: {
      redacted: true, allowlistOnly: true,
      containsRawPrompt: false, containsRawTranscript: false, containsRawSource: false, containsRawSecret: false,
      containsEnvValue: false, containsTerminalLog: false, containsGitDiff: false, containsSensitivePath: false,
    },
    syncPolicy: { cloudEligible: eligible.length > 0, projectionOnly: true, fullArtifactsSynced: false },
  };
}

export function buildEfficiencyMetadataSyncDryRun(target: string, createdAt?: string): EfficiencyMetadataSyncEnvelope {
  return buildEfficiencyMetadataSyncEnvelope({ candidates: collectEfficiencyMetadataProjections(target), mode: "dry_run", createdAt });
}

/** Validate the envelope's structural + safety invariants. */
export function validateEfficiencyMetadataSyncEnvelope(env: EfficiencyMetadataSyncEnvelope): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (env.contract !== "avorelo.efficiencyMetadataSync.v1") reasons.push("bad_contract");
  if (env.syncPolicy.projectionOnly !== true) reasons.push("projection_only_must_be_true");
  if (env.syncPolicy.fullArtifactsSynced !== false) reasons.push("full_artifacts_must_be_false");
  if (env.safety.allowlistOnly !== true) reasons.push("allowlist_only_must_be_true");
  // Every eligible projection must independently re-pass screening.
  for (const p of env.eligible) {
    const r = screenProjectionMetadata(p.metadata);
    if (r.length > 0) reasons.push(`eligible_projection_unsafe:${p.source}:${r.join("|")}`);
  }
  // Blocked projections must NOT carry a payload.
  for (const b of env.blocked) {
    if ((b as unknown as Record<string, unknown>).metadata !== undefined) reasons.push(`blocked_projection_has_payload:${b.source}`);
  }
  return { valid: reasons.length === 0, reasons };
}

/** Write the eligible projections to a local queue (metadata-only, redacted, gitignored). No network. */
export function writeEfficiencyMetadataSyncQueue(target: string, env: EfficiencyMetadataSyncEnvelope): string {
  const v = validateEfficiencyMetadataSyncEnvelope(env);
  if (!v.valid) throw new Error("efficiency_sync_envelope_invalid: " + v.reasons.join(","));
  const d = join(target, ".avorelo", "sync");
  mkdirSync(d, { recursive: true });
  const path = join(d, "efficiency-metadata.queue.jsonl");
  for (const p of env.eligible) appendFileSync(path, JSON.stringify({ ...p, mode: "local_queue" }) + "\n");
  return path;
}
