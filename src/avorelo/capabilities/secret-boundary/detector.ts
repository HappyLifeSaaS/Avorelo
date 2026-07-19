// Avorelo Secret Boundary — Detector (Phase 2). Deterministic, local, no network/provider calls.
// This is the rich runtime detector the Phase-1 redaction policy anticipated. It NEVER returns a raw value:
// findings carry a code, a non-reversible fingerprint, and a redacted preview only.
//
// Relationship to Phase 1: shared/redaction/detectSecretClasses remains the baseline used by the Phase-1
// allowlist policy (classifyPayload). This detector is additive and richer (coded findings) — it does not
// replace or bypass the Phase-1 redactor.

import { createHash } from "node:crypto";

export type SecretFindingCode =
  | "SEC_PRIVATE_KEY"
  | "SEC_GH_TOKEN"
  | "SEC_AWS_ACCESS_KEY"
  | "SEC_AWS_SECRET_KEY"
  | "SEC_STRIPE_LIVE_KEY"
  | "SEC_WEBHOOK_SECRET"
  | "SEC_GENERIC_BEARER_TOKEN"
  | "SEC_ENV_SECRET_ASSIGNMENT"
  | "SEC_SERVICE_ROLE_KEY"
  | "SEC_DATABASE_URL_WITH_PASSWORD";

export type SecretSeverity = "low" | "medium" | "high" | "critical";
export type SecretConfidence = "pattern" | "high_entropy" | "contextual" | "mixed";
export type SecretSourceKind = "file" | "tool_output" | "env" | "instruction" | "handoff" | "receipt" | "unknown";

// A finding. There is intentionally NO rawValue field. The matched substring is consumed internally to
// produce a fingerprint + preview and is then discarded.
export type SecretFinding = {
  code: SecretFindingCode;
  severity: SecretSeverity;
  confidence: SecretConfidence;
  sourceKind: SecretSourceKind;
  location: string; // a safe location label (e.g. "tool_output", "file:config", a key path) — never the value
  fingerprint: string; // stable, non-reversible (sha256 prefix of the raw match) — for dedupe/audit
  redactedPreview: string; // safe preview — contains NO characters of the secret
};

// Critical codes fail closed (block-worthy by default).
const CRITICAL_CODES = new Set<SecretFindingCode>([
  "SEC_PRIVATE_KEY",
  "SEC_AWS_SECRET_KEY",
  "SEC_SERVICE_ROLE_KEY",
  "SEC_DATABASE_URL_WITH_PASSWORD",
  "SEC_STRIPE_LIVE_KEY",
]);

export function isCriticalCode(code: SecretFindingCode): boolean {
  return CRITICAL_CODES.has(code);
}

type Pattern = {
  code: SecretFindingCode;
  re: RegExp;
  severity: SecretSeverity;
  confidence: SecretConfidence;
};

// Ordered patterns. Global+multiline so we can find every occurrence. Each is stateless via String.matchAll.
const PATTERNS: Pattern[] = [
  { code: "SEC_PRIVATE_KEY", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g, severity: "critical", confidence: "pattern" },
  { code: "SEC_PRIVATE_KEY", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g, severity: "critical", confidence: "pattern" },
  { code: "SEC_DATABASE_URL_WITH_PASSWORD", re: /\b(?:postgres|postgresql|mysql|mariadb|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s/@]+:[^@\s/]+@[^\s/]+/g, severity: "critical", confidence: "contextual" },
  { code: "SEC_GH_TOKEN", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, severity: "high", confidence: "pattern" },
  { code: "SEC_AWS_ACCESS_KEY", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, severity: "high", confidence: "pattern" },
  { code: "SEC_STRIPE_LIVE_KEY", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g, severity: "critical", confidence: "pattern" },
  { code: "SEC_WEBHOOK_SECRET", re: /\bwhsec_[A-Za-z0-9]{20,}\b/g, severity: "high", confidence: "pattern" },
  { code: "SEC_AWS_SECRET_KEY", re: /(?:aws_secret_access_key|aws_secret)["'\s:=]+[A-Za-z0-9/+]{40}\b/gi, severity: "critical", confidence: "contextual" },
  { code: "SEC_SERVICE_ROLE_KEY", re: /(?:service_role[_a-z]*["'\s:=]+|SUPABASE_SERVICE_ROLE_KEY\s*=\s*)[A-Za-z0-9._\-]{20,}/gi, severity: "critical", confidence: "contextual" },
  { code: "SEC_SERVICE_ROLE_KEY", re: /eyJ[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]{6,}(?=[\s\S]{0,80}service_role)/g, severity: "critical", confidence: "contextual" },
  { code: "SEC_GENERIC_BEARER_TOKEN", re: /\bBearer\s+[A-Za-z0-9._\-]{20,}/g, severity: "medium", confidence: "contextual" },
  { code: "SEC_ENV_SECRET_ASSIGNMENT", re: /\b[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|APIKEY|API_KEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*\s*=\s*['"]?[^\s'"#]{6,}/g, severity: "high", confidence: "contextual" },
];

/** Non-reversible fingerprint of a raw match (sha256 prefix). Stable for dedupe; cannot recover the value. */
function fingerprintOf(raw: string): string {
  return "fp_" + createHash("sha256").update(raw).digest("hex").slice(0, 12);
}

/** A redacted preview that contains NONE of the secret's characters. Safe to log/persist/show the model. */
function previewOf(code: SecretFindingCode, raw: string): string {
  return `[REDACTED:${code} len=${raw.length} ${fingerprintOf(raw)}]`;
}

/** Detect secret findings in a single string. Returns coded findings — never the raw value. */
export function detectInString(input: string, sourceKind: SecretSourceKind = "unknown", location = ""): SecretFinding[] {
  if (typeof input !== "string" || input.length === 0) return [];
  const findings: SecretFinding[] = [];
  const seen = new Set<string>(); // dedupe by code+fingerprint
  for (const p of PATTERNS) {
    for (const m of input.matchAll(p.re)) {
      const raw = m[0];
      const fp = fingerprintOf(raw);
      const key = `${p.code}:${fp}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        code: p.code,
        severity: p.severity,
        confidence: p.confidence,
        sourceKind,
        location: location || sourceKind,
        fingerprint: fp,
        redactedPreview: previewOf(p.code, raw),
      });
    }
  }
  return findings;
}

/** True if the string carries any secret. */
export function hasSecret(input: string): boolean {
  return detectInString(input).length > 0;
}

/** True if any finding is a critical (fail-closed) credential class. */
export function hasCriticalFinding(findings: SecretFinding[]): boolean {
  return findings.some((f) => isCriticalCode(f.code));
}
