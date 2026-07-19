import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

export interface DetectedCapability {
  id: string;
  available: boolean;
  command?: string;
  detail?: string;
}

export interface RiskyScript {
  name: string;
  command: string;
  risk: "deploy" | "publish" | "destructive" | "network";
}

export interface ProjectCapabilities {
  timestamp: string;
  projectRootHash: string;
  packageManager: DetectedCapability;
  build: DetectedCapability;
  test: DetectedCapability;
  lint: DetectedCapability;
  typecheck: DetectedCapability;
  appStart: DetectedCapability;
  uiFramework: DetectedCapability;
  browserTooling: DetectedCapability;
  apiSchema: DetectedCapability;
  ciWorkflows: DetectedCapability;
  securityScanning: DetectedCapability;
  secretScanning: DetectedCapability;
  dependencyScanning: DetectedCapability;
  docsTooling: DetectedCapability;
  avoreloConfig: DetectedCapability;
  receiptHistory: DetectedCapability;
  riskyScripts: RiskyScript[];
  gitBranch: string | null;
  dirtyWorktree: boolean | null;
  packageVersion: string | null;
  lockfileState: "npm" | "pnpm" | "yarn" | "bun" | "missing";
  recommendedProofPath: string[];
  containsRawSecret: false;
}

const RISKY_PATTERNS = [
  { pattern: /publish/i, risk: "publish" as const },
  { pattern: /deploy/i, risk: "deploy" as const },
  { pattern: /netlify\s+deploy/i, risk: "deploy" as const },
  { pattern: /railway/i, risk: "deploy" as const },
  { pattern: /rm\s+-rf|del\s+\/s/i, risk: "destructive" as const },
  { pattern: /curl|wget/i, risk: "network" as const },
];

function readPackageJson(dir: string): Record<string, unknown> | null {
  const p = join(dir, "package.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function detectScript(scripts: Record<string, string> | undefined, ...names: string[]): DetectedCapability {
  if (!scripts) return { id: names[0], available: false };
  for (const name of names) {
    if (scripts[name]) {
      return { id: names[0], available: true, command: `npm run ${name}`, detail: scripts[name] };
    }
  }
  return { id: names[0], available: false };
}

function detectLockfile(dir: string): ProjectCapabilities["lockfileState"] {
  if (existsSync(join(dir, "package-lock.json"))) return "npm";
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(dir, "yarn.lock"))) return "yarn";
  if (existsSync(join(dir, "bun.lockb"))) return "bun";
  return "missing";
}

function detectUIFramework(pkg: Record<string, unknown> | null): DetectedCapability {
  if (!pkg) return { id: "uiFramework", available: false };
  const deps = { ...(pkg.dependencies as Record<string, string> || {}), ...(pkg.devDependencies as Record<string, string> || {}) };
  const frameworks = ["react", "vue", "svelte", "next", "nuxt", "angular", "@angular/core", "solid-js", "astro"];
  for (const fw of frameworks) {
    if (deps[fw]) return { id: "uiFramework", available: true, detail: fw };
  }
  return { id: "uiFramework", available: false };
}

function detectBrowserTooling(pkg: Record<string, unknown> | null, dir: string): DetectedCapability {
  if (!pkg) return { id: "browserTooling", available: false };
  const deps = { ...(pkg.dependencies as Record<string, string> || {}), ...(pkg.devDependencies as Record<string, string> || {}) };
  if (deps["playwright"] || deps["@playwright/test"]) return { id: "browserTooling", available: true, detail: "playwright" };
  if (deps["puppeteer"] || deps["puppeteer-core"]) return { id: "browserTooling", available: true, detail: "puppeteer" };
  if (existsSync(join(dir, "playwright.config.ts")) || existsSync(join(dir, "playwright.config.js"))) {
    return { id: "browserTooling", available: true, detail: "playwright" };
  }
  return { id: "browserTooling", available: false };
}

function detectApiSchema(dir: string): DetectedCapability {
  const candidates = ["openapi.json", "openapi.yaml", "openapi.yml", "swagger.json", "swagger.yaml", "schema.graphql", "schema.gql"];
  for (const f of candidates) {
    if (existsSync(join(dir, f))) return { id: "apiSchema", available: true, detail: f };
  }
  if (existsSync(join(dir, "api"))) {
    try {
      const files = readdirSync(join(dir, "api"));
      for (const f of files) {
        if (/openapi|swagger|schema\.(graphql|gql)/i.test(f)) {
          return { id: "apiSchema", available: true, detail: `api/${f}` };
        }
      }
    } catch { /* skip */ }
  }
  return { id: "apiSchema", available: false };
}

