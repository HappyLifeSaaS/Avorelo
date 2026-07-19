// Avorelo Next-Run Continuity v1 (Phase 5, Layer 3 continuation). Deterministic, local-first, redacted.
// A bounded carry-forward packet that reduces repeated explanation WITHOUT storing unsafe memory.
// Consumes Phase 4 (ContextPacket), Phase 3 (WorkContract + routing), Phase 2 (Secret Boundary) — it does
// NOT reimplement any of them. Continuity never overrides the Safety Boundary, never lowers proof/approval,
// never claims token/cost savings.

import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { compileContext } from "../context-compiler/index.ts";
import { redactString } from "../secret-boundary/redactor.ts";
import { validateReceiptSafety } from "../../kernel/receipts/validation.ts";
import { evaluateReceiptSafety } from "../../kernel/receipts/eligibility.ts";
import type {
  NextRunContinuityPacket,
  ContinuitySyncMetadata,
  SafeReference,
} from "../../shared/schemas/index.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export type PrepareContinuityInput = {
  task: string;
  dir: string;
  sourceSessionId?: string;
  now?: number; // epoch ms (injectable for deterministic tests); defaults to Date.now()
  ttlMs?: number; // default 24h
  decisionsMade?: string[];
  proofCaptured?: string[];
  safeNextActions?: string[];
  completed?: boolean;
  sources?: { label: string; origin?: string; content?: string }[];
};

/**
 * Prepare a redacted continuity packet from a task. Consumes the Phase-4 ContextPacket (which itself
 * consumes routing + Secret Boundary). Deterministic; never stores raw task/secret/source.
 */
export function prepareContinuity(input: PrepareContinuityInput): NextRunContinuityPacket {
  const now = input.now ?? Date.now();
  const ttl = input.ttlMs ?? DAY_MS;
  const packet = compileContext({ task: input.task, dir: input.dir, sources: input.sources, createdAt: new Date(now).toISOString() });

  const blocked = packet.route === "blocked";
  const needsDecision = packet.route === "needs_decision";

  const openQuestions: string[] = [];
  if (needsDecision) openQuestions.push("Confirm scope before proceeding (task is broad/ambiguous).");
  if (packet.approvalPolicy === "require_manual_review") openQuestions.push("Manual review required before this work runs.");

  // Proof gaps: anything the proof tier needs that the caller has not captured.
  const captured = new Set((input.proofCaptured ?? []).map((p) => p.toLowerCase()));
  const proofMissing = blocked ? [] : packet.proofNeeded.filter((p) => !captured.has(p.toLowerCase()));

  // Safe next actions: caller-supplied, else derived from routing/proof — never raw values.
  const hasSecretRisk = packet.riskFlags.some((f) => f.startsWith("SEC_"));
  const safeNextActions = input.safeNextActions ?? deriveNextActions(packet.route, proofMissing, hasSecretRisk);

  const avoidRepeating = [
    "Do not re-scan the whole repo — reuse the bounded context summary.",
    "Do not re-request or print secret values; use safe references.",
    ...(needsDecision ? ["Do not begin broad changes before scope is confirmed."] : []),
  ];

  const status = blocked ? "blocked" : "prepared";

  const pkt: NextRunContinuityPacket = {
    contract: "avorelo.nextRunContinuity.v1",
    schemaVersion: 1,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttl).toISOString(),
    sourceSessionId: input.sourceSessionId ?? packet.workContractId,
    objectiveSummary: packet.objective, // already redacted by routing/context compiler
    route: packet.route,
    riskClass: packet.riskClass,
    proofTier: packet.proofTier,
    approvalPolicy: packet.approvalPolicy,
    status,
    completed: input.completed ?? false,
    decisionsMade: (input.decisionsMade ?? []).map(safeLine),
    openQuestions,
    proofCaptured: input.proofCaptured ?? [],
    proofMissing,
    safeNextActions,
    avoidRepeating,
    contextSummary: blocked
      ? "blocked — no carry-forward context"
      : `${packet.contextBudget.targetSize} packet: ${packet.selectedRefs.length} selected / ${packet.excludedRefs.length} excluded ref(s)`,
    contextPacketRef: packet.workContractId,
    safeReferences: blocked ? [] : packet.safeReferences,
    excludedRefs: Array.from(new Set(packet.excludedRefs.map((r) => r.safetyReasonCode))), // reason codes only
    riskFlags: packet.riskFlags,
    redacted: true,
    containsRawSecret: false,
    containsRawPrompt: false,
    containsRawSourceDump: false,
    containsTerminalLog: false,
    containsGitDiff: false,
  };

  // Defense in depth: redact only the FREE-TEXT fields with the secret-boundary VALUE redactor (not the
  // key-name redactor, which would corrupt the declarative containsRaw* flags). Structural flags/enums are
  // left intact. objectiveSummary is already redacted upstream; this is idempotent.
  return redactFreeText(pkt);
}

