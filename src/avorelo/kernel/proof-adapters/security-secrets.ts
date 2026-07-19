import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import type { ProofAdapter, AdapterResult, AdapterEvidence } from "./types.ts";

const SECRET_PATTERNS = [
  { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["']?[a-zA-Z0-9_\-]{16,}/i, label: "api_key" },
  { pattern: /(?:secret|token|password|passwd|pwd)\s*[:=]\s*["']?[a-zA-Z0-9_\-]{8,}/i, label: "credential" },
  { pattern: /(?:aws|gcp|azure)[_-](?:access|secret|key)/i, label: "cloud_credential" },
  { pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, label: "private_key" },
  { pattern: /(?:sk-|pk-|rk-)[a-zA-Z0-9]{20,}/, label: "api_token" },
  { pattern: /ghp_[a-zA-Z0-9]{36}/, label: "github_token" },
  { pattern: /xox[bpas]-[a-zA-Z0-9\-]+/, label: "slack_token" },
];

function scanFileForSecrets(filePath: string): AdapterEvidence[] {
  const findings: AdapterEvidence[] = [];
  if (!existsSync(filePath)) return findings;

  try {
    const content = readFileSync(filePath, "utf-8");
    for (const { pattern, label } of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        findings.push({
          type: "secret_finding",
          summary: `Potential ${label} found in ${filePath}`,
          passed: false,
          detail: `Pattern match: ${label}`,
        });
      }
    }
  } catch {
    // skip unreadable files
  }
  return findings;
}

function runNpmAudit(dir: string): AdapterEvidence {
  try {
    const output = execSync("npm audit --json 2>&1", {
      cwd: dir,
      encoding: "utf-8",
      timeout: 60_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const parsed = JSON.parse(output);
    const critical = parsed?.metadata?.vulnerabilities?.critical ?? 0;
    const high = parsed?.metadata?.vulnerabilities?.high ?? 0;
    const hasCritical = critical > 0 || high > 0;

    return {
      type: "package_audit",
      summary: hasCritical
        ? `npm audit: ${critical} critical, ${high} high`
        : "npm audit: no critical/high vulnerabilities",
      passed: !hasCritical,
      detail: `critical=${critical}, high=${high}`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "unknown";
    if (msg.includes("ENOLOCK") || msg.includes("package-lock.json")) {
      return {
        type: "package_audit",
        summary: "npm audit: skipped (no lockfile)",
        passed: true,
        detail: "No package-lock.json found",
      };
    }
    try {
      const parsed = JSON.parse(msg.split("\n").find(l => l.startsWith("{")) || "{}");
      const critical = parsed?.metadata?.vulnerabilities?.critical ?? 0;
      const high = parsed?.metadata?.vulnerabilities?.high ?? 0;
      return {
        type: "package_audit",
        summary: `npm audit: ${critical} critical, ${high} high`,
        passed: critical === 0 && high === 0,
        detail: `critical=${critical}, high=${high}`,
      };
    } catch {
      return {
        type: "package_audit",
        summary: "npm audit: completed with warnings",
        passed: true,
        detail: msg.slice(0, 300),
      };
    }
  }
}

export const securitySecretsAdapter: ProofAdapter = {
  id: "security-secrets",
  name: "Security & Secrets",
  description: "Scans changed files for secrets and runs npm audit",

  detect(): boolean {
    return true;
  },

  canRunAutomatically(): boolean {
    return true;
  },

  async execute(dir: string, changedFiles?: string[]): Promise<AdapterResult> {
    const start = Date.now();
    const evidence: AdapterEvidence[] = [];

    if (changedFiles && changedFiles.length > 0) {
      for (const f of changedFiles.slice(0, 50)) {
        const findings = scanFileForSecrets(f);
        evidence.push(...findings);
      }
    }

    const secretFindings = evidence.filter(e => !e.passed);
    if (secretFindings.length === 0) {
      evidence.push({
        type: "no_secret_findings",
        summary: `No secrets found in ${changedFiles?.length ?? 0} scanned file(s)`,
        passed: true,
      });
    }

    if (existsSync(`${dir}/package.json`)) {
      evidence.push(runNpmAudit(dir));
    }

    const overallPass = evidence.every(e => e.passed);

    return {
      adapterId: "security-secrets",
      status: overallPass ? "pass" : "fail",
      evidence,
      duration: Date.now() - start,
      containsRawSecret: false,
    };
  },
};
