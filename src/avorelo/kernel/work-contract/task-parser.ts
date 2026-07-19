// Avorelo task parser. Converts natural language task descriptions into WorkContract fields.
// Deterministic only — no LLM. Uses heuristic keyword/path extraction.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createWorkContract } from "./index.ts";
import type { WorkContract } from "../../shared/schemas/index.ts";

type TaskType = "bug_fix" | "feature" | "refactor" | "testing" | "deployment" | "docs" | "security" | "general";

const TASK_KEYWORDS: Record<TaskType, RegExp[]> = {
  bug_fix: [/\bfix\b/i, /\bbug\b/i, /\bpatch\b/i, /\bregression\b/i, /\bbroken\b/i, /\bcrash\b/i],
  feature: [/\badd\b/i, /\bimplement\b/i, /\bbuild\b/i, /\bcreate\b/i, /\bnew\b/i],
  refactor: [/\brefactor\b/i, /\bclean\s?up\b/i, /\brewrite\b/i, /\breorganize\b/i, /\brename\b/i],
  testing: [/\btests?\b/i, /\bspec\b/i, /\bcoverage\b/i, /\be2e\b/i],
  deployment: [/\bdeploy\b/i, /\brelease\b/i, /\bpublish\b/i, /\bship\b/i, /\bci\b/i, /\bcd\b/i],
  docs: [/\bdoc\b/i, /\breadme\b/i, /\bchangelog\b/i, /\bcomment\b/i],
  security: [/\bsecur/i, /\bauth\b/i, /\bpermission/i, /\bvulnerab/i, /\bcve\b/i],
  general: [],
};

function classifyTask(task: string): TaskType {
  for (const [type, patterns] of Object.entries(TASK_KEYWORDS)) {
    if (type === "general") continue;
    if (patterns.some(p => p.test(task))) return type as TaskType;
  }
  return "general";
}

function extractPaths(task: string): string[] {
  const paths: string[] = [];
  const pathRegex = /(?:^|\s)((?:src|lib|test|tests|app|pages|components|hooks|utils|scripts|docs|config|\.github)\/[\w\-./]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = pathRegex.exec(task)) !== null) {
    paths.push(m[1].replace(/[.,;:!?]+$/, ""));
  }
  const fileRegex = /\b[\w\-]+\.(?:ts|tsx|js|jsx|json|md|yml|yaml|toml|css|html)\b/gi;
  while ((m = fileRegex.exec(task)) !== null) {
    paths.push(m[0]);
  }
  return [...new Set(paths)];
}

function inferAllowedPaths(taskType: TaskType, extractedPaths: string[]): string[] {
  if (extractedPaths.length > 0) {
    return extractedPaths.map(p => p.includes("/") ? p.replace(/\/[^/]+$/, "/**") : "**");
  }
  switch (taskType) {
    case "testing": return ["tests/**", "src/**/*.test.*", "e2e-tests/**"];
    case "docs": return ["docs/**", "*.md", "README.md"];
    case "deployment": return [".github/**", "Dockerfile", "*.yml", "*.yaml"];
    default: return [];
  }
}

function inferSuccessCriteria(taskType: TaskType, dir: string): string[] {
  const criteria: string[] = [];

  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    if (pkg.scripts?.test) criteria.push("Tests pass");
    if (pkg.scripts?.typecheck) criteria.push("Type check passes");
    if (pkg.scripts?.lint) criteria.push("Lint passes");
  } catch {}

  switch (taskType) {
    case "bug_fix": criteria.push("Bug is fixed and verified"); break;
    case "feature": criteria.push("Feature works as described"); break;
    case "testing": criteria.push("Tests cover the target behavior"); break;
    case "deployment": criteria.push("Deploy succeeds"); break;
    case "security": criteria.push("Vulnerability is resolved"); break;
  }
  return criteria;
}

function inferStopConditions(taskType: TaskType): string[] {
  const conditions = ["Objective is met"];
  if (taskType === "deployment") conditions.push("Deploy confirmed live");
  if (taskType === "security") conditions.push("Security review approved");
  return conditions;
}

export function parseTaskToContract(task: string, dir: string): WorkContract {
  const taskType = classifyTask(task);
  const extractedPaths = extractPaths(task);
  const allowedPaths = inferAllowedPaths(taskType, extractedPaths);
  const successCriteria = inferSuccessCriteria(taskType, dir);
  const stopConditions = inferStopConditions(taskType);

  return createWorkContract({
    contractId: `task_${Date.now().toString(36)}`,
    objective: task,
    allowedPaths,
    successCriteria,
    stopConditions,
    planTier: "Free",
  });
}

export { classifyTask, extractPaths };
