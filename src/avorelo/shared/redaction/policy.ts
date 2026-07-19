// Avorelo Redaction Policy Foundation (Phase 1). Allowlist-FIRST classification of any payload that may be
// persisted, shown to the model, included in a handoff, or synced. This is NOT the full secret detector
// (that is Phase 2) — it is the policy contract + helpers + base tests the boundary will build on.
//
// Invariant: a payload is safe ONLY if it contains nothing forbidden. Forbidden, by default:
//   raw prompt · raw transcript · raw secret · env value · terminal log · git diff · source dump ·
//   sensitive file path. Allowed: safe references, finding codes, counts, status, timestamps, confidence labels.

import { detectSecretClasses } from "./index.ts";
import { isSafeReference } from "../safe-reference/index.ts";
import type { PayloadClassification } from "../schemas/index.ts";

// Key names whose VALUES are forbidden in a safe payload (raw content by intent).
const FORBIDDEN_KEYS: { re: RegExp; code: string }[] = [
  { re: /(^|_)prompts?$/i, code: "raw_prompt" },
  { re: /transcript/i, code: "raw_transcript" },
  { re: /(rawsource|raw_source|sourcecode|source_code|sourcedump|source_dump)/i, code: "raw_source" },
  { re: /(^|_)secret/i, code: "raw_secret" },
  { re: /(envvalue|env_value|envvar|env_var|dotenv)/i, code: "env_value" },
  { re: /(terminallog|terminal_log|stdout|stderr|consolelog|console_log)/i, code: "terminal_log" },
  { re: /(gitdiff|git_diff|diff)/i, code: "git_diff" },
  { re: /(sensitivepath|sensitive_path|filepath|file_path|abspath|abs_path)/i, code: "sensitive_file_path" },
];

// Allowlisted key names — metadata that is always safe to carry.
const ALLOWED_KEYS = new Set(
  [
    "id", "ids", "ref", "refs", "evidenceref", "evidencerefs", "receiptid", "contractid", "evidenceid",
    "code", "codes", "reasoncode", "reasoncodes", "findingcode", "findingcodes",
    "count", "counts", "total", "samplesize",
    "status", "decision", "kind", "level", "evidencelevels", "confidence", "label", "valuelabel",
    "timestamp", "createdat", "writtenat", "updatedat", "generatedat", "ts",
    "class", "classes", "redactionclasses", "digest", "receiptdigest", "schemaname", "schemaversion",
    "safereasoncodes", "riskclass", "sourcekind",
  ].map((k) => k.toLowerCase()),
);

// Content patterns that indicate forbidden raw data regardless of key name.
const CONTENT_PATTERNS: { re: RegExp; code: string }[] = [
  { re: /diff --git |^@@ -\d|^\+\+\+ |^--- /m, code: "git_diff" },
  { re: /\x1b\[[0-9;]*m/, code: "terminal_log" }, // ANSI escape sequences
  { re: /(^|[\s"'])(\/home\/[^\s"']+|\/Users\/[^\s"']+|[A-Za-z]:\\Users\\[^\s"']+)/m, code: "sensitive_file_path" },
  { re: /(\.env\b|\/\.ssh\/|id_rsa\b|\.pem\b|\.aws\/credentials)/i, code: "sensitive_file_path" },
  { re: /\b[A-Z][A-Z0-9_]{2,}=\S+/, code: "env_value" }, // KEY=value env assignment
];

function normKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function classifyString(s: string, violations: Set<string>): void {
  for (const cls of detectSecretClasses(s)) {
    // detectSecretClasses returns value-classes (e.g. "aws_access_key") and "key:..." markers.
    if (!cls.startsWith("key:")) violations.add(`raw_secret:${cls}`);
  }
  for (const { re, code } of CONTENT_PATTERNS) {
    if (re.test(s)) violations.add(code);
  }
}

function walk(value: unknown, violations: Set<string>, keyHint?: string): void {
  // A SafeReference is the one allowed way to carry a reference to sensitive content.
  if (isSafeReference(value)) return;

  if (typeof value === "string") {
    classifyString(value, violations);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) walk(v, violations, keyHint);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const nk = normKey(k);
      const forbidden = FORBIDDEN_KEYS.find(({ re }) => re.test(k));
      const isEmpty = v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
      if (forbidden && !isEmpty && !ALLOWED_KEYS.has(nk)) {
        violations.add(forbidden.code);
      }
      walk(v, violations, k);
    }
    return;
  }
  // numbers/booleans/null are safe scalars
}

/**
 * Classify a payload against the allowlist-first policy. `safe` is true only when no violation is found.
 * Use this as the gate BEFORE persisting, displaying to the model, handing off, or syncing.
 */
export function classifyPayload(payload: unknown): PayloadClassification {
  const violations = new Set<string>();
  walk(payload, violations);
  return { safe: violations.size === 0, violations: Array.from(violations).sort() };
}

/** Convenience boolean: is this payload safe to persist/display/handoff/sync? */
export function isPayloadSafe(payload: unknown): boolean {
  return classifyPayload(payload).safe;
}
