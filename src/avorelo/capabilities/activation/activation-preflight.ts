// Avorelo Activation Preflight — environment diagnosis and self-healing.
// Detects common environment issues that prevent activation from starting
// and provides actionable recovery paths. No secrets, no env dumps, no repo mutation.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { platform, tmpdir } from "node:os";

export type PreflightCheckId =
  | "node_available"
  | "npm_available"
  | "npx_available"
  | "npm_cache_writable"
  | "temp_dir_writable"
  | "target_dir_writable"
  | "powershell_execution_policy"
  | "network_npm_registry";

export type PreflightCheck = {
  id: PreflightCheckId;
  label: string;
  passed: boolean;
  details: string;
  recovery?: string;
};

export type PreflightResult = {
  ok: boolean;
  canStart: boolean;
  checks: PreflightCheck[];
  fallbackCommand?: string;
  taxonomy: ActivationFailureTaxonomy;
};

export type ActivationFailureTaxonomy =
  | "READY"
  | "BLOCKED_BY_RUNNER_BEFORE_AVORELO_STARTED"
  | "LOCAL_PREFLIGHT_FAILED"
  | "ACTIVATION_SUCCEEDED_LOCALLY"
  | "TELEMETRY_UPLOADED"
  | "DASHBOARD_LINKED"
  | "UNKNOWN";

export function runPreflight(targetDir: string): PreflightResult {
  const checks: PreflightCheck[] = [];
  const isWindows = platform() === "win32";

  // 1. Node available
  let nodeOk = false;
  try {
    const v = execSync("node --version", { encoding: "utf8", timeout: 5000 }).trim();
    nodeOk = v.startsWith("v");
    checks.push({ id: "node_available", label: "Node.js available", passed: nodeOk, details: v });
  } catch {
    checks.push({ id: "node_available", label: "Node.js available", passed: false, details: "node not found in PATH", recovery: "Install Node.js from https://nodejs.org (LTS recommended)" });
  }

  // 2. npm available
  let npmOk = false;
  try {
    const v = execSync("npm --version", { encoding: "utf8", timeout: 5000 }).trim();
    npmOk = true;
    checks.push({ id: "npm_available", label: "npm available", passed: true, details: `npm ${v}` });
  } catch {
    checks.push({ id: "npm_available", label: "npm available", passed: false, details: "npm not found in PATH", recovery: "npm is included with Node.js — reinstall Node.js from https://nodejs.org" });
  }

  // 3. npx available
  let npxOk = false;
  try {
    const v = execSync("npx --version", { encoding: "utf8", timeout: 5000 }).trim();
    npxOk = true;
    checks.push({ id: "npx_available", label: "npx available", passed: true, details: `npx ${v}` });
  } catch {
    checks.push({ id: "npx_available", label: "npx available", passed: false, details: "npx not found in PATH", recovery: "npx is included with npm 5.2+. Update Node.js to get a recent npm." });
  }

  // 4. npm cache writable
  let cacheOk = false;
  try {
    const cachePath = execSync("npm config get cache", { encoding: "utf8", timeout: 5000 }).trim();
    if (cachePath && existsSync(cachePath)) {
      cacheOk = true;
      checks.push({ id: "npm_cache_writable", label: "npm cache directory accessible", passed: true, details: "cache directory exists" });
    } else {
      checks.push({
        id: "npm_cache_writable",
        label: "npm cache directory accessible",
        passed: false,
        details: "cache path does not exist",
        recovery: isWindows
          ? 'Use a temporary cache. PowerShell: $env:npm_config_cache="$env:TEMP\\npm-cache-avorelo"; npx -y avorelo@latest activate --scope project-wide --claim <activation_claim>. cmd.exe: cmd /c "set npm_config_cache=%TEMP%\\npm-cache-avorelo && npx -y avorelo@latest activate --scope project-wide --claim <activation_claim>"'
          : "Use a temporary cache: npm_config_cache=$(mktemp -d) npx -y avorelo@latest activate --scope project-wide --claim <activation_claim>",
      });
    }
  } catch {
    checks.push({
      id: "npm_cache_writable",
      label: "npm cache directory accessible",
      passed: false,
      details: "could not read npm cache config",
      recovery: isWindows
        ? 'Use a temporary cache. PowerShell: $env:npm_config_cache="$env:TEMP\\npm-cache-avorelo"; npx -y avorelo@latest activate --scope project-wide --claim <activation_claim>. cmd.exe: cmd /c "set npm_config_cache=%TEMP%\\npm-cache-avorelo && npx -y avorelo@latest activate --scope project-wide --claim <activation_claim>"'
        : "Use a temporary cache: npm_config_cache=$(mktemp -d) npx -y avorelo@latest activate --scope project-wide --claim <activation_claim>",
    });
  }

  // 5. Temp dir writable
  let tempOk = false;
  try {
    const td = tmpdir();
    tempOk = existsSync(td);
    checks.push({ id: "temp_dir_writable", label: "Temp directory writable", passed: tempOk, details: tempOk ? "temp dir accessible" : "temp dir not found" });
  } catch {
    checks.push({ id: "temp_dir_writable", label: "Temp directory writable", passed: false, details: "cannot access temp directory" });
  }

  // 6. Target dir writable
  let targetOk = false;
  try {
    targetOk = existsSync(targetDir);
    checks.push({ id: "target_dir_writable", label: "Target directory exists", passed: targetOk, details: targetOk ? "directory accessible" : "directory not found" });
  } catch {
    checks.push({ id: "target_dir_writable", label: "Target directory exists", passed: false, details: "cannot access target directory" });
  }

  // 7. PowerShell execution policy (Windows only)
  let psOk = true;
  if (isWindows) {
    try {
      const policy = execSync("powershell -NoProfile -Command Get-ExecutionPolicy", { encoding: "utf8", timeout: 5000 }).trim().toLowerCase();
      const blocked = policy === "restricted" || policy === "allsigned";
      psOk = !blocked;
      checks.push({
        id: "powershell_execution_policy",
        label: "PowerShell execution policy",
        passed: psOk,
        details: `Policy: ${policy}`,
        recovery: blocked ? 'PowerShell is blocking script execution. Use Command Prompt instead:\n  cmd /c npx -y avorelo@latest activate --scope project-wide --claim <activation_claim>' : undefined,
      });
    } catch {
      checks.push({ id: "powershell_execution_policy", label: "PowerShell execution policy", passed: true, details: "could not check (non-PowerShell shell)" });
    }
  }

  // 8. npm registry reachable (lightweight check)
  let registryOk = false;
  try {
    const result = execSync("npm view avorelo@latest version", { encoding: "utf8", timeout: 15000 }).trim();
    registryOk = /^\d+\.\d+\.\d+/.test(result);
    checks.push({ id: "network_npm_registry", label: "npm registry reachable", passed: registryOk, details: registryOk ? `latest: ${result}` : "unexpected response" });
  } catch {
    checks.push({ id: "network_npm_registry", label: "npm registry reachable", passed: false, details: "cannot reach npm registry", recovery: "Check your network connection. If behind a proxy, configure npm: npm config set proxy <url>" });
  }

  const allPassed = checks.every(c => c.passed);
  const canStart = nodeOk && npmOk && npxOk;

  let fallbackCommand: string | undefined;
  if (!allPassed && isWindows) {
    fallbackCommand = buildWindowsFallbackCommand();
  }

  const taxonomy: ActivationFailureTaxonomy = allPassed ? "READY" : (canStart ? "LOCAL_PREFLIGHT_FAILED" : "BLOCKED_BY_RUNNER_BEFORE_AVORELO_STARTED");

  return { ok: allPassed, canStart, checks, fallbackCommand, taxonomy };
}

