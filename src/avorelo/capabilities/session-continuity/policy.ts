import { execFileSync } from "node:child_process";

import type { WorkflowRadarChangedPath } from "../workflow-radar/index.ts";

import type {
  SessionContinuityChangedPath,
  SessionContinuityContinuationMode,
  SessionContinuityDecisionState,
  SessionContinuityDependency,
  SessionContinuityPathCategory,
  SessionContinuityRecommendedNextAction,
  SessionContinuityStage,
} from "./types.ts";

export function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function gitOutput(dir: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    }).trim();
  } catch {
    return null;
  }
}

function gitRefExists(dir: string, ref: string): boolean {
  try {
    execFileSync("git", ["show-ref", "--verify", "--quiet", ref], {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

function gitIsAncestor(dir: string, ancestor: string, descendant: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

function branchToTitle(branch: string): string {
  const cleaned = branch.replace(/^(origin\/)?(feature|fix|chore|docs|review|integration|planning)\//, "");
  const words = cleaned.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (words.length === 0) return "Current Workstream";
  return words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
}

export function inferWorkstreamName(branch: string, taskSummary: string): string {
  if (taskSummary && taskSummary !== "No explicit task recorded.") {
    const trimmed = taskSummary.replace(/\.$/, "").trim();
    if (trimmed.length <= 80) return trimmed;
  }
  return branchToTitle(branch);
}

export function categoryFromChangedPath(path: WorkflowRadarChangedPath): SessionContinuityPathCategory {
  if (path.classification.secretSensitive) return "secret_sensitive";
  if (path.classification.billingSensitive || path.classification.authOrDashboardSensitive) return "billing_sensitive";
  if (path.classification.productionSensitive) return "production_sensitive";
  if (path.classification.releaseOwned) return "release_owned";
  if (path.classification.runtimeArtifact) return "runtime_artifact";
  if (path.classification.generatedOutput) return "generated_output";
  if (path.tags.includes("source_of_truth")) return "safe_source";
  return "unknown";
}

export function mapChangedPath(path: WorkflowRadarChangedPath): SessionContinuityChangedPath {
  return {
    path: path.path,
    status: path.status,
    staged: path.staged,
    unstaged: path.unstaged,
    tags: path.tags,
    workTypeHints: path.workTypeHints,
    riskLevel: path.riskLevel,
    inExpectedScope: path.inExpectedScope,
    category: categoryFromChangedPath(path),
    authOrDashboardSensitive: path.classification.authOrDashboardSensitive,
  };
}

export function inferDependency(dir: string, branch: string, head: string): SessionContinuityDependency {
  const upstream = gitOutput(dir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  if (upstream && upstream !== `origin/${branch}`) {
    const dependentBranch = upstream.startsWith("origin/feature/") ? upstream.replace(/^origin\//, "") : null;
    return {
      selectedBase: upstream,
      selectedBaseSource: "upstream",
      upstreamRef: upstream,
      dependentBranchDetected: dependentBranch !== null,
      dependencyBranch: dependentBranch,
      dependencyMergeRequired: dependentBranch !== null,
      mustMergeFirst: dependentBranch ? [dependentBranch] : [],
      mustRetargetTo: dependentBranch ? "planning/architecture-approval-v1" : null,
      notes: dependentBranch
        ? [
            `This branch currently depends on ${dependentBranch}.`,
            "Do not merge this branch before its dependency branch is merged.",
            "After the dependency merges, retarget or rebase onto planning/architecture-approval-v1.",
          ]
        : [],
    };
  }

  const candidateRefs = [
    "refs/remotes/origin/feature/workflow-intelligence-radar",
    "refs/remotes/origin/planning/architecture-approval-v1",
    "refs/remotes/origin/main",
    "refs/remotes/origin/master",
  ].filter((ref) => gitRefExists(dir, ref));

  const selectedRef = candidateRefs.find((ref) => gitIsAncestor(dir, ref, head)) ?? null;
  const selectedBase = selectedRef?.replace(/^refs\/remotes\//, "") ?? null;
  const dependentBranch = selectedBase?.startsWith("origin/feature/") ? selectedBase.replace(/^origin\//, "") : null;

  return {
    selectedBase,
    selectedBaseSource: selectedBase ? "ancestor_inference" : "unavailable",
    upstreamRef: upstream,
    dependentBranchDetected: dependentBranch !== null,
    dependencyBranch: dependentBranch,
    dependencyMergeRequired: dependentBranch !== null,
    mustMergeFirst: dependentBranch ? [dependentBranch] : [],
    mustRetargetTo: dependentBranch ? "planning/architecture-approval-v1" : null,
    notes: dependentBranch
      ? [
          `This branch appears to be based on ${dependentBranch}.`,
          "Merge the dependency branch first, then retarget or rebase this branch onto planning/architecture-approval-v1.",
        ]
      : selectedBase
      ? [`Selected base inferred from git ancestry: ${selectedBase}.`]
      : ["No selected base could be inferred from upstream or local ancestor refs."],
  };
}

export function decisionStateIsReady(state: SessionContinuityDecisionState): boolean {
  return state === "READY_TO_CONTINUE" || state === "READY_WITH_WARNINGS";
}

export function inferDecisionState(input: {
  gitAvailable: boolean;
  humanReviewRequired: boolean;
  blocked: boolean;
  validationMissing: boolean;
  evidenceMissing: boolean;
  dependencyMergeRequired: boolean;
  warnings: string[];
}): SessionContinuityDecisionState {
  if (!input.gitAvailable) return "UNAVAILABLE";
  if (input.blocked) return "BLOCKED";
  if (input.humanReviewRequired) return "NEEDS_REVIEW";
  if (input.validationMissing) return "NEEDS_VALIDATION";
  if (input.evidenceMissing) return "NEEDS_EVIDENCE";
  if (input.dependencyMergeRequired || input.warnings.length > 0) return "READY_WITH_WARNINGS";
  return "READY_TO_CONTINUE";
}

export function inferContinuationMode(input: {
  decisionState: SessionContinuityDecisionState;
  dependencyMergeRequired: boolean;
  changedCount: number;
}): SessionContinuityContinuationMode {
  if (input.decisionState === "UNAVAILABLE") return "unavailable";
  if (input.decisionState === "BLOCKED") return "stop_and_review";
  if (input.decisionState === "NEEDS_REVIEW") return "ask_user_decision";
  if (input.dependencyMergeRequired) return "wait_for_dependency_merge";
  if (input.changedCount === 0) return "summarize_and_handoff";
  if (input.decisionState === "NEEDS_VALIDATION" || input.decisionState === "NEEDS_EVIDENCE") {
    return "continue_same_worktree";
  }
  return "start_new_session_same_worktree";
}

export function inferRecommendedNextAction(input: {
  decisionState: SessionContinuityDecisionState;
  dependencyMergeRequired: boolean;
  changedCount: number;
}): SessionContinuityRecommendedNextAction {
  if (input.decisionState === "UNAVAILABLE") return "unavailable";
  if (input.decisionState === "BLOCKED") return "stop_and_review";
  if (input.decisionState === "NEEDS_REVIEW") return "ask_for_decision";
  if (input.decisionState === "NEEDS_VALIDATION") return "run_validation";
  if (input.decisionState === "NEEDS_EVIDENCE") return "produce_receipt";
  if (input.dependencyMergeRequired) return "retarget_or_rebase_after_dependency_merge";
  if (input.changedCount === 0) return "summarize_for_next_session";
  return "continue_work";
}

export function inferStage(input: {
  decisionState: SessionContinuityDecisionState;
  continuationMode: SessionContinuityContinuationMode;
  changedCount: number;
}): SessionContinuityStage {
  if (input.decisionState === "UNAVAILABLE") return "unavailable";
  if (input.decisionState === "BLOCKED") return "blocked";
  if (input.decisionState === "NEEDS_REVIEW") return "review_required";
  if (input.decisionState === "NEEDS_VALIDATION") return "validation_pending";
  if (input.decisionState === "NEEDS_EVIDENCE") return "evidence_pending";
  if (input.continuationMode === "wait_for_dependency_merge") return "waiting_on_dependency";
  if (input.changedCount === 0) return "handoff_ready";
  return "implementation_in_progress";
}

export function safeToContinue(decisionState: SessionContinuityDecisionState): boolean {
  return decisionState !== "BLOCKED" && decisionState !== "NEEDS_REVIEW" && decisionState !== "UNAVAILABLE";
}
