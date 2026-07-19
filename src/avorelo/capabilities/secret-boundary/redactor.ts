// Avorelo Secret Boundary — Recursive shape-preserving redactor (Phase 2).
// Walks strings/objects/arrays, preserves shape and non-string primitives, replaces secret substrings with
// [REDACTED:<CODE>]. Returns the redacted copy + coded findings + SafeReferences. No raw value in the output,
// in thrown errors, or in any serialized form. Includes a JSON.stringify fallback so stdout/stderr/nested
// MCP fields are all covered (adapted from old PR #77/#80 PostToolUse runtime).

import { detectInString } from "./detector.ts";
import type { SecretFinding, SecretSourceKind } from "./detector.ts";
import { makeSafeReference } from "../../shared/safe-reference/index.ts";
import type { SafeReference } from "../../shared/schemas/index.ts";

export type RedactionOutput<T = unknown> = {
  redacted: T; // same shape as input, secret substrings replaced
  findings: SecretFinding[]; // coded findings (no raw values)
  safeReferences: SafeReference[]; // one per finding — model/handoff safe
  secretCount: number;
};

const SB_RISK: Record<string, SafeReference["riskClass"]> = {
  SEC_PRIVATE_KEY: "credential",
  SEC_AWS_SECRET_KEY: "credential",
  SEC_SERVICE_ROLE_KEY: "credential",
  SEC_DATABASE_URL_WITH_PASSWORD: "credential",
  SEC_STRIPE_LIVE_KEY: "credential",
  SEC_GH_TOKEN: "credential",
  SEC_AWS_ACCESS_KEY: "credential",
  SEC_WEBHOOK_SECRET: "secret_like",
  SEC_GENERIC_BEARER_TOKEN: "secret_like",
  SEC_ENV_SECRET_ASSIGNMENT: "secret_like",
};

function safeRefForFinding(f: SecretFinding): SafeReference {
  return makeSafeReference({
    id: f.fingerprint,
    sourceKind: f.sourceKind === "file" ? "file" : f.sourceKind === "tool_output" ? "tool_output" : f.sourceKind === "handoff" ? "handoff" : f.sourceKind === "env" ? "env" : "unknown",
    label: f.redactedPreview,
    riskClass: SB_RISK[f.code] ?? "secret_like",
    safeReasonCodes: [f.code, `severity:${f.severity}`],
  });
}

/** Redact every secret substring in a single string. Replaces each detected match with [REDACTED:<CODE>]. */
export function redactString(input: string, sourceKind: SecretSourceKind = "unknown", location = ""): { redacted: string; findings: SecretFinding[] } {
  const findings = detectInString(input, sourceKind, location);
  if (findings.length === 0) return { redacted: input, findings };
  // Re-run each pattern to physically remove matches (detector returns no raw, so we replace via the same regexes).
  let out = input;
  // Reuse detector regexes through a second deterministic pass keyed by code.
  out = replaceAllSecrets(out);
  return { redacted: out, findings };
}

