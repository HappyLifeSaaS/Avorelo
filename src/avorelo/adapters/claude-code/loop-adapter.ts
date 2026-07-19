// Claude Code LoopAdapter (V1.1). Runs `claude` CLI subprocess for each iteration.
// Stores paths only — never full agent output or chain-of-thought.

import { execSync } from "node:child_process";
import type { LoopAdapter, IterationInput, IterationOutput } from "../loop-adapter.ts";
import { getChangedFiles, getCurrentHead } from "../../capabilities/loop-control/git-observer.ts";

const MAX_LOG_LENGTH = 200;
const ITERATION_TIMEOUT_MS = 300_000;

function truncate(s: string): string {
  const t = s.trim();
  return t.length <= MAX_LOG_LENGTH ? t : t.slice(0, MAX_LOG_LENGTH) + "...[truncated]";
}

function buildPrompt(input: IterationInput): string {
  const parts: string[] = [`Task: ${input.task}`];
  parts.push(`Iteration ${input.iteration} of ${input.maxIterations}.`);

  if (input.allowedPaths.length > 0) {
    parts.push(`Only modify files in: ${input.allowedPaths.join(", ")}`);
  }
  if (input.disallowedPaths.length > 0) {
    parts.push(`Do NOT modify: ${input.disallowedPaths.join(", ")}`);
  }
  if (input.blockedCommands.length > 0) {
    parts.push(`Do NOT run: ${input.blockedCommands.join(", ")}`);
  }
  if (input.previousFailures.length > 0) {
    parts.push(`Previous failures to address: ${input.previousFailures.join("; ")}`);
  }
  if (input.previousDrift.length > 0) {
    parts.push(`Previous drift warnings: ${input.previousDrift.join("; ")}`);
  }
  parts.push("Do not push, publish, or deploy. Commit when done.");
  return parts.join("\n");
}

function detectPermissionFlag(): string {
  try {
    const help = execSync("claude --help", { timeout: 5_000, stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" });
    if (help.includes("--permission-mode")) return "--permission-mode bypassPermissions";
  } catch {}
  return "--dangerously-skip-permissions";
}

function classifyError(stderr: string): string {
  const lower = stderr.toLowerCase();
  if (lower.includes("not logged in") || lower.includes("please run /login") || lower.includes("authentication")) {
    return "Claude Code CLI is not authenticated. Run `claude` in a terminal and log in first.";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "Iteration timed out after 5 minutes.";
  }
  if (lower.includes("command not found") || lower.includes("is not recognized")) {
    return "Claude Code CLI not found. Install it or ensure `claude` is on PATH.";
  }
  return truncate(stderr);
}

let _cachedPermFlag: string | null = null;

export const claudeCodeLoopAdapter: LoopAdapter = {
  id: "claude-code",
  displayName: "Claude Code",

  executeIteration(input: IterationInput): Promise<IterationOutput> {
    const start = Date.now();
    const headBefore = getCurrentHead(input.cwd) ?? "HEAD";
    const prompt = buildPrompt(input);
    if (!_cachedPermFlag) _cachedPermFlag = detectPermissionFlag();

    try {
      execSync(
        `claude --print ${_cachedPermFlag} "${prompt.replace(/"/g, '\\"')}"`,
        {
          cwd: input.cwd,
          timeout: ITERATION_TIMEOUT_MS,
          stdio: ["pipe", "pipe", "pipe"],
          encoding: "utf-8",
          windowsHide: true,
        },
      );

      const filesChanged = getChangedFiles(input.cwd, headBefore);
      return Promise.resolve({
        exitCode: 0,
        filesChanged,
        commandsRun: [],
        durationMs: Date.now() - start,
        agentError: null,
        truncatedLog: null,
      });
    } catch (err: any) {
      const filesChanged = getChangedFiles(input.cwd, headBefore);
      const exitCode = typeof err.status === "number" ? err.status : 1;
      const errMsg = err.stderr || err.message || "unknown error";

      return Promise.resolve({
        exitCode,
        filesChanged,
        commandsRun: [],
        durationMs: Date.now() - start,
        agentError: classifyError(String(errMsg)),
        truncatedLog: null,
      });
    }
  },

  isAvailable(): boolean {
    try {
      execSync("claude --version", { timeout: 5_000, stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" });
      return true;
    } catch {
      return false;
    }
  },
};