// Redact secret VALUES in the human-readable string fields only. Leaves flags/enums/refs untouched.
function redactFreeText(p: NextRunContinuityPacket): NextRunContinuityPacket {
  const rs = (s: string) => redactString(s, "handoff", "continuity").redacted;
  return {
    ...p,
    objectiveSummary: rs(p.objectiveSummary),
    decisionsMade: p.decisionsMade.map(rs),
    openQuestions: p.openQuestions.map(rs),
    proofCaptured: p.proofCaptured.map(rs),
    proofMissing: p.proofMissing.map(rs),
    safeNextActions: p.safeNextActions.map(rs),
    avoidRepeating: p.avoidRepeating.map(rs),
    contextSummary: rs(p.contextSummary),
  };
}

function deriveNextActions(route: string, proofMissing: string[], hasSecretRisk: boolean): string[] {
  const out: string[] = [];
  if (route === "blocked") return ["Resolve the secret-exfiltration block; reference values safely, never print them."];
  if (hasSecretRisk) out.push("Replace any raw secret with an environment placeholder; reference it via SafeReference.");
  for (const p of proofMissing) out.push(`Capture proof: ${p}`);
  if (out.length === 0) out.push("Continue from the bounded context summary.");
  return out;
}

// Single-line, redaction is applied later; this only trims/length-bounds a decision line.
function safeLine(s: string): string {
  return String(s).replace(/\s+/g, " ").slice(0, 200);
}

/** Is the packet expired at `now`? */
export function isExpired(packet: NextRunContinuityPacket, now: number): boolean {
  return now >= Date.parse(packet.expiresAt);
}

/** Mark a packet expired if past its TTL. */
export function expireContinuity(packet: NextRunContinuityPacket, now: number): NextRunContinuityPacket {
  if (isExpired(packet, now) && packet.status !== "expired") return { ...packet, status: "expired" };
  return packet;
}

/**
 * May this packet be auto-injected into the next run? Fail-closed: blocked / expired / approval-required /
 * non-prepared packets cannot be injected. Continuity never overrides routing or weakens approval.
 */
export function canInjectContinuity(packet: NextRunContinuityPacket, now: number): { canInject: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (packet.status === "blocked" || packet.route === "blocked") reasons.push("blocked");
  if (isExpired(packet, now)) reasons.push("expired");
  if (packet.approvalPolicy === "require_manual_review" || packet.approvalPolicy === "require_confirmation" || packet.approvalPolicy === "blocked") reasons.push("approval_required");
  if (packet.openQuestions.length > 0) reasons.push("open_questions");
  if (packet.status !== "prepared" && packet.status !== "applied") reasons.push(`status_${packet.status}`);
  return { canInject: reasons.length === 0, reasons };
}

export type ContinuityInjection = {
  injectable: boolean;
  reasons: string[];
  // Compact, redacted carry-forward. Present only when injectable.
  carryForward?: { objectiveSummary: string; contextSummary: string; safeNextActions: string[]; proofMissing: string[]; avoidRepeating: string[]; riskFlags: string[] };
};

