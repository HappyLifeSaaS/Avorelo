// Avorelo session store. Durable session state for AI work control sessions.
// Sessions are mutable working state; receipts are append-only proof.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { redact } from "../../shared/redaction/index.ts";
import type { EvidenceArtifact } from "../../shared/schemas/index.ts";

export type DriftSignal = {
  type: "scope_drift" | "evidence_stall" | "loop_detected" | "sensitive_file_touched"
    | "objective_drift" | "repeated_failure" | "context_bloat" | "proof_skipped"
    | "destructive_action_attempted" | "instruction_conflict" | "session_not_via_avorelo";
  severity: "info" | "warn" | "block";
  detail: string;
  suggestedCorrection: string;
};

export type InterventionEntry = {
  level: 0 | 1 | 2 | 3;
  action: string;
  timestamp: number;
  driftType?: string;
};

export type ControlTierLabel = "A" | "B" | "C" | "D";

export type RoutingSnapshot = {
  selectedSkills: string[];
  skippedSkills: string[];
  selectedCapabilities: string[];
  approvalRequired: boolean;
  riskClass: string;
  reroutedAt?: string;
  rerouteReason?: string;
};

export type SessionState = {
  sessionId: string;
  contractId: string;
  objective: string;
  status: "open" | "closed" | "interrupted";
  adapterIds: string[];
  controlTier: string;
  controlTierLabel: ControlTierLabel;
  allowedPaths: string[];
  toolCallCount: number;
  evidenceAccumulated: EvidenceArtifact[];
  driftSignals: DriftSignal[];
  interventionLog: InterventionEntry[];
  filesChanged: string[];
  commandsRun: string[];
  failedCommands: string[];
  sensitiveFilesTouched: string[];
  routing: RoutingSnapshot;
  correctionsApplied: string[];
  startedAt: string;
  updatedAt: string;
  closedAt?: string;
  closeReason?: string;
};

const SESSIONS_DIR = ".avorelo/sessions";

function sessionsDir(dir: string): string {
  return join(dir, SESSIONS_DIR);
}

function resolveControlTierLabel(tier: string): ControlTierLabel {
  if (tier === "lifecycle-hooks") return "A";
  if (tier === "instruction-only") return "C";
  if (tier === "prompt-only") return "D";
  if (tier === "post-session-only") return "D";
  return "D";
}

export function createSession(dir: string, opts: {
  contractId: string;
  objective: string;
  adapterIds: string[];
  controlTier: string;
  allowedPaths?: string[];
  routing?: RoutingSnapshot;
}): SessionState {
  const session: SessionState = {
    sessionId: `ses_${randomUUID().slice(0, 12)}`,
    contractId: opts.contractId,
    objective: opts.objective,
    status: "open",
    adapterIds: opts.adapterIds,
    controlTier: opts.controlTier,
    controlTierLabel: resolveControlTierLabel(opts.controlTier),
    allowedPaths: opts.allowedPaths ?? [],
    toolCallCount: 0,
    evidenceAccumulated: [],
    driftSignals: [],
    interventionLog: [],
    filesChanged: [],
    commandsRun: [],
    failedCommands: [],
    sensitiveFilesTouched: [],
    routing: opts.routing ?? { selectedSkills: [], skippedSkills: [], selectedCapabilities: [], approvalRequired: false, riskClass: "low" },
    correctionsApplied: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const sDir = sessionsDir(dir);
  mkdirSync(sDir, { recursive: true });
  writeFileSync(join(sDir, `${session.sessionId}.json`), JSON.stringify(redact(session).value, null, 2));
  return session;
}

export function loadLatestSession(dir: string): SessionState | null {
  const sDir = sessionsDir(dir);
  if (!existsSync(sDir)) return null;

  const files = readdirSync(sDir)
    .filter(f => f.startsWith("ses_") && f.endsWith(".json") && !f.includes("-resume"))
    .sort()
    .reverse();

  for (const f of files) {
    try {
      const data = JSON.parse(readFileSync(join(sDir, f), "utf8")) as SessionState;
      if (data.status === "open") return data;
    } catch { continue; }
  }
  return null;
}

export function loadSession(dir: string, sessionId: string): SessionState | null {
  const filePath = join(sessionsDir(dir), `${sessionId}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as SessionState;
  } catch {
    return null;
  }
}

export function updateSession(dir: string, sessionId: string, patch: Partial<SessionState>): SessionState | null {
  const current = loadSession(dir, sessionId);
  if (!current) return null;

  const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
  const sDir = sessionsDir(dir);
  writeFileSync(join(sDir, `${sessionId}.json`), JSON.stringify(redact(updated).value, null, 2));
  return updated;
}

export function closeSession(dir: string, sessionId: string, reason: string): SessionState | null {
  return updateSession(dir, sessionId, {
    status: "closed",
    closedAt: new Date().toISOString(),
    closeReason: reason,
  });
}

export function interruptSession(dir: string, sessionId: string, reason: string): SessionState | null {
  return updateSession(dir, sessionId, {
    status: "interrupted",
    closedAt: new Date().toISOString(),
    closeReason: reason,
  });
}