function detectCIWorkflows(dir: string): DetectedCapability {
  const ghDir = join(dir, ".github", "workflows");
  if (existsSync(ghDir)) {
    try {
      const files = readdirSync(ghDir).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));
      if (files.length > 0) return { id: "ciWorkflows", available: true, detail: `${files.length} GitHub Actions workflow(s)` };
    } catch { /* skip */ }
  }
  if (existsSync(join(dir, ".gitlab-ci.yml"))) return { id: "ciWorkflows", available: true, detail: "GitLab CI" };
  if (existsSync(join(dir, "Jenkinsfile"))) return { id: "ciWorkflows", available: true, detail: "Jenkins" };
  return { id: "ciWorkflows", available: false };
}

function detectAvoreloConfig(dir: string): DetectedCapability {
  const avDir = join(dir, ".avorelo");
  if (existsSync(avDir)) {
    return { id: "avoreloConfig", available: true, detail: ".avorelo directory present" };
  }
  return { id: "avoreloConfig", available: false };
}

function detectReceiptHistory(dir: string): DetectedCapability {
  const receiptDir = join(dir, ".avorelo", "artifact-guard");
  if (!existsSync(receiptDir)) return { id: "receiptHistory", available: false };
  try {
    const files = readdirSync(receiptDir).filter(f => f.startsWith("receipt-") && f.endsWith(".json"));
    if (files.length > 0) return { id: "receiptHistory", available: true, detail: `${files.length} receipt(s)` };
  } catch { /* skip */ }
  return { id: "receiptHistory", available: false };
}

function detectRiskyScripts(scripts: Record<string, string> | undefined): RiskyScript[] {
  if (!scripts) return [];
  const risky: RiskyScript[] = [];
  for (const [name, cmd] of Object.entries(scripts)) {
    for (const { pattern, risk } of RISKY_PATTERNS) {
      if (pattern.test(cmd) || pattern.test(name)) {
        risky.push({ name, command: cmd.slice(0, 100), risk });
        break;
      }
    }
  }
  return risky;
}

