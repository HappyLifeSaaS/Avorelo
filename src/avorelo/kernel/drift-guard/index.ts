// Avorelo Kernel Drift Guard (Loop Control V1). Stateless, deterministic scope + method drift detection.
// Takes plain data arrays only. NEVER imports loop types, orchestrator state, or iteration history.
// Peers with kernel/policy — supplements (does not replace) Policy Matrix scope checks.

export type DriftSeverity = "info" | "warning" | "block";

export type DriftFinding = {
  type: "scope_drift" | "method_drift";
  severity: DriftSeverity;
  description: string;
  evidence: string[];
  recommendation: string;
};

export type ScopeDriftInput = {
  changedFiles: string[];
  allowedPaths: string[];
  disallowedPaths: string[];
};

export type MethodDriftInput = {
  commandsRun: string[];
  blockedCommands: string[];
};

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+-rf\b/,
  /\bgit\s+push\s+--force\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+DATABASE\b/i,
  /\bTRUNCATE\s+/i,
  /\bnpm\s+publish\b/,
  /\bgit\s+push\b/,
];

function matchesGlob(file: string, pattern: string): boolean {
  if (pattern === file) return true;
  const trimmed = pattern.replace(/\/?\*+$/, "");
  if (trimmed.length === 0) return false;
  if (pattern.endsWith("*")) return file.startsWith(trimmed) || file.startsWith(trimmed.replace(/\/$/, ""));
  return file === pattern || file.startsWith(pattern + "/");
}

function fileMatchesAny(file: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesGlob(file, p));
}

export function detectScopeDrift(input: ScopeDriftInput): DriftFinding[] {
  const findings: DriftFinding[] = [];

  for (const file of input.changedFiles) {
    if (input.disallowedPaths.length > 0 && fileMatchesAny(file, input.disallowedPaths)) {
      findings.push({
        type: "scope_drift",
        severity: "block",
        description: `File in disallowed paths: ${file}`,
        evidence: [file],
        recommendation: "Revert changes to this file or adjust the work contract scope.",
      });
    } else if (input.allowedPaths.length > 0 && !fileMatchesAny(file, input.allowedPaths)) {
      findings.push({
        type: "scope_drift",
        severity: "warning",
        description: `File outside allowed paths: ${file}`,
        evidence: [file],
        recommendation: "Review whether this file change is necessary for the task.",
      });
    }
  }

  return findings;
}

export function detectMethodDrift(input: MethodDriftInput): DriftFinding[] {
  const findings: DriftFinding[] = [];

  for (const cmd of input.commandsRun) {
    const cmdLower = cmd.toLowerCase().trim();
    const blocked = input.blockedCommands.find((b) => cmdLower === b.toLowerCase().trim() || cmdLower.startsWith(b.toLowerCase().trim() + " "));
    if (blocked) {
      findings.push({
        type: "method_drift",
        severity: "block",
        description: `Blocked command executed: ${cmd}`,
        evidence: [cmd],
        recommendation: "This command is not allowed by the loop policy. Stop and review.",
      });
      continue;
    }

    for (const pat of DESTRUCTIVE_PATTERNS) {
      if (pat.test(cmd)) {
        findings.push({
          type: "method_drift",
          severity: "block",
          description: `Destructive command detected: ${cmd}`,
          evidence: [cmd],
          recommendation: "Destructive commands are blocked in loop mode. Stop and review.",
        });
        break;
      }
    }
  }

  return findings;
}
