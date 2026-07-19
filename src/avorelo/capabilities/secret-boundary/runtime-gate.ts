// Avorelo Secret Boundary — Runtime gate helpers (Phase 2). Adapter-safe PreToolUse / PostToolUse logic.
// PreToolUse: decide before a tool action runs (block secret exfiltration). PostToolUse: redact tool output
// BEFORE it reaches model context. Adapted from old PR #77/#80 (PostToolUse runtime).
//
// Architecture note: the Claude Code adapter's handleLifecycleHook now calls postToolUseRedact and returns
// both `updatedToolOutput` and `updatedMcpToolOutput` in the result. The CLI runtime also intercepts
// PostToolUse first (stdout path) — both paths use this same function, no duplication.
// The Claude Code hooks protocol does not yet support receiving mutation fields back from the hook process.

import { evaluateSafeRun, type SafeRunResult } from "./safe-run.ts";
import { redactValue, type RedactionOutput } from "./redactor.ts";
import type { SecretFinding } from "./detector.ts";
import type { SafeReference } from "../../shared/schemas/index.ts";

export type PreToolUseDecision = "allow" | "block" | "require_approval";

export type PreToolUseResult = {
  decision: PreToolUseDecision;
  reasonCodes: string[];
  safeAlternative: string | null;
  modelSawSecret: false;
};

/** PreToolUse: inspect a tool name + input and decide whether the action may run. Never executes anything. */
export function preToolUseGate(toolName: string, toolInput: unknown): PreToolUseResult {
  // Flatten the candidate command/args/text into a single string for deterministic intent matching.
  const candidate = stringifyToolInput(toolName, toolInput);
  const sr: SafeRunResult = evaluateSafeRun(candidate);
  const decision: PreToolUseDecision = sr.decision === "block" ? "block" : sr.decision === "require_approval" ? "require_approval" : "allow";
  return { decision, reasonCodes: [`category:${sr.category}`, ...sr.reasonCodes], safeAlternative: sr.safeAlternative, modelSawSecret: false };
}

export type PostToolUseResult = {
  updatedToolOutput: unknown; // redacted, same shape — for normal tools
  updatedMcpToolOutput: unknown; // alias for MCP/nested output (same redacted value)
  findings: SecretFinding[];
  safeReferences: SafeReference[];
  secretCount: number;
  modelSawSecret: false; // redaction happens before the model sees the output
  redactedStdout?: string;
  redactedStderr?: string;
};

/**
 * PostToolUse: redact a tool's output (string or nested object incl. MCP shapes) before it reaches the model.
 * Returns the redacted output; the raw value never appears in the result or any serialized form.
 */
export function postToolUseRedact(toolOutput: unknown, opts: { sourceKind?: "tool_output"; isMcp?: boolean } = {}): PostToolUseResult {
  const out: RedactionOutput = redactValue(toolOutput, "tool_output");
  const res: PostToolUseResult = {
    updatedToolOutput: out.redacted,
    updatedMcpToolOutput: out.redacted,
    findings: out.findings,
    safeReferences: out.safeReferences,
    secretCount: out.secretCount,
    modelSawSecret: false,
  };
  // Convenience: if the output looks like a Bash result, expose redacted stdout/stderr too.
  if (toolOutput && typeof toolOutput === "object") {
    const o = toolOutput as Record<string, unknown>;
    if (typeof o.stdout === "string") res.redactedStdout = redactValue(o.stdout, "tool_output").redacted as string;
    if (typeof o.stderr === "string") res.redactedStderr = redactValue(o.stderr, "tool_output").redacted as string;
  }
  return res;
}

function stringifyToolInput(toolName: string, toolInput: unknown): string {
  const parts: string[] = [String(toolName ?? "")];
  if (typeof toolInput === "string") parts.push(toolInput);
  else if (toolInput && typeof toolInput === "object") {
    const o = toolInput as Record<string, unknown>;
    for (const k of ["command", "cmd", "script", "args", "file_path", "path", "query", "prompt", "input"]) {
      const v = o[k];
      if (typeof v === "string") parts.push(v);
      else if (Array.isArray(v)) parts.push(v.filter((x) => typeof x === "string").join(" "));
    }
    if (parts.length === 1) {
      try { parts.push(JSON.stringify(toolInput)); } catch { /* ignore */ }
    }
  }
  return parts.join(" ");
}
