import { createHash, randomUUID } from "node:crypto";
import { existsSync, statSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DiscoveredSource, DiscoveryResult, ContextSourceKind } from "./types.ts";

const INSTRUCTION_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".cursorrules",
  ".cursor/rules",
  "README.md",
];

const AVORELO_CONTEXT_PATHS = [
  ".avorelo/activation/activation-state.json",
  ".avorelo/run-entry/run-entry.json",
  ".avorelo/metrics/rollups.json",
];

const AVORELO_DIRS: Array<{ dir: string; kind: ContextSourceKind }> = [
  { dir: ".avorelo/receipts", kind: "receipt" },
  { dir: ".avorelo/verification-receipts", kind: "receipt" },
  { dir: ".avorelo/policies", kind: "policy" },
];

const DOCS_DIRS = ["docs", "docs/release/pending-features"];

const UNSAFE_EXTENSIONS = new Set([".env", ".pem", ".key", ".p12", ".pfx"]);

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function isUnsafePath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  if (lower.includes(".env") && !lower.endsWith(".md")) return true;
  if (lower.includes("credentials") || lower.includes("secret")) {
    if (!lower.endsWith(".md") && !lower.endsWith(".ts") && !lower.endsWith(".js")) return true;
  }
  for (const ext of UNSAFE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function discoverFile(
  repoRoot: string,
  relativePath: string,
  kind: ContextSourceKind,
): DiscoveredSource | null {
  const fullPath = join(repoRoot, relativePath);
  const exists = existsSync(fullPath);

  if (!exists) return null;

  try {
    const stat = statSync(fullPath);
    if (!stat.isFile()) return null;

    const safeToRead = !isUnsafePath(relativePath);
    const content = safeToRead ? readFileSync(fullPath, "utf-8") : "";

    return {
      id: `source_${randomUUID().slice(0, 8)}`,
      kind,
      path: relativePath,
      exists: true,
      sizeBytes: stat.size,
      lastModifiedAt: stat.mtime.toISOString(),
      hash: safeToRead ? hashContent(content) : "redacted",
      candidateCount: safeToRead ? estimateCandidates(content, kind) : 0,
      safeToRead,
      reason: safeToRead ? "safe_local_file" : "unsafe_content_detected",
    };
  } catch {
    return null;
  }
}

function estimateCandidates(content: string, kind: ContextSourceKind): number {
  if (!content) return 0;
  if (kind === "receipt") return 1;
  if (kind === "policy") return 1;

  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const headings = lines.filter((l) => /^#{1,3}\s/.test(l));
  if (headings.length > 1) return headings.length;

  const bullets = lines.filter((l) => /^\s*[-*]\s/.test(l));
  if (bullets.length > 2) return Math.min(bullets.length, 20);

  return Math.min(Math.ceil(lines.length / 5), 10);
}

function discoverDirFiles(
  repoRoot: string,
  relativeDir: string,
  kind: ContextSourceKind,
  extensions: string[] = [".json", ".md"],
): DiscoveredSource[] {
  const dirPath = join(repoRoot, relativeDir);
  if (!existsSync(dirPath)) return [];

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    const sources: DiscoveredSource[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!extensions.some((ext) => entry.name.endsWith(ext))) continue;
      const rel = `${relativeDir}/${entry.name}`;
      const source = discoverFile(repoRoot, rel, kind);
      if (source) sources.push(source);
    }
    return sources;
  } catch {
    return [];
  }
}

export function discoverContextSources(repoRoot: string): DiscoveryResult {
  const resolved = resolve(repoRoot);
  const sources: DiscoveredSource[] = [];
  const warnings: string[] = [];
  let redactionsApplied = 0;

  for (const file of INSTRUCTION_FILES) {
    const source = discoverFile(resolved, file, "file");
    if (source) sources.push(source);
  }

  for (const file of AVORELO_CONTEXT_PATHS) {
    const source = discoverFile(resolved, file, "dashboard_state");
    if (source) sources.push(source);
  }

  for (const { dir, kind } of AVORELO_DIRS) {
    sources.push(...discoverDirFiles(resolved, dir, kind));
  }

  for (const dir of DOCS_DIRS) {
    sources.push(...discoverDirFiles(resolved, dir, "file", [".md"]));
  }

  const pkgSource = discoverFile(resolved, "package.json", "file");
  if (pkgSource) sources.push(pkgSource);

  for (const source of sources) {
    if (!source.safeToRead) {
      redactionsApplied++;
      warnings.push(`Unsafe content excluded: ${source.path}`);
    }
  }

  return {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    repoRoot: resolved,
    sources,
    warnings,
    redactionsApplied,
  };
}
