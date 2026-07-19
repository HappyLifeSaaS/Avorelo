// Avorelo Activation Detector. Detects workspace, AI tools, models, environment.
// Local-first, deterministic, no network calls. Returns presence/capability info only.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { execSync } from "node:child_process";
import { platform } from "node:os";

export type RepoIdentity = {
  root: string;
  gitDetected: boolean;
  remote?: string | null;
  branch?: string | null;
  dirty?: boolean;
};

export type EnvironmentInfo = {
  os: string;
  nodeVersion?: string | null;
  packageManager?: string | null;
  framework?: string | null;
  testCommand?: string | null;
  sitePreviewCommand?: string | null;
};

export type AiToolsDetected = {
  claudeCodeDetected: boolean;
  codexDetected: boolean;
  cursorDetected: boolean;
  agentsMdDetected: boolean;
  claudeMdDetected: boolean;
  cursorRulesDetected: boolean;
  codexConfigDetected: boolean;
};

export type ModelsAndTools = {
  skillsRegistryAvailable: boolean;
  modelRouterAvailable: boolean;
  primitiveRouterAvailable: boolean;
  scannersAvailable: boolean;
  browserProofAvailable: boolean;
  githubAvailable: boolean;
};

function tryExec(cmd: string, cwd: string): string | null {
  try { return execSync(cmd, { cwd, stdio: "pipe", timeout: 5000 }).toString().trim(); } catch { return null; }
}

function commandExists(cmd: string): boolean {
  try {
    const check = platform() === "win32" ? `where ${cmd}` : `which ${cmd}`;
    execSync(check, { stdio: "pipe", timeout: 3000 });
    return true;
  } catch { return false; }
}

export function detectRepoIdentity(dir: string): RepoIdentity {
  const gitDir = tryExec("git rev-parse --git-dir", dir);
  if (!gitDir) return { root: dir, gitDetected: false };
  const remote = tryExec("git remote get-url origin", dir);
  const branch = tryExec("git branch --show-current", dir);
  const dirtyOut = tryExec("git status --porcelain", dir);
  return { root: dir, gitDetected: true, remote, branch, dirty: dirtyOut ? dirtyOut.length > 0 : undefined };
}

export function detectEnvironment(dir: string): EnvironmentInfo {
  const nodeVersion = tryExec("node --version", dir);
  let packageManager: string | null = null;
  if (existsSync(join(dir, "pnpm-lock.yaml"))) packageManager = "pnpm";
  else if (existsSync(join(dir, "yarn.lock"))) packageManager = "yarn";
  else if (existsSync(join(dir, "bun.lockb"))) packageManager = "bun";
  else if (existsSync(join(dir, "package-lock.json"))) packageManager = "npm";
  else if (existsSync(join(dir, "package.json"))) packageManager = "npm";

  let framework: string | null = null;
  let testCommand: string | null = null;
  let sitePreviewCommand: string | null = null;

  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.next) framework = "next";
      else if (deps.react) framework = "react";
      else if (deps.vue) framework = "vue";
      else if (deps.svelte) framework = "svelte";
      else if (deps.express) framework = "express";
      else if (deps.fastify) framework = "fastify";
      if (pkg.scripts?.test) testCommand = `${packageManager || "npm"} run test`;
      if (pkg.scripts?.["site:preview"]) sitePreviewCommand = `${packageManager || "npm"} run site:preview`;
      else if (pkg.scripts?.dev) sitePreviewCommand = `${packageManager || "npm"} run dev`;
    } catch {}
  }
  if (existsSync(join(dir, "main.wasp"))) framework = "wasp";

  return { os: platform(), nodeVersion, packageManager, framework, testCommand, sitePreviewCommand };
}

export function detectAiTools(dir: string): AiToolsDetected {
  return {
    claudeCodeDetected: existsSync(join(dir, ".claude")) || existsSync(join(dir, ".claude", "settings.json")),
    codexDetected: existsSync(join(dir, ".codex")),
    cursorDetected: existsSync(join(dir, ".cursor")),
    agentsMdDetected: existsSync(join(dir, "AGENTS.md")),
    claudeMdDetected: existsSync(join(dir, "CLAUDE.md")),
    cursorRulesDetected: existsSync(join(dir, ".cursor", "rules")),
    codexConfigDetected: existsSync(join(dir, ".codex", "config.toml")) || existsSync(join(dir, "codex.json")),
  };
}

export function detectModelsAndTools(dir: string): ModelsAndTools {
  const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
  const env = process.env;
  return {
    skillsRegistryAvailable: existsSync(join(ROOT, "src/avorelo/validation/skill-operating-system/registry.ts")),
    modelRouterAvailable: existsSync(join(ROOT, "src/avorelo/validation/model-routing/index.ts")),
    primitiveRouterAvailable: existsSync(join(ROOT, "tools/route-primitive.ts")),
    scannersAvailable: existsSync(join(ROOT, "src/avorelo/validation/scanners/index.ts")),
    browserProofAvailable: commandExists("playwright") || commandExists("npx") && existsSync(join(dir, "node_modules", "@playwright")),
    githubAvailable: commandExists("gh"),
  };
}

export type DetectionResult = {
  repo: RepoIdentity;
  environment: EnvironmentInfo;
  aiTools: AiToolsDetected;
  modelsAndTools: ModelsAndTools;
  summary: {
    toolsDetected: string[];
    modelsDetected: string[];
    missingAdvisory: string[];
  };
};

export function runFullDetection(dir: string): DetectionResult {
  const repo = detectRepoIdentity(dir);
  const environment = detectEnvironment(dir);
  const aiTools = detectAiTools(dir);
  const modelsAndTools = detectModelsAndTools(dir);

  const toolsDetected: string[] = [];
  if (aiTools.claudeCodeDetected) toolsDetected.push("Claude Code");
  if (aiTools.codexDetected) toolsDetected.push("Codex");
  if (aiTools.cursorDetected) toolsDetected.push("Cursor");
  if (aiTools.claudeMdDetected) toolsDetected.push("CLAUDE.md");
  if (aiTools.agentsMdDetected) toolsDetected.push("AGENTS.md");
  if (repo.gitDetected) toolsDetected.push("git");
  if (environment.packageManager) toolsDetected.push(environment.packageManager);
  if (environment.framework) toolsDetected.push(environment.framework);

  const modelsDetected: string[] = [];
  if (modelsAndTools.skillsRegistryAvailable) modelsDetected.push("Skill OS");
  if (modelsAndTools.modelRouterAvailable) modelsDetected.push("Model Router");
  if (modelsAndTools.scannersAvailable) modelsDetected.push("Scanners");
  if (modelsAndTools.primitiveRouterAvailable) modelsDetected.push("Primitive Router");

  const missingAdvisory: string[] = [];
  if (!modelsAndTools.browserProofAvailable) missingAdvisory.push("Playwright (browser proof)");
  if (!modelsAndTools.githubAvailable) missingAdvisory.push("GitHub CLI");

  return { repo, environment, aiTools, modelsAndTools, summary: { toolsDetected, modelsDetected, missingAdvisory } };
}
