// Tool availability detection. Local-only, no network, no login, no task execution.
// Pattern: local drop-in detection (Nadir-like), safe capability checks.

import type { ToolAvailability, ToolAdapterId } from "./types.ts";
import { detect as detectDeterministicLocal } from "./adapters/deterministic-local.ts";
import { detect as detectManualGate } from "./adapters/manual-gate.ts";
import { detect as detectScanner } from "./adapters/scanner.ts";
import { detect as detectSemgrep } from "./adapters/semgrep.ts";
import { detect as detectPlaywrightProof } from "./adapters/playwright-proof.ts";
import { detect as detectGitHubActions } from "./adapters/github-actions.ts";
import { detect as detectClaudeCode } from "./adapters/claude-code.ts";
import { detect as detectCodex } from "./adapters/codex.ts";
import { detect as detectGeminiCli } from "./adapters/gemini-cli.ts";
import { detect as detectAider } from "./adapters/aider.ts";
import { detect as detectCursor } from "./adapters/cursor.ts";
import { isAdapterHealthy } from "./registry.ts";

export function detectAllTools(dir: string, now: number): ToolAvailability[] {
  return [
    detectDeterministicLocal(now),
    detectManualGate(now),
    detectScanner(now),
    detectSemgrep(dir, now),
    detectPlaywrightProof(dir, now),
    detectGitHubActions(dir, now),
    detectClaudeCode(dir, now),
    detectCodex(dir, now),
    detectGeminiCli(dir, now),
    detectAider(dir, now),
    detectCursor(dir, now),
  ];
}

export function detectTool(id: ToolAdapterId, dir: string, now: number): ToolAvailability {
  switch (id) {
    case "deterministic-local": return detectDeterministicLocal(now);
    case "manual-gate": return detectManualGate(now);
    case "scanner": return detectScanner(now);
    case "semgrep": return detectSemgrep(dir, now);
    case "playwright-proof": return detectPlaywrightProof(dir, now);
    case "github-actions": return detectGitHubActions(dir, now);
    case "claude-code": return detectClaudeCode(dir, now);
    case "codex": return detectCodex(dir, now);
    case "gemini-cli": return detectGeminiCli(dir, now);
    case "aider": return detectAider(dir, now);
    case "cursor": return detectCursor(dir, now);
  }
}

export function getEffectiveAvailability(dir: string, now: number): Record<ToolAdapterId, "available" | "unavailable" | "unknown" | "cooldown"> {
  const all = detectAllTools(dir, now);
  const result: Record<string, string> = {};
  for (const t of all) {
    if (t.status === "available" && !isAdapterHealthy(t.adapterId, now)) {
      result[t.adapterId] = "cooldown";
    } else {
      result[t.adapterId] = t.status;
    }
  }
  return result as Record<ToolAdapterId, "available" | "unavailable" | "unknown" | "cooldown">;
}
