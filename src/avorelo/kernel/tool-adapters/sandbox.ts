// Sandbox execution for safe delegated tool tasks.
// Creates isolated temp workspaces, classifies task safety, and sanitizes results.

import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

export type TaskSafetyClass = "sandbox_safe" | "needs_approval" | "forbidden";

export type SandboxResult = {
  sandboxDir: string;
  filesCreated: string[];
  filesSummary: string;
  cleanedUp: boolean;
};

const FORBIDDEN_TASK_PATTERNS = [
  /\b(deploy|publish|release|tag)\b/i,
  /\bnpm\s+(publish|unpublish|deprecate)\b/i,
  /\b(production|prod)\s+(push|deploy|update|change)\b/i,
  /\b(delete|drop|truncate|rm\s+-rf)\b/i,
  /\b(credential|password|secret|api.?key|token)\s*(rotat|chang|set|updat|creat)/i,
  /\b(auth|login|session|oauth)\s*(chang|modif|updat|creat|delet)/i,
  /\b(billing|payment|invoice|subscription|webhook)\s*(chang|modif|updat|creat)/i,
  /\bgit\s+(push|force|reset\s+--hard)\b/i,
  /\b(env|\.env|environment)\s*(variable|secret|key|value)?\s*(set|chang|updat|writ|creat)/i,
  /\b(curl|wget|fetch|http|request)\s.*(external|remote|api)/i,
];

const SAFE_SANDBOX_PATTERNS = [
  /\b(create|add|write|generate)\s+(a\s+)?(fixture|test|helper|util|stub|mock|sample|example|hello)/i,
  /\b(update|edit|modify)\s+(a\s+)?(test\s+)?fixture/i,
  /\b(format|lint|check|validate)\s+(code|file|syntax)/i,
  /\b(list|show|display|read|count)\s+(file|dir|line|word)/i,
  /\bhello\s*world\b/i,
  /\b(echo|print|log)\b/i,
  /\bcreate\s+(a\s+)?(simple|tiny|small|basic|minimal)\b/i,
  /\b(scaffold|stub|boilerplate|template)\b/i,
  /\b(rename|move)\s+(a\s+)?(file|variable|function)\b/i,
  /\b(sort|organize|reorder)\s+(import|line|item)/i,
];

export function classifyTaskSafety(task: string): TaskSafetyClass {
  for (const pattern of FORBIDDEN_TASK_PATTERNS) {
    if (pattern.test(task)) return "forbidden";
  }
  for (const pattern of SAFE_SANDBOX_PATTERNS) {
    if (pattern.test(task)) return "sandbox_safe";
  }
  return "needs_approval";
}

export function createSandboxDir(parentDir: string): SandboxResult {
  const id = createHash("sha256").update(`${parentDir}:${Date.now()}`).digest("hex").slice(0, 10);
  const sandboxDir = join(tmpdir(), `avorelo-sandbox-${id}`);
  mkdirSync(sandboxDir, { recursive: true });
  writeFileSync(join(sandboxDir, ".avorelo-sandbox"), JSON.stringify({
    createdAt: new Date().toISOString(),
    parentDir,
    purpose: "safe_delegated_execution",
  }));
  return { sandboxDir, filesCreated: [], filesSummary: "empty sandbox", cleanedUp: false };
}

export function collectSandboxResults(sandboxDir: string): { files: string[]; summary: string } {
  if (!existsSync(sandboxDir)) return { files: [], summary: "sandbox not found" };
  try {
    const entries = readdirSync(sandboxDir).filter(f => f !== ".avorelo-sandbox");
    const files: string[] = [];
    const summaryParts: string[] = [];
    for (const entry of entries.slice(0, 20)) {
      files.push(entry);
      try {
        const content = readFileSync(join(sandboxDir, entry), "utf8");
        summaryParts.push(`${entry}: ${content.length} bytes, ${content.split("\n").length} lines`);
      } catch {
        summaryParts.push(`${entry}: unreadable`);
      }
    }
    if (entries.length > 20) summaryParts.push(`... and ${entries.length - 20} more files`);
    return { files, summary: summaryParts.join("; ") || "no files created" };
  } catch {
    return { files: [], summary: "sandbox read error" };
  }
}

export function cleanupSandbox(sandboxDir: string): boolean {
  try {
    if (existsSync(sandboxDir) && existsSync(join(sandboxDir, ".avorelo-sandbox"))) {
      rmSync(sandboxDir, { recursive: true, force: true });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export type DelegatedTaskResult = {
  success: boolean;
  exitCode: number | null;
  sanitizedOutput: string;
  patchSummary: string | null;
  filesChanged: string[];
  durationMs: number;
  authRequired: boolean;
  toolVersion: string | null;
  failureReason: string | null;
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawSecret: false;
  containsRawModelOutput: false;
};
