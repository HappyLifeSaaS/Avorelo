import type { ProjectCapabilities } from "../capability-discovery/index.ts";
import type { WorkType } from "../../kernel/proof-contract/index.ts";

export type WorkMode =
  | "quick_fix"
  | "feature_build"
  | "security_review"
  | "dependency_update"
  | "docs_update"
  | "release_prep"
  | "exploration";

export interface GuidedMode {
  mode: WorkMode;
  label: string;
  description: string;
  suggestedWorkType: WorkType;
  steps: string[];
  safeCommands: string[];
  blockedCommands: string[];
  proofPath: string[];
}

const MODES: Record<WorkMode, Omit<GuidedMode, "safeCommands" | "proofPath">> = {
  quick_fix: {
    mode: "quick_fix",
    label: "Quick Fix",
    description: "Small code change — fix a bug or tweak logic",
    suggestedWorkType: "quick_code_fix",
    steps: [
      "Identify the issue",
      "Make the minimal fix",
      "Run tests",
      "Run build",
      "Run artifact guard",
      "Generate verification receipt",
    ],
    blockedCommands: ["npm publish", "deploy", "git push --force"],
  },
  feature_build: {
    mode: "feature_build",
    label: "Feature Build",
    description: "Build a new feature or extend existing functionality",
    suggestedWorkType: "ui_product_surface",
    steps: [
      "Understand the requirement",
      "Implement the feature",
      "Run build and tests",
      "Check product surface for placeholders",
      "Run artifact guard",
      "Generate verification receipt",
    ],
    blockedCommands: ["npm publish", "deploy", "git push --force"],
  },
  security_review: {
    mode: "security_review",
    label: "Security Review",
    description: "Change involving auth, secrets, tokens, or credentials",
    suggestedWorkType: "security_sensitive",
    steps: [
      "Identify security-sensitive files",
      "Make changes with minimal surface area",
      "Run secret scan on changed files",
      "Run npm audit",
      "Run artifact guard",
      "Verify no raw secrets in output",
      "Generate verification receipt",
    ],
    blockedCommands: ["npm publish", "deploy", "git push --force", "commit .env"],
  },
  dependency_update: {
    mode: "dependency_update",
    label: "Dependency Update",
    description: "Update packages or modify dependencies",
    suggestedWorkType: "dependency_package",
    steps: [
      "Review package changes",
      "Run npm audit",
      "Run build",
      "Run tests",
      "Run artifact guard",
      "Generate verification receipt",
    ],
    blockedCommands: ["npm publish", "deploy"],
  },
  docs_update: {
    mode: "docs_update",
    label: "Documentation Update",
    description: "Update docs, README, or marketing copy",
    suggestedWorkType: "docs_marketing",
    steps: [
      "Edit documentation",
      "Check claims match implemented capabilities",
      "Run product surface check",
      "Run artifact guard",
      "Generate verification receipt",
    ],
    blockedCommands: ["npm publish", "deploy"],
  },
  release_prep: {
    mode: "release_prep",
    label: "Release Preparation",
    description: "Prepare for release — CI, deploy config, version bumps",
    suggestedWorkType: "release_readiness",
    steps: [
      "Verify clean worktree",
      "Run full test suite",
      "Run build",
      "Run artifact guard",
      "Check product surface",
      "Run npm audit",
      "Generate verification receipt",
      "Request owner approval before publish/deploy",
    ],
    blockedCommands: ["npm publish", "deploy --prod", "git push --force"],
  },
  exploration: {
    mode: "exploration",
    label: "Exploration",
    description: "Read-only investigation — no file changes expected",
    suggestedWorkType: "unknown_mixed",
    steps: [
      "Read and understand code",
      "Run capabilities discovery",
      "Check current activation status",
      "Report findings",
    ],
    blockedCommands: ["npm publish", "deploy", "git push --force", "rm -rf"],
  },
};

export function inferWorkMode(
  changedFiles: string[],
  capabilities: ProjectCapabilities,
  workType?: WorkType,
): GuidedMode {
  const mode = workType ? workTypeToMode(workType) : inferModeFromFiles(changedFiles);
  return buildGuidedMode(mode, capabilities);
}

function workTypeToMode(workType: WorkType): WorkMode {
  const map: Record<WorkType, WorkMode> = {
    quick_code_fix: "quick_fix",
    ui_product_surface: "feature_build",
    api_backend: "feature_build",
    security_sensitive: "security_review",
    dependency_package: "dependency_update",
    docs_marketing: "docs_update",
    release_readiness: "release_prep",
    activation_onboarding: "quick_fix",
    dashboard_receipt: "feature_build",
    model_routing_control: "feature_build",
    unknown_mixed: "exploration",
  };
  return map[workType];
}

function inferModeFromFiles(changedFiles: string[]): WorkMode {
  if (changedFiles.length === 0) return "exploration";
  if (changedFiles.some(f => /auth|secret|token|credential|\.env/i.test(f))) return "security_review";
  if (changedFiles.some(f => /package\.json|package-lock/i.test(f))) return "dependency_update";
  if (changedFiles.every(f => /\.md$/i.test(f))) return "docs_update";
  if (changedFiles.some(f => /deploy|release|\.github\/workflows/i.test(f))) return "release_prep";
  if (changedFiles.length <= 3) return "quick_fix";
  return "feature_build";
}

function buildGuidedMode(mode: WorkMode, caps: ProjectCapabilities): GuidedMode {
  const base = MODES[mode];
  const safeCommands: string[] = [];
  const proofPath: string[] = [];

  if (caps.build.command) safeCommands.push(caps.build.command);
  if (caps.test.command) safeCommands.push(caps.test.command);
  if (caps.typecheck?.command) safeCommands.push(caps.typecheck.command);
  if (caps.lint?.command) safeCommands.push(caps.lint.command);
  safeCommands.push("npm audit", "npx avorelo guard scan", "npx avorelo capabilities", "npx avorelo prove");

  proofPath.push(...caps.recommendedProofPath);

  return { ...base, safeCommands, proofPath };
}

export function renderGuidedMode(mode: GuidedMode): string {
  const lines = [
    `Work Mode: ${mode.label}`,
    `${mode.description}`,
    "",
    "Steps:",
  ];
  for (let i = 0; i < mode.steps.length; i++) {
    lines.push(`  ${i + 1}. ${mode.steps[i]}`);
  }
  lines.push("");
  lines.push("Safe commands:");
  for (const cmd of mode.safeCommands) {
    lines.push(`  - ${cmd}`);
  }
  lines.push("");
  lines.push("Blocked commands:");
  for (const cmd of mode.blockedCommands) {
    lines.push(`  - ${cmd}`);
  }
  lines.push("");
  lines.push("Proof path:");
  for (const step of mode.proofPath) {
    lines.push(`  - ${step}`);
  }
  return lines.join("\n");
}

export function getAllModes(): WorkMode[] {
  return Object.keys(MODES) as WorkMode[];
}
