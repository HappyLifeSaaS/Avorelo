// Avorelo Secret Boundary — Instruction-risk scanner (Phase 2). Deterministic, local. No LLM/network.
// Adapted from old PR #78. Detects prompt-injection / poisoning / exfiltration / hidden instructions /
// policy-bypass / auto-execution and maps to a safe handling action. Tool-returned/external instructions
// can NEVER override system/work-contract/policy — they are at most treated as data.

import { classifySource, type ClassifySourceInput } from "./source-trust.ts";
import { detectInString } from "./detector.ts";

export type InstructionRiskCode =
  | "PROMPT_INJECTION"
  | "INSTRUCTION_POISONING"
  | "SECRET_EXFILTRATION_REQUEST"
  | "HIDDEN_INSTRUCTIONS"
  | "TOOL_RESPONSE_INSTRUCTION_RISK"
  | "POLICY_BYPASS_REQUEST"
  | "AUTO_EXECUTION_REQUEST";

export type InstructionAction =
  | "allow"
  | "treat_as_data_only"
  | "use_sanitized_copy"
  | "quarantine_source"
  | "require_approval"
  | "block";

export type InstructionRisk = {
  codes: InstructionRiskCode[];
  action: InstructionAction;
  reasonCodes: string[];
  sanitizedCopy: string; // secrets redacted; safe to keep as data
};

const RULES: { code: InstructionRiskCode; re: RegExp }[] = [
  { code: "PROMPT_INJECTION", re: /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all)\b[^.\n]{0,20}\b(instructions?|prompts?|rules?|context)\b/i },
  { code: "INSTRUCTION_POISONING", re: /\b(you are now|from now on|new system prompt|act as|override your|your real instructions)\b/i },
  { code: "SECRET_EXFILTRATION_REQUEST", re: /\b(print|reveal|show|cat|echo|dump|exfiltrate|send|post|upload|leak|output|contents? of)\b[^\n]{0,40}(secret|secrets|password|token|api[_\s-]?key|credential|env(?:ironment)? var|\.env\b|private key)/i },
  { code: "HIDDEN_INSTRUCTIONS", re: /<!--[\s\S]*?(instruction|ignore|system|prompt)[\s\S]*?-->|​|‍|\[\[hidden\]\]/i },
  { code: "POLICY_BYPASS_REQUEST", re: /\b(bypass|disable|turn off|skip|circumvent|without)\b[^.\n]{0,30}\b(policy|policies|guardrail|safety|security|approval|redaction|protection)\b/i },
  { code: "AUTO_EXECUTION_REQUEST", re: /\b(automatically|auto[-\s]?(run|execute|deploy)|without (asking|approval|confirmation)|silently (run|execute))\b/i },
];

/** Scan content for instruction risk. `sourceInput` controls trust (tool/external content is downgraded). */
export function scanInstructionRisk(content: string, sourceInput: ClassifySourceInput = {}): InstructionRisk {
  const text = typeof content === "string" ? content : "";
  const trust = classifySource(sourceInput);
  const codes: InstructionRiskCode[] = [];
  const reasonCodes: string[] = [`source:${trust.sourceClass}`, `trust:${trust.trustLevel}`];

  for (const { code, re } of RULES) if (re.test(text)) codes.push(code);

  // Instructions arriving from a tool response carry extra risk.
  if (trust.sourceClass === "tool_returned" && codes.length > 0) codes.push("TOOL_RESPONSE_INSTRUCTION_RISK");

  // A secret value present alongside an instruction strengthens the exfiltration signal.
  const hasSecretValue = detectInString(text).length > 0;
  if (hasSecretValue && codes.includes("SECRET_EXFILTRATION_REQUEST") === false && /\b(send|post|upload|leak|exfiltrate)\b/i.test(text)) {
    codes.push("SECRET_EXFILTRATION_REQUEST");
  }

  const action = decideAction(codes, trust.trustLevel);
  reasonCodes.push(...codes.map((c) => `risk:${c}`));

  // Sanitized copy: redact any secret + neutralize that it may be treated as instruction.
  const sanitizedCopy = sanitize(text);

  return { codes: Array.from(new Set(codes)), action, reasonCodes, sanitizedCopy };
}

function decideAction(codes: InstructionRiskCode[], trust: "trusted" | "limited" | "untrusted"): InstructionAction {
  if (codes.includes("SECRET_EXFILTRATION_REQUEST")) {
    // exfiltration is fail-closed: block from untrusted/limited, require approval even if local
    return trust === "untrusted" ? "quarantine_source" : "block";
  }
  if (codes.includes("POLICY_BYPASS_REQUEST") || codes.includes("AUTO_EXECUTION_REQUEST")) return "require_approval";
  if (codes.includes("HIDDEN_INSTRUCTIONS")) return "use_sanitized_copy";
  if (codes.includes("INSTRUCTION_POISONING") || codes.includes("PROMPT_INJECTION") || codes.includes("TOOL_RESPONSE_INSTRUCTION_RISK")) {
    return "treat_as_data_only";
  }
  return "allow";
}

// Redact secrets and strip zero-width/hidden-instruction markers; never returns a raw secret.
function sanitize(text: string): string {
  // local import avoids a cycle at module top; redactor depends on detector only
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const stripped = text.replace(/[​‍﻿]/g, "").replace(/<!--[\s\S]*?-->/g, "[REMOVED_HTML_COMMENT]");
  // physically redact secret substrings via the same patterns the detector uses
  return redactInline(stripped);
}

// Lightweight inline redaction (mirror of redactor patterns) to keep this module dependency-light.
function redactInline(input: string): string {
  const res: { code: string; re: RegExp }[] = [
    { code: "SEC_PRIVATE_KEY", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
    { code: "SEC_GH_TOKEN", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
    { code: "SEC_AWS_ACCESS_KEY", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
    { code: "SEC_STRIPE_LIVE_KEY", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g },
    { code: "SEC_WEBHOOK_SECRET", re: /\bwhsec_[A-Za-z0-9]{20,}\b/g },
  ];
  let out = input;
  for (const { code, re } of res) out = out.replace(re, `[REDACTED:${code}]`);
  return out;
}
