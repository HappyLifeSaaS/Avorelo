// Avorelo Checks Runner (V1). Runs user-provided check commands and captures results.
// Truncates output. Never stores full terminal logs.

import { execSync } from "node:child_process";
import type { LoopCheckResult } from "../../shared/schemas/index.ts";

const CHECK_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_LENGTH = 200;

function truncateOutput(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length <= MAX_OUTPUT_LENGTH) return trimmed;
  return trimmed.slice(0, MAX_OUTPUT_LENGTH) + "...[truncated]";
}

export function runCheck(check: LoopCheckResult, cwd: string): LoopCheckResult {
  if (check.type === "scope_check" || check.type === "drift_check") {
    return check;
  }

  if (!check.command) {
    return { ...check, lastResult: "skipped", lastOutput: "no command configured" };
  }

  try {
    execSync(check.command, {
      cwd,
      timeout: CHECK_TIMEOUT_MS,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    });
    return { ...check, lastResult: "passed", lastOutput: null };
  } catch (err: any) {
    const raw = err.stderr || err.stdout || err.message || "unknown error";
    return { ...check, lastResult: "failed", lastOutput: truncateOutput(String(raw)) };
  }
}

export function runAllChecks(checks: LoopCheckResult[], cwd: string): LoopCheckResult[] {
  return checks.map((c) => runCheck(c, cwd));
}
