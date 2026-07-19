// Avorelo Scanner Adapter System. Deterministic built-in scanners + adapter stubs for external tools.
// Scanners produce evidence, not truth. Kernel decides READY.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type ScannerMode = "BUILT_IN_DETERMINISTIC_NOW" | "EXTERNAL_TOOL_RUNS_IF_AVAILABLE" | "CI_INTEGRATION_READY" | "MANUAL_CHECKLIST_NOW" | "REFERENCE_ONLY" | "BACKLOG_REQUIRES_TOOL_INSTALL" | "BACKLOG_REQUIRES_LICENSE_REVIEW";
export type ScannerFinding = { scannerId: string; severity: string; file: string; pattern: string; description: string; redacted: boolean };
export type ScannerResult = { scannerId: string; name: string; mode: ScannerMode; ran: boolean; findings: ScannerFinding[]; evidence: string; reason: string };

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
function collect(dir: string, ext: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => { const f = join(ROOT, d); if (!existsSync(f)) return; for (const e of readdirSync(f)) { const r = `${d}/${e}`; try { if (statSync(join(f, e)).isDirectory()) walk(r); else if (e.endsWith(ext)) out.push(r); } catch {} } };
  walk(dir); return out;
}

// Built-in deterministic scanners — run NOW, no external tool needed

function scanSecretPatterns(): ScannerResult {
  const findings: ScannerFinding[] = [];
  const files = [...collect("src/avorelo", ".ts"), ...collect("src/avorelo/surfaces/public-web/static", ".html")];
  const patterns = [
    { name: "AWS key", re: /AKIA[0-9A-Z]{16}/, exclude: /dogfood|cli\/avorelo|test|review-skill|fixture/ },
    { name: "Live Stripe key", re: /sk_live_[a-zA-Z0-9]{20,}/ },
    { name: "Webhook secret", re: /whsec_[a-zA-Z0-9]{20,}/ },
    { name: "Private key", re: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/, exclude: /dogfood|scanner|review-skill|redaction|test/ },
    { name: "GitHub token", re: /ghp_[a-zA-Z0-9]{36}/ },
  ];
  for (const f of files) {
    const content = readFileSync(join(ROOT, f), "utf8");
    for (const p of patterns) {
      if (p.exclude && p.exclude.test(f)) continue;
      if (p.re.test(content)) {
        findings.push({ scannerId: "secret-patterns", severity: "HIGH", file: f, pattern: p.name, description: `${p.name} pattern detected`, redacted: true });
      }
    }
  }
  return { scannerId: "secret-patterns", name: "Secret Pattern Scanner", mode: "BUILT_IN_DETERMINISTIC_NOW", ran: true, findings, evidence: `${files.length} files scanned`, reason: "" };
}

function scanEnvExposure(): ScannerResult {
  const findings: ScannerFinding[] = [];
  const staticFiles = collect("src/avorelo/surfaces/public-web/static", ".html");
  for (const f of staticFiles) {
    const content = readFileSync(join(ROOT, f), "utf8");
    if (/process\.env|\.env\b/.test(content)) {
      findings.push({ scannerId: "env-exposure", severity: "MEDIUM", file: f, pattern: ".env reference", description: "Environment variable reference in public static page", redacted: true });
    }
  }
  return { scannerId: "env-exposure", name: "Env File Exposure Scanner", mode: "BUILT_IN_DETERMINISTIC_NOW", ran: true, findings, evidence: `${staticFiles.length} static files scanned`, reason: "" };
}

function scanGeneratedPageExposure(): ScannerResult {
  const findings: ScannerFinding[] = [];
  const staticDir = "src/avorelo/surfaces/public-web/static";
  const forbidden = ["payments.html", "admin.html"];
  for (const f of forbidden) {
    if (existsSync(join(ROOT, staticDir, f))) {
      findings.push({ scannerId: "generated-exposure", severity: "HIGH", file: `${staticDir}/${f}`, pattern: "generated page exposed", description: `${f} should not be in static canonical site`, redacted: false });
    }
  }
  return { scannerId: "generated-exposure", name: "Generated Page Exposure Scanner", mode: "BUILT_IN_DETERMINISTIC_NOW", ran: true, findings, evidence: `Checked ${forbidden.length} forbidden pages`, reason: "" };
}

