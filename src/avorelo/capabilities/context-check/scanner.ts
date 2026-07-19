// Avorelo Agent Context Check — scanner. Discovers agent instruction sources in a repo.
// Read-only, local-only, no content upload, no secrets exposure.

import { existsSync, readdirSync, readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { ContextSource } from "./types.ts";

const BYTES_PER_TOKEN_ESTIMATE = 4;
const MAX_SCAN_DEPTH = 5;

export type ScanResult = {
  sources: ContextSource[];
  scanDurationMs: number;
};

export function scanSources(repoRoot: string): ScanResult {
  const start = performance.now();
  const sources: ContextSource[] = [];

  sources.push(...scanClaude(repoRoot));
  sources.push(...scanAgents(repoRoot));
  sources.push(...scanCursor(repoRoot));
  sources.push(...scanCodex(repoRoot));
  sources.push(...scanGeneric(repoRoot));

  return { sources, scanDurationMs: performance.now() - start };
}

function fileMeta(fullPath: string): { sizeBytes: number; estimatedTokens: number; lastModified: number } | null {
  try {
    const st = statSync(fullPath);
    if (!st.isFile()) return null;
    return { sizeBytes: st.size, estimatedTokens: Math.ceil(st.size / BYTES_PER_TOKEN_ESTIMATE), lastModified: st.mtimeMs };
  } catch { return null; }
}

function safeRead(fullPath: string, maxBytes = 64_000): string {
  try {
    const buf = Buffer.alloc(maxBytes);
    const fd = openSync(fullPath, "r");
    const bytesRead = readSync(fd, buf, 0, maxBytes, 0);
    closeSync(fd);
    return buf.toString("utf8", 0, bytesRead);
  } catch { return ""; }
}

function extractReferences(content: string): string[] {
  const refs: string[] = [];
  const patterns = [
    /(?:include|import|source|read|load)\s+["']([^"']+)["']/gi,
    /(?:include|import|source|read|load)\s+(?:file:\s*)?["']([^"']+)["']/gi,
    /\[\[([^\]]+)\]\]/g,
    /(?:file|path):\s*["']?([^\s"',\]]+)/gi,
    /["']([^"'\s]+\.(?:md|ts|js|json|yaml|yml|toml))["']/gi,
  ];
  for (const pat of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pat.exec(content)) !== null) {
      const ref = m[1].trim();
      if (ref.length > 2 && ref.length < 200 && !ref.startsWith("http")) refs.push(ref);
    }
  }
  return [...new Set(refs)];
}

function scanClaude(repoRoot: string): ContextSource[] {
  const sources: ContextSource[] = [];

  const rootMd = join(repoRoot, "CLAUDE.md");
  if (existsSync(rootMd)) {
    const meta = fileMeta(rootMd);
    if (meta) {
      const content = safeRead(rootMd);
      sources.push({
        path: relative(repoRoot, rootMd).split(sep).join("/"),
        sourceType: "claude_md",
        agentFamily: "claude",
        ...meta,
        references: extractReferences(content),
      });
    }
  }

  const claudeDir = join(repoRoot, ".claude");
  if (existsSync(claudeDir)) {
    try {
      for (const entry of walkDir(claudeDir, 3)) {
        if (!entry.endsWith(".md") && !entry.endsWith(".json") && !entry.endsWith(".txt")) continue;
        if (entry.includes("settings.json")) continue;
        const meta = fileMeta(entry);
        if (meta) {
          const content = safeRead(entry);
          sources.push({
            path: relative(repoRoot, entry).split(sep).join("/"),
            sourceType: "claude_dir",
            agentFamily: "claude",
            ...meta,
            references: extractReferences(content),
          });
        }
      }
    } catch {}
  }

  // Nested CLAUDE.md files
  try {
    for (const entry of walkDir(repoRoot, MAX_SCAN_DEPTH)) {
      if (!entry.endsWith(`${sep}CLAUDE.md`) && !entry.endsWith("/CLAUDE.md")) continue;
      const rel = relative(repoRoot, entry).split(sep).join("/");
      if (rel === "CLAUDE.md") continue;
      if (rel.includes("node_modules/")) continue;
      const meta = fileMeta(entry);
      if (meta) {
        const content = safeRead(entry);
        sources.push({
          path: rel,
          sourceType: "claude_md",
          agentFamily: "claude",
          nested: true,
          ...meta,
          references: extractReferences(content),
        });
      }
    }
  } catch {}

  return sources;
}

function scanAgents(repoRoot: string): ContextSource[] {
  const agentsMd = join(repoRoot, "AGENTS.md");
  if (!existsSync(agentsMd)) return [];
  const meta = fileMeta(agentsMd);
  if (!meta) return [];
  const content = safeRead(agentsMd);
  return [{
    path: "AGENTS.md",
    sourceType: "agents_md",
    agentFamily: "generic",
    ...meta,
    references: extractReferences(content),
  }];
}

