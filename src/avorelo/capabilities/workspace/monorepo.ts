// Avorelo monorepo workspace detection. Detects workspaces from package.json,
// pnpm-workspace.yaml, and apps/packages directory conventions.
// Local-first, deterministic, no network.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";

export type Workspace = {
  name: string;
  path: string;
  relativePath: string;
  hasPackageJson: boolean;
  hasAgentsMd: boolean;
  hasCursorRules: boolean;
};

export type MonorepoDetection = {
  isMonorepo: boolean;
  strategy: "npm-workspaces" | "pnpm-workspaces" | "directory-convention" | "none";
  workspaces: Workspace[];
  rootPath: string;
};

function expandGlobDirs(dir: string, patterns: string[]): string[] {
  const results: string[] = [];
  for (const pattern of patterns) {
    const clean = pattern.replace(/\/\*$/, "").replace(/\*$/, "");
    if (!clean) continue;
    const base = join(dir, clean);
    if (!existsSync(base)) continue;
    if (clean.includes("*")) continue; // skip complex globs
    try {
      const stat = statSync(base);
      if (stat.isDirectory()) {
        if (existsSync(join(base, "package.json"))) {
          results.push(base);
        } else {
          for (const entry of readdirSync(base, { withFileTypes: true })) {
            if (entry.isDirectory() && existsSync(join(base, entry.name, "package.json"))) {
              results.push(join(base, entry.name));
            }
          }
        }
      }
    } catch {}
  }
  return results;
}

function buildWorkspace(dir: string, wsPath: string): Workspace {
  const rel = wsPath.replace(dir, "").replace(/^[/\\]/, "").replace(/\\/g, "/");
  let name = rel;
  try {
    const pkg = JSON.parse(readFileSync(join(wsPath, "package.json"), "utf8"));
    if (pkg.name) name = pkg.name;
  } catch {}
  return {
    name,
    path: wsPath,
    relativePath: rel,
    hasPackageJson: existsSync(join(wsPath, "package.json")),
    hasAgentsMd: existsSync(join(wsPath, "AGENTS.md")),
    hasCursorRules: existsSync(join(wsPath, ".cursor")),
  };
}

export function detectMonorepo(dir: string): MonorepoDetection {
  // 1. npm/yarn workspaces in package.json
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    if (Array.isArray(pkg.workspaces)) {
      const paths = expandGlobDirs(dir, pkg.workspaces);
      if (paths.length > 0) {
        return {
          isMonorepo: true,
          strategy: "npm-workspaces",
          workspaces: paths.map(p => buildWorkspace(dir, p)),
          rootPath: dir,
        };
      }
    }
    if (pkg.workspaces?.packages && Array.isArray(pkg.workspaces.packages)) {
      const paths = expandGlobDirs(dir, pkg.workspaces.packages);
      if (paths.length > 0) {
        return {
          isMonorepo: true,
          strategy: "npm-workspaces",
          workspaces: paths.map(p => buildWorkspace(dir, p)),
          rootPath: dir,
        };
      }
    }
  } catch {}

  // 2. pnpm-workspace.yaml
  const pnpmPath = join(dir, "pnpm-workspace.yaml");
  if (existsSync(pnpmPath)) {
    try {
      const content = readFileSync(pnpmPath, "utf8");
      const match = content.match(/packages:\s*\n((?:\s*-\s*.+\n?)+)/);
      if (match) {
        const patterns = match[1].split("\n").map(l => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean);
        const paths = expandGlobDirs(dir, patterns);
        if (paths.length > 0) {
          return {
            isMonorepo: true,
            strategy: "pnpm-workspaces",
            workspaces: paths.map(p => buildWorkspace(dir, p)),
            rootPath: dir,
          };
        }
      }
    } catch {}
  }

  // 3. Directory convention: apps/* or packages/*
  for (const conventionDir of ["apps", "packages"]) {
    const convPath = join(dir, conventionDir);
    if (existsSync(convPath)) {
      try {
        const entries = readdirSync(convPath, { withFileTypes: true });
        const workspacePaths = entries
          .filter(e => e.isDirectory() && existsSync(join(convPath, e.name, "package.json")))
          .map(e => join(convPath, e.name));
        if (workspacePaths.length > 0) {
          return {
            isMonorepo: true,
            strategy: "directory-convention",
            workspaces: workspacePaths.map(p => buildWorkspace(dir, p)),
            rootPath: dir,
          };
        }
      } catch {}
    }
  }

  return { isMonorepo: false, strategy: "none", workspaces: [], rootPath: dir };
}
