import { existsSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";

export interface RepoPreflightResult {
  ok: boolean;
  repoRoot: string;
  resolvedPath: string;
  isGitRepo: boolean;
  hasPackageJson: boolean;
  hasSrcDir: boolean;
  isRuntimeDataDir: boolean;
  isCanonicalSourceRepo: boolean;
  warnings: string[];
  blockers: string[];
}

const RUNTIME_DATA_INDICATORS = [
  "activation",
  "receipts",
  "work-briefs",
  "context",
  "sessions",
];

const SOURCE_REPO_INDICATORS = [
  "package.json",
  "tsconfig.json",
  "src",
];

export function runRepoPreflight(targetDir: string): RepoPreflightResult {
  const resolvedPath = resolve(targetDir);
  const warnings: string[] = [];
  const blockers: string[] = [];

  const dirExists = existsSync(resolvedPath);
  if (!dirExists) {
    return {
      ok: false,
      repoRoot: targetDir,
      resolvedPath,
      isGitRepo: false,
      hasPackageJson: false,
      hasSrcDir: false,
      isRuntimeDataDir: false,
      isCanonicalSourceRepo: false,
      warnings,
      blockers: ["Target directory does not exist."],
    };
  }

  const isGitRepo = existsSync(join(resolvedPath, ".git"));
  const hasPackageJson = existsSync(join(resolvedPath, "package.json"));
  const hasSrcDir = existsSync(join(resolvedPath, "src"));

  const dirName = basename(resolvedPath);
  const isNamedAvorelo = dirName === ".avorelo";

  const runtimeIndicatorCount = RUNTIME_DATA_INDICATORS.filter(
    (ind) => existsSync(join(resolvedPath, ind)),
  ).length;

  const sourceIndicatorCount = SOURCE_REPO_INDICATORS.filter(
    (ind) => existsSync(join(resolvedPath, ind)),
  ).length;

  const isRuntimeDataDir = isNamedAvorelo && !isGitRepo && runtimeIndicatorCount >= 2;

  const isCanonicalSourceRepo = isGitRepo && hasPackageJson && hasSrcDir;

  if (isRuntimeDataDir) {
    blockers.push(
      `Directory "${resolvedPath}" is an Avorelo runtime data directory (.avorelo/), not a source repository. ` +
      "Developer/source operations (build, test, commit, context-control) must run from the canonical source repo.",
    );
  }

  if (!isGitRepo && !isRuntimeDataDir) {
    warnings.push("No .git directory found. This may not be a proper source repository.");
  }

  if (!hasPackageJson && !isRuntimeDataDir) {
    warnings.push("No package.json found. This may not be a Node.js project root.");
  }

  if (isNamedAvorelo && isGitRepo) {
    warnings.push(
      "Directory is named '.avorelo' but contains a .git repo. " +
      "Verify this is intentional — runtime data dirs are typically not git repos.",
    );
  }

  return {
    ok: blockers.length === 0,
    repoRoot: resolvedPath,
    resolvedPath,
    isGitRepo,
    hasPackageJson,
    hasSrcDir,
    isRuntimeDataDir,
    isCanonicalSourceRepo,
    warnings,
    blockers,
  };
}

export function formatPreflightResult(result: RepoPreflightResult): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("Avorelo Repo Preflight");
  lines.push("");
  lines.push(`  Path:              ${result.resolvedPath}`);
  lines.push(`  Git repo:          ${result.isGitRepo ? "yes" : "no"}`);
  lines.push(`  Package.json:      ${result.hasPackageJson ? "yes" : "no"}`);
  lines.push(`  Source dir (src/):  ${result.hasSrcDir ? "yes" : "no"}`);
  lines.push(`  Runtime data dir:  ${result.isRuntimeDataDir ? "YES — blocked" : "no"}`);
  lines.push(`  Canonical source:  ${result.isCanonicalSourceRepo ? "yes" : "no"}`);

  if (result.blockers.length > 0) {
    lines.push("");
    lines.push("  BLOCKED:");
    for (const b of result.blockers) lines.push(`    - ${b}`);
  }

  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("  Warnings:");
    for (const w of result.warnings) lines.push(`    - ${w}`);
  }

  if (result.ok) {
    lines.push("");
    lines.push("  Status: OK");
  } else {
    lines.push("");
    lines.push("  Status: BLOCKED — cannot proceed with source operations here.");
  }

  lines.push("");
  return lines.join("\n");
}