function scanCursor(repoRoot: string): ContextSource[] {
  const sources: ContextSource[] = [];
  const cursorDir = join(repoRoot, ".cursor");
  if (!existsSync(cursorDir)) return sources;

  const rulesDir = join(cursorDir, "rules");
  if (existsSync(rulesDir)) {
    try {
      for (const entry of walkDir(rulesDir, 2)) {
        if (!entry.endsWith(".mdc") && !entry.endsWith(".md") && !entry.endsWith(".txt")) continue;
        const meta = fileMeta(entry);
        if (meta) {
          const content = safeRead(entry);
          const globs = extractCursorGlobs(content);
          sources.push({
            path: relative(repoRoot, entry).split(sep).join("/"),
            sourceType: "cursor_rule",
            agentFamily: "cursor",
            appliesToPaths: globs.length > 0 ? globs : undefined,
            ...meta,
            references: extractReferences(content),
          });
        }
      }
    } catch {}
  }

  const cursorrules = join(repoRoot, ".cursorrules");
  if (existsSync(cursorrules)) {
    const meta = fileMeta(cursorrules);
    if (meta) {
      sources.push({
        path: ".cursorrules",
        sourceType: "cursor_rule",
        agentFamily: "cursor",
        ...meta,
        references: [],
      });
    }
  }

  return sources;
}

function extractCursorGlobs(content: string): string[] {
  const match = content.match(/globs:\s*\[([^\]]*)\]/);
  if (!match) {
    const yamlMatch = content.match(/globs:\s*\n((?:\s+-\s+.+\n?)+)/);
    if (!yamlMatch) return [];
    return yamlMatch[1].split("\n").map(l => l.replace(/^\s*-\s*/, "").trim().replace(/['"]/g, "")).filter(Boolean);
  }
  return match[1].split(",").map(g => g.trim().replace(/['"]/g, "")).filter(Boolean);
}

function scanCodex(repoRoot: string): ContextSource[] {
  const sources: ContextSource[] = [];
  const codexMd = join(repoRoot, "CODEX.md");
  if (existsSync(codexMd)) {
    const meta = fileMeta(codexMd);
    if (meta) {
      sources.push({
        path: "CODEX.md",
        sourceType: "codex_config",
        agentFamily: "codex",
        ...meta,
        references: [],
      });
    }
  }
  const codexDir = join(repoRoot, ".codex");
  if (existsSync(codexDir)) {
    try {
      for (const entry of walkDir(codexDir, 2)) {
        const meta = fileMeta(entry);
        if (meta) {
          sources.push({
            path: relative(repoRoot, entry).split(sep).join("/"),
            sourceType: "codex_config",
            agentFamily: "codex",
            ...meta,
            references: [],
          });
        }
      }
    } catch {}
  }
  return sources;
}

function scanGeneric(repoRoot: string): ContextSource[] {
  const sources: ContextSource[] = [];
  const knownFiles = [".github/copilot-instructions.md", "CONTRIBUTING.md"];
  for (const rel of knownFiles) {
    const full = join(repoRoot, rel);
    if (existsSync(full)) {
      const meta = fileMeta(full);
      if (meta) {
        sources.push({
          path: rel.split(sep).join("/"),
          sourceType: "generic",
          agentFamily: rel.includes("copilot") ? "copilot" : "generic",
          ...meta,
          references: [],
        });
      }
    }
  }
  return sources;
}

export type AdapterCapability = {
  adapter: string;
  agentFamily: string;
  supportsExcludedPaths: boolean;
  excludedPathsSource: "none" | "structured_metadata" | "work_contract_only";
};

export function getAdapterCapabilities(): AdapterCapability[] {
  return [
    { adapter: "claude_md", agentFamily: "claude", supportsExcludedPaths: false, excludedPathsSource: "none" },
    { adapter: "claude_dir", agentFamily: "claude", supportsExcludedPaths: false, excludedPathsSource: "none" },
    { adapter: "cursor_rule", agentFamily: "cursor", supportsExcludedPaths: false, excludedPathsSource: "none" },
    { adapter: "codex_config", agentFamily: "codex", supportsExcludedPaths: false, excludedPathsSource: "none" },
    { adapter: "agents_md", agentFamily: "generic", supportsExcludedPaths: false, excludedPathsSource: "none" },
    { adapter: "copilot", agentFamily: "copilot", supportsExcludedPaths: false, excludedPathsSource: "none" },
    { adapter: "generic", agentFamily: "generic", supportsExcludedPaths: false, excludedPathsSource: "none" },
    { adapter: "work_contract", agentFamily: "avorelo", supportsExcludedPaths: true, excludedPathsSource: "work_contract_only" },
  ];
}

function* walkDir(dir: string, maxDepth: number, depth = 0): Generator<string> {
  if (depth >= maxDepth) return;
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git" || name === "dist" || name === "build") continue;
    const full = join(dir, name);
    try {
      const st = statSync(full);
      if (st.isFile()) yield full;
      else if (st.isDirectory()) yield* walkDir(full, maxDepth, depth + 1);
    } catch {}
  }
}
