// Avorelo Tier B near-live watcher. Observes file changes during an active session
// for tools without lifecycle hooks. Detects drift, updates session, triggers corrections.
// Not a long-running daemon — runs a bounded check cycle, then exits.

import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { execSync } from "node:child_process";
import { loadLatestSession, updateSession } from "./session-store.ts";
import type { SessionState, DriftSignal } from "./session-store.ts";
import { detectDrift, detectSensitiveFiles } from "./drift-detector.ts";
import { decideIntervention, buildCorrectionGuidance, interventionToEntry } from "./intervention.ts";
import type { InterventionAction } from "./intervention.ts";

export type WatchResult = {
  ok: boolean;
  changedFiles: string[];
  driftSignals: DriftSignal[];
  interventions: InterventionAction[];
  corrections: string | null;
  sessionUpdated: boolean;
  message: string;
};

function getGitChangedFiles(dir: string): string[] {
  try {
    const out = execSync("git diff --name-only", { cwd: dir, stdio: "pipe", timeout: 5000 }).toString().trim();
    if (!out) return [];
    return out.split("\n").map(f => f.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function getGitUntrackedFiles(dir: string): string[] {
  try {
    const out = execSync("git ls-files --others --exclude-standard", { cwd: dir, stdio: "pipe", timeout: 5000 }).toString().trim();
    if (!out) return [];
    return out.split("\n").map(f => f.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function getRecentlyModifiedFiles(dir: string, sinceMs: number): string[] {
  const now = Date.now();
  const results: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 4) return;
    try {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const full = join(d, entry.name);
        if (entry.isDirectory()) { walk(full, depth + 1); continue; }
        try {
          const s = statSync(full);
          if (now - s.mtimeMs < sinceMs) results.push(relative(dir, full).replace(/\\/g, "/"));
        } catch {}
      }
    } catch {}
  };
  walk(dir, 0);
  return results;
}

export function watchOnce(dir: string): WatchResult {
  const session = loadLatestSession(dir);
  if (!session) {
    return { ok: false, changedFiles: [], driftSignals: [], interventions: [], corrections: null, sessionUpdated: false, message: "No active session." };
  }

  // Collect changed files from git + recent modifications
  const gitChanged = getGitChangedFiles(dir);
  const gitUntracked = getGitUntrackedFiles(dir);
  const sinceStart = Date.now() - new Date(session.startedAt).getTime();
  const recentFiles = sinceStart < 3600000 ? getRecentlyModifiedFiles(dir, sinceStart) : [];

  const allChanged = [...new Set([...gitChanged, ...gitUntracked, ...recentFiles])];
  if (allChanged.length === 0) {
    return { ok: true, changedFiles: [], driftSignals: [], interventions: [], corrections: null, sessionUpdated: false, message: "No changes detected." };
  }

  // Build session view — do NOT pre-populate sensitiveFilesTouched so drift detector discovers them
  const newFiles = allChanged.filter(f => !session.filesChanged.includes(f));
  const updatedSession: SessionState = {
    ...session,
    filesChanged: [...session.filesChanged, ...newFiles],
    sensitiveFilesTouched: session.sensitiveFilesTouched,
    toolCallCount: session.toolCallCount + newFiles.length,
  };

  // Detect drift
  const driftSignals = detectDrift(updatedSession, session.allowedPaths);
  const interventions = decideIntervention(driftSignals);
  const corrections = buildCorrectionGuidance(interventions);

  // NOW record sensitive files after detection
  const newSensitive = detectSensitiveFiles(newFiles);
  updateSession(dir, session.sessionId, {
    filesChanged: updatedSession.filesChanged,
    sensitiveFilesTouched: [...new Set([...session.sensitiveFilesTouched, ...newSensitive])],
    toolCallCount: updatedSession.toolCallCount,
    driftSignals: [...session.driftSignals, ...driftSignals],
    interventionLog: [...session.interventionLog, ...interventions.map(a => interventionToEntry(a, a.action))],
    ...(corrections ? { correctionsApplied: [...(session.correctionsApplied ?? []), corrections] } : {}),
  });

  // Simple message
  const driftCount = driftSignals.length;
  let message = `Watched ${allChanged.length} changed files.`;
  if (driftCount > 0) message += ` Avorelo noticed ${driftCount} issue${driftCount > 1 ? "s" : ""} and recorded them.`;
  if (corrections) message += " Correction guidance updated.";
  if (driftCount === 0) message += " Everything looks on track.";

  return {
    ok: true,
    changedFiles: allChanged,
    driftSignals,
    interventions,
    corrections,
    sessionUpdated: true,
    message,
  };
}

export type WatchFixtureResult = WatchResult & { fixture: string };

export function watchWithFixture(dir: string, fixture: "scope-drift" | "sensitive" | "clean" | "loop"): WatchFixtureResult {
  const session = loadLatestSession(dir);
  if (!session) {
    return { ok: false, changedFiles: [], driftSignals: [], interventions: [], corrections: null, sessionUpdated: false, message: "No active session.", fixture };
  }

  let simulatedFiles: string[];
  switch (fixture) {
    case "scope-drift":
      simulatedFiles = ["src/unrelated/random-feature.ts", "docs/marketing/copy.md"];
      break;
    case "sensitive":
      simulatedFiles = ["src/auth/middleware.ts", ".env.production"];
      break;
    case "clean":
      simulatedFiles = session.allowedPaths.length > 0 ? ["src/expected-file.ts"] : ["src/main.ts"];
      break;
    case "loop":
      simulatedFiles = ["src/buggy.ts", "src/buggy.ts", "src/buggy.ts", "src/buggy.ts"];
      break;
  }

  // Build session view with new files but DO NOT pre-populate sensitiveFilesTouched
  // so drift detector can discover new sensitive files
  const updatedSession: SessionState = {
    ...session,
    filesChanged: [...session.filesChanged, ...simulatedFiles],
    sensitiveFilesTouched: session.sensitiveFilesTouched, // keep existing only
    toolCallCount: session.toolCallCount + simulatedFiles.length,
  };

  const driftSignals = detectDrift(updatedSession, session.allowedPaths);
  const interventions = decideIntervention(driftSignals);
  const corrections = buildCorrectionGuidance(interventions);

  // NOW record sensitive files after drift detection
  const newSensitive = detectSensitiveFiles(simulatedFiles);
  updateSession(dir, session.sessionId, {
    filesChanged: updatedSession.filesChanged,
    sensitiveFilesTouched: [...new Set([...session.sensitiveFilesTouched, ...newSensitive])],
    toolCallCount: updatedSession.toolCallCount,
    driftSignals: [...session.driftSignals, ...driftSignals],
    interventionLog: [...session.interventionLog, ...interventions.map(a => interventionToEntry(a, a.action))],
  });

  const driftCount = driftSignals.length;
  let message = `Fixture "${fixture}": ${simulatedFiles.length} files.`;
  if (driftCount > 0) message += ` ${driftCount} issue${driftCount > 1 ? "s" : ""} detected.`;
  if (corrections) message += " Correction guidance generated.";
  if (driftCount === 0) message += " On track.";

  return { ok: true, changedFiles: simulatedFiles, driftSignals, interventions, corrections, sessionUpdated: true, message, fixture };
}
