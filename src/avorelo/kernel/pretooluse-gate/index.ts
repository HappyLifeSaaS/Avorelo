// Avorelo PreToolUse Gate (Slice 2). Deterministic, FAIL-CLOSED action gate (the live block point).
// Classifies a proposed tool action and returns allow | block | needs_approval. Model cannot override (ADR-4).
// Uses Policy + Runtime Boundary; explicit deny (never `ask`) for hard blocks — avoids Claude Code bug #39344.

import { carriesRawSecret, secretClassesIn, checkWrite } from "../runtime-boundary/index.ts";
import type { PolicyVerdict, WorkContract } from "../../shared/schemas/index.ts";

export type ActionClass = "benign" | "external" | "destructive" | "security_sensitive" | "unknown";

export type ToolRequest = {
  tool: "edit" | "bash" | "web_fetch" | "deploy" | string;
  // proposed write target (for edits), if any
  writePath?: string;
  // command/text/args (synthetic in Slice 2) — scanned for secrets, never persisted raw
  content?: unknown;
  workingDir: string;
};

export type PreToolUseResult = {
  verdict: PolicyVerdict; // allow | block | needs_approval
  actionClass: ActionClass;
  reasonCodes: string[];
  redactionClasses: string[]; // derived classes only
};

const DESTRUCTIVE_RE = /\b(rm\s+-rf|rm\s+-r|drop\s+table|git\s+push\s+--force|mkfs|dd\s+if=|:\s*>\s*\/)\b/i;
const EXTERNAL_TOOLS = new Set(["web_fetch", "deploy"]);
const KNOWN_TOOLS = new Set(["edit", "bash", "web_fetch", "deploy", "read"]);

function classify(req: ToolRequest): ActionClass {
  if (!KNOWN_TOOLS.has(req.tool)) return "unknown";
  if (carriesRawSecret(req.content)) return "security_sensitive";
  if (req.tool === "bash" && typeof req.content === "string" && DESTRUCTIVE_RE.test(req.content)) return "destructive";
  if (req.tool === "deploy") return "destructive";
  if (EXTERNAL_TOOLS.has(req.tool)) return "external";
  return "benign";
}

export function preToolUse(req: ToolRequest, ctx: { contract: WorkContract }): PreToolUseResult {
  const reasonCodes: string[] = [];
  const redactionClasses = secretClassesIn(req.content);
  const actionClass = classify(req);

  // 1) Raw secret in the action -> hard block (S2). Never the value.
  if (carriesRawSecret(req.content)) {
    reasonCodes.push("SECRET_DETECTED");
    return { verdict: "block", actionClass, reasonCodes, redactionClasses };
  }
  // 2) Out-of-boundary write -> block (scope).
  if (req.writePath) {
    const w = checkWrite(req.writePath, { workingDir: req.workingDir, allowedPaths: ctx.contract.allowedPaths });
    if (!w.allowed) {
      reasonCodes.push(...w.reasonCodes);
      return { verdict: "block", actionClass, reasonCodes, redactionClasses };
    }
    reasonCodes.push(...w.reasonCodes);
  }
  // 3) Destructive -> block by default (requires explicit human action elsewhere); never silent.
  if (actionClass === "destructive") {
    reasonCodes.push("DESTRUCTIVE_ACTION");
    return { verdict: "block", actionClass, reasonCodes, redactionClasses };
  }
  // 4) External -> needs_approval (compact).
  if (actionClass === "external") {
    reasonCodes.push("EXTERNAL_ACTION");
    return { verdict: "needs_approval", actionClass, reasonCodes, redactionClasses };
  }
  // 5) FAIL-CLOSED: unknown/unmatched tool -> needs_approval, never silent allow.
  if (actionClass === "unknown") {
    reasonCodes.push("UNKNOWN_TOOL_FAIL_CLOSED");
    return { verdict: "needs_approval", actionClass, reasonCodes, redactionClasses };
  }
  reasonCodes.push("BENIGN_ALLOW");
  return { verdict: "allow", actionClass, reasonCodes, redactionClasses };
}
