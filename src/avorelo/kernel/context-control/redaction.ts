const SECRET_PATTERNS = [
  /(?:api[_-]?key|apikey)\s*[:=]\s*\S+/gi,
  /(?:secret|token|password|passwd|pwd)\s*[:=]\s*\S+/gi,
  /(?:aws|gcp|azure)[_-](?:access|secret|key)\s*[:=]\s*\S+/gi,
  /-----BEGIN [\w ]*PRIVATE KEY-----[\s\S]*?-----END [\w ]*PRIVATE KEY-----/g,
  /(?:sk-|pk-|rk-|ghp_|gho_|ghs_|ghr_)[a-zA-Z0-9]{8,}/g,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/g,
];

const SECRET_LINE_PATTERNS = [
  /(?:api[_-]?key|apikey)\s*[:=]/i,
  /(?:secret|token|password|passwd|pwd)\s*[:=]/i,
  /(?:aws|gcp|azure)[_-](?:access|secret|key)/i,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
  /(?:sk-|pk-|rk-)[a-zA-Z0-9]{20,}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /(?:PRIVATE|SECRET|CREDENTIAL|AUTH_TOKEN)\s*[:=]/,
];

export function containsSecret(text: string): boolean {
  return SECRET_LINE_PATTERNS.some((p) => p.test(text));
}

export function redactText(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

export function redactLines(text: string): { text: string; redactionsApplied: number } {
  const lines = text.split("\n");
  let redactionsApplied = 0;
  const result = lines.map((line) => {
    if (containsSecret(line)) {
      redactionsApplied++;
      return "[REDACTED_LINE]";
    }
    return line;
  });
  return { text: result.join("\n"), redactionsApplied };
}

export function isSensitivePath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  if (lower.includes(".env") && !lower.endsWith(".md")) return true;
  if (/credentials|\.pem$|\.key$|\.p12$|\.pfx$/i.test(lower)) return true;
  return false;
}
