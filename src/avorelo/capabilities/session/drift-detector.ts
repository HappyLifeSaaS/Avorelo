// Avorelo drift detector. Deterministic detection of session drift signals.
// No LLM — uses path matching, counters, and pattern detection.

import type { SessionState, DriftSignal } from "./session-store.ts";

const SENSITIVE_PATTERNS = [
  /\.env/i, /auth/i, /secret/i, /credential/i, /password/i,
  /billing/i, /payment/i, /subscription/i, /checkout/i,
  /migration/i, /\.pem$/i, /id_rsa/i, /\.ssh/i, /\.aws/i,
  /security/i, /permission/i, /role/i, /policy/i,
];

const EVIDENCE_STALL_THRESHOLD = 20;
const LOOP_THRESHOLD = 3;
const CONTEXT_BLOAT_THRESHOLD = 100;
const FAILURE_THRESHOLD = 3;

function pathInScope(filePath: string, allowedPaths: string[]): boolean {
  if (allowedPaths.length === 0) return true;
  const normalized = filePath.replace(/\\/g, "/");
  return allowedPaths.some(pattern => {
    const p = pattern.replace(/\\/g, "/");
    if (p === "**" || p === "**/*") return true;
    if (p.endsWith("/**")) {
      const prefix = p.slice(0, -3);
      return normalized.startsWith(prefix);
    }
    if (p.includes("*")) {
      const regex = new RegExp("^" + p.replace(/\*/g, ".*") + "$");
      return regex.test(normalized);
    }
    return normalized.startsWith(p);
  });
}

function isSensitivePath(filePath: string): boolean {
  return SENSITIVE_PATTERNS.some(p => p.test(filePath));
}

function countFileEdits(filesChanged: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of filesChanged) {
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return counts;
}

export function detectDrift(session: SessionState, allowedPaths: string[]): DriftSignal[] {
  const signals: DriftSignal[] = [];

  // Scope drift: files changed outside allowed paths
  for (const file of session.filesChanged) {
    if (!pathInScope(file, allowedPaths)) {
      signals.push({
        type: "scope_drift",
        severity: "warn",
        detail: `File outside declared scope: ${file}`,
        suggestedCorrection: `Return to declared scope. Allowed: ${allowedPaths.join(", ") || "all"}`,
      });
      break; // one signal per type is enough
    }
  }

  // Evidence stall: many tool calls without new evidence
  if (session.toolCallCount > EVIDENCE_STALL_THRESHOLD && session.evidenceAccumulated.length === 0) {
    signals.push({
      type: "evidence_stall",
      severity: "warn",
      detail: `${session.toolCallCount} tool calls with no evidence collected`,
      suggestedCorrection: "Run tests or check real state to collect evidence.",
    });
  }

  // Loop detection: same file edited repeatedly
  const edits = countFileEdits(session.filesChanged);
  for (const [file, count] of edits) {
    if (count >= LOOP_THRESHOLD) {
      signals.push({
        type: "loop_detected",
        severity: "warn",
        detail: `${file} edited ${count} times`,
        suggestedCorrection: `Stop editing ${file} repeatedly. Step back and reconsider the approach.`,
      });
      break;
    }
  }

  // Sensitive file touched
  for (const file of session.filesChanged) {
    if (isSensitivePath(file)) {
      if (!session.sensitiveFilesTouched.includes(file)) {
        signals.push({
          type: "sensitive_file_touched",
          severity: "block",
          detail: `Sensitive file touched: ${file}`,
          suggestedCorrection: "This file requires explicit approval before modification.",
        });
        break;
      }
    }
  }

  // Repeated failure
  if (session.failedCommands.length >= FAILURE_THRESHOLD) {
    const lastFails = session.failedCommands.slice(-FAILURE_THRESHOLD);
    const allSame = lastFails.every(c => c === lastFails[0]);
    if (allSame) {
      signals.push({
        type: "repeated_failure",
        severity: "warn",
        detail: `Command failed ${FAILURE_THRESHOLD}+ times: ${lastFails[0]}`,
        suggestedCorrection: "Stop retrying the same command. Diagnose the root cause.",
      });
    }
  }

  // Context bloat
  if (session.toolCallCount > CONTEXT_BLOAT_THRESHOLD) {
    signals.push({
      type: "context_bloat",
      severity: "warn",
      detail: `Session has ${session.toolCallCount} tool calls (budget: ${CONTEXT_BLOAT_THRESHOLD})`,
      suggestedCorrection: "Consider saving progress and starting a focused new session.",
    });
  }

  // Proof skipped: session has many tool calls, files changed, but zero evidence
  if (session.toolCallCount > 10 && session.filesChanged.length > 3 && session.evidenceAccumulated.length === 0) {
    signals.push({
      type: "proof_skipped",
      severity: "warn",
      detail: "Multiple files changed but no proof collected",
      suggestedCorrection: "Run tests or verify real state before declaring work complete.",
    });
  }

  // Destructive action attempted (check commands for known destructive patterns)
  const destructivePatterns = [/\brm\s+-rf\b/, /\bgit\s+push\s+--force\b/, /\bgit\s+reset\s+--hard\b/, /\bdrop\s+table\b/i, /\btruncate\b/i];
  for (const cmd of session.commandsRun) {
    if (destructivePatterns.some(p => p.test(cmd))) {
      signals.push({
        type: "destructive_action_attempted",
        severity: "block",
        detail: `Destructive command detected: ${cmd.slice(0, 60)}`,
        suggestedCorrection: "This action is destructive and requires explicit approval.",
      });
      break;
    }
  }

  return signals;
}

export function detectSensitiveFiles(filesChanged: string[]): string[] {
  return filesChanged.filter(isSensitivePath);
}

export { pathInScope, isSensitivePath };