function getGitBranch(dir: string): string | null {
  try {
    const result = execSync("git rev-parse --abbrev-ref HEAD", { cwd: dir, encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
    return result.trim() || null;
  } catch {
    return null;
  }
}

function isGitDirty(dir: string): boolean | null {
  try {
    const result = execSync("git status --porcelain", { cwd: dir, encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
    return result.trim().length > 0;
  } catch {
    return null;
  }
}

function detectSecurityScanning(scripts: Record<string, string> | undefined, dir: string): DetectedCapability {
  if (scripts) {
    for (const [, cmd] of Object.entries(scripts)) {
      if (/semgrep|gitleaks|snyk|sonar/i.test(cmd)) {
        return { id: "securityScanning", available: true, detail: "script detected" };
      }
    }
  }
  return { id: "securityScanning", available: false };
}

function detectSecretScanning(scripts: Record<string, string> | undefined): DetectedCapability {
  if (scripts) {
    for (const [name, cmd] of Object.entries(scripts)) {
      if (/gitleaks|secret|credential/i.test(name) || /gitleaks/i.test(cmd)) {
        return { id: "secretScanning", available: true, detail: "script detected" };
      }
    }
  }
  return { id: "secretScanning", available: false };
}

function detectDependencyScanning(scripts: Record<string, string> | undefined): DetectedCapability {
  return { id: "dependencyScanning", available: true, command: "npm audit", detail: "npm audit (built-in)" };
}

function detectDocsTooling(dir: string, scripts: Record<string, string> | undefined): DetectedCapability {
  if (scripts) {
    for (const [name] of Object.entries(scripts)) {
      if (/docs?|storybook|typedoc/i.test(name)) {
        return { id: "docsTooling", available: true, detail: `npm run ${name}` };
      }
    }
  }
  if (existsSync(join(dir, "docs")) || existsSync(join(dir, "doc"))) {
    return { id: "docsTooling", available: true, detail: "docs directory present" };
  }
  return { id: "docsTooling", available: false };
}

function buildRecommendedProofPath(caps: Partial<ProjectCapabilities>): string[] {
  const steps: string[] = [];
  if (caps.build?.available) steps.push("build");
  if (caps.test?.available) steps.push("tests");
  if (caps.typecheck?.available) steps.push("typecheck");
  if (caps.lint?.available) steps.push("lint");
  if (caps.browserTooling?.available) steps.push("browser proof");
  if (caps.apiSchema?.available) steps.push("API schema validation");
  steps.push("artifact guard scan");
  steps.push("product surface check");
  if (caps.dependencyScanning?.available) steps.push("dependency audit");
  steps.push("evidence gate");
  return steps;
}

export function discoverCapabilities(dir: string): ProjectCapabilities {
  const pkg = readPackageJson(dir);
  const scripts = pkg?.scripts as Record<string, string> | undefined;

  const build = detectScript(scripts, "build");
  const test = detectScript(scripts, "test", "test:local", "test:all");
  const lint = detectScript(scripts, "lint", "eslint", "lint:fix");
  const typecheck = detectScript(scripts, "typecheck", "type-check", "tsc");
  const appStart = detectScript(scripts, "start", "dev", "serve");
  const uiFramework = detectUIFramework(pkg);
  const browserTooling = detectBrowserTooling(pkg, dir);
  const apiSchema = detectApiSchema(dir);
  const ciWorkflows = detectCIWorkflows(dir);
  const securityScanning = detectSecurityScanning(scripts, dir);
  const secretScanning = detectSecretScanning(scripts);
  const dependencyScanning = detectDependencyScanning(scripts);
  const docsTooling = detectDocsTooling(dir, scripts);
  const avoreloConfig = detectAvoreloConfig(dir);
  const receiptHistory = detectReceiptHistory(dir);
  const riskyScripts = detectRiskyScripts(scripts);
  const lockfileState = detectLockfile(dir);
  const packageManager: DetectedCapability = {
    id: "packageManager",
    available: lockfileState !== "missing",
    detail: lockfileState !== "missing" ? lockfileState : undefined,
  };

  const partial = { build, test, typecheck, lint, browserTooling, apiSchema, dependencyScanning };
  const recommendedProofPath = buildRecommendedProofPath(partial);

  return {
    timestamp: new Date().toISOString(),
    projectRootHash: createHash("sha256").update(dir).digest("hex"),
    packageManager,
    build,
    test,
    lint,
    typecheck,
    appStart,
    uiFramework,
    browserTooling,
    apiSchema,
    ciWorkflows,
    securityScanning,
    secretScanning,
    dependencyScanning,
    docsTooling,
    avoreloConfig,
    receiptHistory,
    riskyScripts,
    gitBranch: getGitBranch(dir),
    dirtyWorktree: isGitDirty(dir),
    packageVersion: (pkg?.version as string) || null,
    lockfileState,
    recommendedProofPath,
    containsRawSecret: false,
  };
}

export function renderCapabilities(caps: ProjectCapabilities): string {
  const lines: string[] = ["Capability Discovery", ""];
  const cap = (label: string, c: DetectedCapability) => {
    const status = c.available ? "detected" : "missing";
    const extra = c.command ? ` (${c.command})` : c.detail ? ` (${c.detail})` : "";
    lines.push(`  ${label}: ${status}${extra}`);
  };

  cap("Package manager", caps.packageManager);
  cap("Build", caps.build);
  cap("Tests", caps.test);
  cap("Lint", caps.lint);
  cap("Typecheck", caps.typecheck);
  cap("App start", caps.appStart);
  cap("UI framework", caps.uiFramework);
  cap("Browser tooling", caps.browserTooling);
  cap("API schema", caps.apiSchema);
  cap("CI workflows", caps.ciWorkflows);
  cap("Security scanning", caps.securityScanning);
  cap("Secret scanning", caps.secretScanning);
  cap("Dependency scanning", caps.dependencyScanning);
  cap("Docs tooling", caps.docsTooling);
  cap("Avorelo config", caps.avoreloConfig);
  cap("Receipt history", caps.receiptHistory);

  if (caps.riskyScripts.length > 0) {
    lines.push("");
    lines.push("  Risky scripts:");
    for (const r of caps.riskyScripts) {
      lines.push(`    ${r.name}: ${r.risk} (${r.command})`);
    }
  }

  lines.push("");
  lines.push(`  Git branch: ${caps.gitBranch ?? "not a git repo"}`);
  lines.push(`  Dirty worktree: ${caps.dirtyWorktree === null ? "unknown" : caps.dirtyWorktree ? "yes" : "no"}`);
  lines.push(`  Package version: ${caps.packageVersion ?? "unknown"}`);
  lines.push(`  Lockfile: ${caps.lockfileState}`);

  lines.push("");
  lines.push("  Recommended proof path:");
  for (const step of caps.recommendedProofPath) {
    lines.push(`    - ${step}`);
  }

  return lines.join("\n");
}

export function capabilitiesToJson(caps: ProjectCapabilities): Record<string, unknown> {
  return caps as unknown as Record<string, unknown>;
}