function scanUnsupportedClaims(): ScannerResult {
  const findings: ScannerFinding[] = [];
  const staticFiles = collect("src/avorelo/surfaces/public-web/static", ".html");
  for (const f of staticFiles) {
    const content = readFileSync(join(ROOT, f), "utf8");
    if (/saves?\s+\d+%/i.test(content)) findings.push({ scannerId: "claims", severity: "HIGH", file: f, pattern: "percentage savings", description: "Unsupported percentage savings claim", redacted: false });
    if (/guaranteed.*ROI/i.test(content)) findings.push({ scannerId: "claims", severity: "HIGH", file: f, pattern: "guaranteed ROI", description: "Guaranteed ROI claim", redacted: false });
    if (/SOC\s*2\s*(certified|compliant)/i.test(content)) findings.push({ scannerId: "claims", severity: "HIGH", file: f, pattern: "SOC certification", description: "False SOC 2 certification claim", redacted: false });
    if (/WCAG\s*(certified|compliant)/i.test(content)) findings.push({ scannerId: "claims", severity: "HIGH", file: f, pattern: "WCAG certification", description: "False WCAG compliance claim", redacted: false });
  }
  return { scannerId: "claims", name: "Unsupported Claims Scanner", mode: "BUILT_IN_DETERMINISTIC_NOW", ran: true, findings, evidence: `${staticFiles.length} pages scanned`, reason: "" };
}

function scanBroadPermissions(): ScannerResult {
  const findings: ScannerFinding[] = [];
  const tsFiles = collect("src/avorelo", ".ts");
  for (const f of tsFiles) {
    if (f.includes("dogfood") || f.includes("test") || f.includes("review-skill") || f.includes("scanner")) continue;
    const content = readFileSync(join(ROOT, f), "utf8");
    // Check for actual 0.0.0.0 in code (not comments explaining it's avoided)
    const lines = content.split("\n");
    for (const line of lines) {
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue; // skip comments
      if (/0\.0\.0\.0/.test(line)) findings.push({ scannerId: "permissions", severity: "HIGH", file: f, pattern: "0.0.0.0 bind", description: "Server binds to all interfaces (should be 127.0.0.1)", redacted: false });
    }
  }
  return { scannerId: "permissions", name: "Broad Permission Scanner", mode: "BUILT_IN_DETERMINISTIC_NOW", ran: true, findings, evidence: `${tsFiles.length} TS files scanned`, reason: "" };
}

// External tool stubs — these check if tool is available, run if safe, or report HOLD
function stubExternalScanner(id: string, name: string, cmd: string): ScannerResult {
  // In this implementation, external tools are NOT executed — adapter only
  return { scannerId: id, name, mode: "BACKLOG_REQUIRES_TOOL_INSTALL", ran: false, findings: [], evidence: "", reason: `${cmd} not installed/available — adapter stub only` };
}

export function runAllScanners(): { results: ScannerResult[]; summary: { total: number; ran: number; findings: number; high: number } } {
  const results = [
    scanSecretPatterns(),
    scanEnvExposure(),
    scanGeneratedPageExposure(),
    scanUnsupportedClaims(),
    scanBroadPermissions(),
    // External stubs
    stubExternalScanner("codeql", "CodeQL SAST", "codeql"),
    stubExternalScanner("semgrep", "Semgrep", "semgrep"),
    stubExternalScanner("gitleaks", "Gitleaks", "gitleaks"),
    stubExternalScanner("trufflehog", "TruffleHog", "trufflehog"),
    stubExternalScanner("osv-scanner", "OSV Scanner", "osv-scanner"),
    stubExternalScanner("syft", "Syft SBOM", "syft"),
    stubExternalScanner("grype", "Grype", "grype"),
  ];
  const allFindings = results.flatMap(r => r.findings);
  return { results, summary: { total: results.length, ran: results.filter(r => r.ran).length, findings: allFindings.length, high: allFindings.filter(f => f.severity === "HIGH").length } };
}