// Internal: deterministic replacement using the same patterns as the detector (kept in sync intentionally).
const REPLACERS: { code: string; re: RegExp }[] = [
  { code: "SEC_PRIVATE_KEY", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { code: "SEC_PRIVATE_KEY", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { code: "SEC_DATABASE_URL_WITH_PASSWORD", re: /\b((?:postgres|postgresql|mysql|mariadb|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s/@]+:)[^@\s/]+(@[^\s/]+)/g },
  { code: "SEC_GH_TOKEN", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { code: "SEC_AWS_ACCESS_KEY", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { code: "SEC_STRIPE_LIVE_KEY", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g },
  { code: "SEC_WEBHOOK_SECRET", re: /\bwhsec_[A-Za-z0-9]{20,}\b/g },
  { code: "SEC_AWS_SECRET_KEY", re: /((?:aws_secret_access_key|aws_secret)["'\s:=]+)[A-Za-z0-9/+]{40}\b/gi },
  { code: "SEC_SERVICE_ROLE_KEY", re: /((?:service_role[_a-z]*["'\s:=]+|SUPABASE_SERVICE_ROLE_KEY\s*=\s*))[A-Za-z0-9._\-]{20,}/gi },
  { code: "SEC_GENERIC_BEARER_TOKEN", re: /\b(Bearer\s+)[A-Za-z0-9._\-]{20,}/g },
  { code: "SEC_ENV_SECRET_ASSIGNMENT", re: /\b([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|APIKEY|API_KEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*\s*=\s*)['"]?[^\s'"#]{6,}/g },
];

function replaceAllSecrets(input: string): string {
  let out = input;
  for (const { code, re } of REPLACERS) {
    out = out.replace(re, (full, pre?: string, post?: string) => {
      // Patterns with a capture-prefix keep the safe prefix (e.g. "Bearer ", "KEY=", "db://user:") and the
      // trailing "@host" so the SHAPE/context stays readable while the value is gone.
      if (typeof pre === "string") return `${pre}[REDACTED:${code}]${typeof post === "string" ? post : ""}`;
      return `[REDACTED:${code}]`;
    });
  }
  return out;
}

/** Recursively redact any value, preserving shape and non-string primitives. */
export function redactValue<T>(value: T, sourceKind: SecretSourceKind = "unknown"): RedactionOutput<T> {
  const findings: SecretFinding[] = [];

  const seen = new WeakSet<object>(); // guard against circular references
  const walk = (v: unknown, path: string): unknown => {
    if (typeof v === "string") {
      const r = redactString(v, sourceKind, path || sourceKind);
      findings.push(...r.findings);
      return r.redacted;
    }
    // Behavior-bearing values are NEVER preserved: a function (e.g. a malicious `toJSON`) on the output
    // could be invoked by a later JSON.stringify and leak a raw secret from a closure. Replace with a
    // safe placeholder so it cannot run. Symbols/bigint likewise reduced to safe placeholders.
    if (typeof v === "function") return "[Function]";
    if (typeof v === "symbol") return "[Symbol]";
    if (typeof v === "bigint") return `[BigInt:${v.toString().length}d]`;
    if (v && typeof v === "object") {
      if (seen.has(v as object)) return "[Circular]";
      seen.add(v as object);
      if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`));
      // Build a PLAIN object from OWN enumerable keys only. Reading each value invokes any getter; do that
      // inside try/catch so a throwing/secret-bearing getter cannot surface a raw value via the error.
      // `toJSON` (own, enumerable) becomes the string "[Function]" above, so the output object — a fresh
      // plain {} with no prototype toJSON — cannot be re-serialized through a custom toJSON.
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>)) {
        let raw: unknown;
        try { raw = (v as Record<string, unknown>)[k]; } catch { out[k] = "[Unreadable]"; continue; }
        out[k] = walk(raw, path ? `${path}.${k}` : k);
      }
      return out;
    }
    return v; // numbers, booleans, null, undefined preserved
  };

  const redacted = walk(value, "") as T;

  // JSON.stringify fallback: catch any secret that survived in a non-walkable corner (e.g. via toJSON).
  // We classify the serialized form; if anything is detected, we surface it as a finding (output already redacted).
  try {
    const serialized = JSON.stringify(redacted);
    if (typeof serialized === "string") {
      for (const f of detectInString(serialized, sourceKind, "json_fallback")) {
        if (!findings.some((x) => x.fingerprint === f.fingerprint && x.code === f.code)) findings.push(f);
      }
    }
  } catch {
    /* circular or non-serializable — shape walk already redacted reachable strings */
  }

  const dedup = new Map<string, SecretFinding>();
  for (const f of findings) dedup.set(`${f.code}:${f.fingerprint}`, f);
  const finalFindings = Array.from(dedup.values());

  return {
    redacted,
    findings: finalFindings,
    safeReferences: finalFindings.map(safeRefForFinding),
    secretCount: finalFindings.length,
  };
}

// Re-export so callers can build refs from raw findings if needed (no raw value involved).
export { safeRefForFinding };
