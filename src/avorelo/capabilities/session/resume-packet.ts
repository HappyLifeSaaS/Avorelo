// Avorelo resume packets. Created when a session is interrupted or closed without STOP_DONE.
// Contains enough context to continue the work in a new session.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { redact } from "../../shared/redaction/index.ts";
import type { SessionState } from "./session-store.ts";
import type { EvidenceLevel } from "../../shared/schemas/index.ts";

export type ResumePacket = {
  packetId: string;
  sessionId: string;
  objective: string;
  status: string;
  evidenceProgress: EvidenceLevel[];
  evidenceMissing: string[];
  filesChanged: string[];
  driftHandled: string[];
  correctionsApplied: number;
  remainingRisks: string[];
  safeNextActions: string[];
  summary: string;
  createdAt: string;
};

function summarizeSession(session: SessionState): string {
  const parts: string[] = [];
  parts.push(`Objective: ${session.objective}`);
  parts.push(`Status: ${session.status}`);
  parts.push(`Tool calls: ${session.toolCallCount}`);
  if (session.filesChanged.length > 0) {
    const unique = [...new Set(session.filesChanged)];
    parts.push(`Files changed: ${unique.slice(0, 10).join(", ")}${unique.length > 10 ? ` (+${unique.length - 10} more)` : ""}`);
  }
  if (session.evidenceAccumulated.length > 0) {
    parts.push(`Evidence collected: ${session.evidenceAccumulated.length} artifacts`);
  }
  if (session.driftSignals.length > 0) {
    parts.push(`Drift signals handled: ${session.driftSignals.length}`);
  }
  if (session.failedCommands.length > 0) {
    parts.push(`Failed commands: ${session.failedCommands.length}`);
  }
  return parts.join("\n");
}

export function createResumePacket(session: SessionState): ResumePacket {
  const levels = new Set(session.evidenceAccumulated.map(a => a.kind));
  const evidenceProgress: EvidenceLevel[] = [];
  if (levels.has("http_status_ok") || levels.has("redirect")) evidenceProgress.push("NAVIGATION");
  if (levels.has("ui_action_accepted") || levels.has("test_passed") || levels.has("screenshot") || levels.has("user_confirmed")) evidenceProgress.push("INTERACTION");
  if (levels.has("persisted_state_change") || levels.has("source_of_truth_readback")) evidenceProgress.push("OUTCOME");
  if (levels.has("aftermath_correct")) evidenceProgress.push("POST_ACTION");

  const evidenceMissing: string[] = [];
  if (!evidenceProgress.includes("OUTCOME")) evidenceMissing.push("OUTCOME (verify real state change)");
  if (!evidenceProgress.includes("POST_ACTION")) evidenceMissing.push("POST_ACTION (verify aftermath is correct)");

  const safeNextActions: string[] = [];
  if (evidenceMissing.length > 0) safeNextActions.push("Collect missing evidence: " + evidenceMissing.join(", "));
  if (session.failedCommands.length > 0) safeNextActions.push("Investigate failed commands before retrying");
  if (session.driftSignals.some(s => s.severity === "block")) safeNextActions.push("Resolve blocking drift signals");
  if (safeNextActions.length === 0) safeNextActions.push("Continue from where you left off");

  const packet: ResumePacket = {
    packetId: `resume_${session.sessionId}`,
    sessionId: session.sessionId,
    objective: session.objective,
    status: session.status,
    evidenceProgress,
    evidenceMissing,
    filesChanged: [...new Set(session.filesChanged)].slice(0, 20),
    driftHandled: session.driftSignals.map(s => s.type),
    correctionsApplied: session.interventionLog.length,
    remainingRisks: session.sensitiveFilesTouched.length > 0
      ? [`Sensitive files touched: ${session.sensitiveFilesTouched.join(", ")}`]
      : [],
    safeNextActions,
    summary: summarizeSession(session),
    createdAt: new Date().toISOString(),
  };

  return redact(packet).value as ResumePacket;
}

export function writeResumePacket(dir: string, packet: ResumePacket): string {
  const sDir = join(dir, ".avorelo", "sessions");
  mkdirSync(sDir, { recursive: true });
  const filePath = join(sDir, `${packet.sessionId}-resume.json`);
  writeFileSync(filePath, JSON.stringify(packet, null, 2));
  return filePath;
}

export function loadLatestResumePacket(dir: string): ResumePacket | null {
  const sDir = join(dir, ".avorelo", "sessions");
  if (!existsSync(sDir)) return null;

  const files = readdirSync(sDir)
    .filter(f => f.endsWith("-resume.json"))
    .sort()
    .reverse();

  for (const f of files) {
    try {
      return JSON.parse(readFileSync(join(sDir, f), "utf8")) as ResumePacket;
    } catch { continue; }
  }
  return null;
}