/** Apply (inject) a packet — returns a compact redacted carry-forward, or a safe refusal with reasons. */
export function applyContinuity(packet: NextRunContinuityPacket, now: number): ContinuityInjection {
  const gate = canInjectContinuity(packet, now);
  if (!gate.canInject) return { injectable: false, reasons: gate.reasons };
  return {
    injectable: true,
    reasons: [],
    carryForward: {
      objectiveSummary: packet.objectiveSummary,
      contextSummary: packet.contextSummary,
      safeNextActions: packet.safeNextActions,
      proofMissing: packet.proofMissing,
      avoidRepeating: packet.avoidRepeating,
      riskFlags: packet.riskFlags,
    },
  };
}

/** Mark a packet as injected (status transition; stays redacted). */
export function markContinuityInjected(packet: NextRunContinuityPacket): NextRunContinuityPacket {
  return { ...packet, status: "injected" };
}

/** Mark a packet as applied. */
export function applyStatus(packet: NextRunContinuityPacket): NextRunContinuityPacket {
  return { ...packet, status: "applied" };
}

/**
 * The ONLY sync-safe projection of a continuity packet: metadata only. No objective/decisions/refs text.
 */
export function buildContinuitySyncMetadata(p: NextRunContinuityPacket): ContinuitySyncMetadata {
  return {
    contract: "avorelo.nextRunContinuity.sync.v1",
    sourceSessionId: p.sourceSessionId,
    status: p.status,
    route: p.route,
    riskClass: p.riskClass,
    proofTier: p.proofTier,
    approvalPolicy: p.approvalPolicy,
    completed: p.completed,
    decisionsCount: p.decisionsMade.length,
    openQuestionsCount: p.openQuestions.length,
    proofCapturedCount: p.proofCaptured.length,
    proofMissingCount: p.proofMissing.length,
    safeNextActionsCount: p.safeNextActions.length,
    safeReferenceCount: p.safeReferences.length,
    excludedReasonCodes: p.excludedRefs,
    riskFlags: p.riskFlags,
    redacted: true,
    createdAt: p.createdAt,
    expiresAt: p.expiresAt,
  };
}

/** Is the sanitized projection eligible to sync? (The full packet is local-only and never synced.) */
export function continuityProjectionCloudEligible(p: NextRunContinuityPacket): boolean {
  return evaluateReceiptSafety({ allowlisted: true, redacted: true, payload: buildContinuitySyncMetadata(p), reasonCodes: ["REDACTED"] }).eligible;
}

// --- Local-first persistence (redacted only) ---

function continuityDir(dir: string): string {
  return join(dir, ".avorelo", "continuity");
}

/** Persist a continuity packet locally (redacted, validated). Writes latest.json + appends continuity.jsonl. */
export function writeContinuity(dir: string, packet: NextRunContinuityPacket): { path: string; cloudEligible: boolean } {
  // The packet is already field-redacted by prepareContinuity. Re-redact free text idempotently (do NOT run
  // the key-name redactor over the whole packet — it would corrupt the declarative containsRaw* flags).
  const safe = redactFreeText(packet);
  // Phase-1 safety validation (defense in depth): the free-text payload must carry no raw secret/source/etc.
  validateReceiptSafety({ schemaName: safe.contract, schemaVersion: String(safe.schemaVersion), redacted: true, payload: { decisionsMade: safe.decisionsMade, objectiveSummary: safe.objectiveSummary, safeNextActions: safe.safeNextActions }, reasonCodes: ["REDACTED"] });
  const d = continuityDir(dir);
  mkdirSync(d, { recursive: true });
  const latest = join(d, "latest.json");
  writeFileSync(latest, JSON.stringify(safe, null, 2));
  appendFileSync(join(d, "continuity.jsonl"), JSON.stringify(safe) + "\n");
  return { path: latest, cloudEligible: continuityProjectionCloudEligible(safe) };
}

/** Load the latest persisted continuity packet, or null. */
export function loadLatestContinuity(dir: string): NextRunContinuityPacket | null {
  const latest = join(continuityDir(dir), "latest.json");
  if (!existsSync(latest)) return null;
  try {
    const p = JSON.parse(readFileSync(latest, "utf8")) as NextRunContinuityPacket;
    return p && p.contract === "avorelo.nextRunContinuity.v1" ? p : null;
  } catch { return null; }
}

export type { NextRunContinuityPacket, ContinuitySyncMetadata, SafeReference };