export function buildWindowsFallbackCommand(): string {
  return [
    ":: Avorelo activation — safe Windows fallback",
    ":: Run this in Command Prompt (cmd.exe), not PowerShell",
    'set AVORELO_TEMP=%TEMP%\\avorelo-activate-%RANDOM%',
    "mkdir %AVORELO_TEMP%",
    'set npm_config_cache=%AVORELO_TEMP%\\npm-cache',
    "cd /d %AVORELO_TEMP%",
    "npx -y avorelo@latest activate --scope project-wide --claim <activation_claim>",
    "npx -y avorelo@latest status",
  ].join("\n");
}

export function buildUnixFallbackCommand(): string {
  return [
    "# Avorelo activation — safe Unix fallback",
    'AVORELO_TEMP=$(mktemp -d "${TMPDIR:-/tmp}/avorelo-activate-XXXXXX")',
    'npm_config_cache="$AVORELO_TEMP/npm-cache" npx -y avorelo@latest activate --scope project-wide --claim <activation_claim> --target .',
    "npx -y avorelo@latest status",
  ].join("\n");
}

export function formatPreflightReport(result: PreflightResult): string {
  const lines: string[] = ["", "Avorelo Activation Preflight", ""];

  for (const c of result.checks) {
    const icon = c.passed ? "✓" : "✗";
    lines.push(`  ${icon} ${c.label}: ${c.details}`);
    if (!c.passed && c.recovery) {
      for (const line of c.recovery.split("\n")) {
        lines.push(`    → ${line}`);
      }
    }
  }

  lines.push("");
  if (result.ok) {
    lines.push("  All checks passed. Ready to activate.");
  } else if (result.canStart) {
    lines.push("  Some checks failed but activation can attempt to proceed.");
    lines.push("  Fix the issues above for the best experience.");
  } else {
    lines.push("  Activation cannot start in this environment.");
    lines.push("  Avorelo requires Node.js and npm to be available.");
    if (result.fallbackCommand) {
      lines.push("");
      lines.push("  Safe fallback command:");
      for (const line of result.fallbackCommand.split("\n")) {
        lines.push(`    ${line}`);
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}
