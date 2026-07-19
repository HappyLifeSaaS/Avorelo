// Avorelo redaction (Slice 1). Deterministic, local. The ONLY sanitizer; every durable write passes through it.
// S2 invariant: no raw secret/prompt/transcript/source may survive into a receipt/ledger/dashboard/sync payload.

const MAX_STRING_LENGTH = 500;

// Secret value patterns (entropy + broad prefixes, per G4/R3). Detection emits class only, never the value.
const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "aws_access_key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "github_token", re: /\bghp_[A-Za-z0-9]{30,}\b/g },
  { name: "openai_key", re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: "slack_token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "gcp_key", re: /\bAIza[0-9A-Za-z_\-]{35}\b/g },
  { name: "private_key_block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g },
  { name: "high_entropy_hex", re: /\b[0-9a-fA-F]{40,}\b/g },
];

// Field names whose VALUES must never be persisted (prompts, transcripts, raw source, credentials).
const REDACT_KEYS = [
  "prompt",
  "prompts",
  "transcript",
  "rawcode",
  "raw_code",
  "source",
  "secret",
  "token",
  "apikey",
  "api_key",
  "password",
  "credential",
  "private_key",
  "authorization",
];

export type RedactionResult<T> = { value: T; redacted: true; hits: string[] };

function redactString(s: string, hits: string[]): string {
  let out = s;
  for (const { name, re } of SECRET_PATTERNS) {
    // Use replace-and-compare (NOT re.test()): a shared global regex's lastIndex would persist
    // across calls and cause intermittent false negatives. replace() with /g is stateless here.
    const replaced = out.replace(re, `[REDACTED:${name}]`);
    if (replaced !== out) {
      hits.push(name);
      out = replaced;
    }
  }
  if (out.length > MAX_STRING_LENGTH) out = out.slice(0, MAX_STRING_LENGTH) + "…[truncated]";
  return out;
}

function shouldRedactKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
  return REDACT_KEYS.some((r) => k.includes(r.replace(/[^a-z0-9_]/g, "")));
}

function redactValue(v: unknown, hits: string[]): unknown {
  if (typeof v === "string") return redactString(v, hits);
  if (Array.isArray(v)) return v.map((x) => redactValue(x, hits));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
      if (shouldRedactKey(key)) {
        hits.push(`key:${key}`);
        out[key] = "[REDACTED:field]";
      } else {
        out[key] = redactValue(val, hits);
      }
    }
    return out;
  }
  return v;
}

/** Deep-redact any value. Returns a new (never-mutated) redacted copy + the classes of what was redacted. */
export function redact<T>(value: T): RedactionResult<T> {
  const hits: string[] = [];
  const out = redactValue(value, hits) as T;
  return { value: out, redacted: true, hits };
}

/** Detection only — returns the secret CLASSES present, never the values. Used by the secret signal. */
export function detectSecretClasses(value: unknown): string[] {
  const hits: string[] = [];
  redactValue(value, hits);
  return Array.from(new Set(hits));
}

/** Boolean check: does the content carry any raw secret? */
export function carriesRawSecret(content: unknown): boolean {
  return detectSecretClasses(content).length > 0;
}
