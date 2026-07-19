import { execFileSync } from "node:child_process";

import { classifyPathForContextEfficiency } from "../context-efficiency/workspace-map-compat.ts";

import {
  isAuthOrDashboardSensitivePath,
  isProductionSensitivePath,
  pathIsInExpectedScope,
  unique,
} from "./policy.ts";
import type {
  WorkflowRadarChangedPath,
  WorkflowRadarChangedPathStatus,
  WorkflowRadarSignal,
} from "./types.ts";

function mapStatus(code: string): WorkflowRadarChangedPathStatus {
  switch (code) {
    case "M": return "modified";
    case "A": return "added";
    case "D": return "deleted";
    case "R": return "renamed";
    case "C": return "copied";
    case "T": return "type_changed";
    default: return "unknown";
  }
}

type ParsedGitStatus = {
  path: string;
  status: WorkflowRadarChangedPathStatus;
  staged: boolean;
  unstaged: boolean;
};

function parseGitStatusLine(line: string): ParsedGitStatus | null {
  if (!line.trim()) return null;
  if (line.startsWith("?? ")) {
    return {
      path: line.slice(3).trim(),
      status: "untracked",
      staged: false,
      unstaged: true,
    };
  }

  const stagedCode = line[0] ?? " ";
  const unstagedCode = line[1] ?? " ";
  const rawPath = line.slice(3).trim();
  const path = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1)?.trim() ?? rawPath : rawPath;
  const status = mapStatus(stagedCode !== " " ? stagedCode : unstagedCode);

  return {
    path,
    status,
    staged: stagedCode !== " ",
    unstaged: unstagedCode !== " ",
  };
}

export function readWorkflowRadarChangedPaths(dir: string, expectedScopePaths: string[]): {
  available: boolean;
  items: WorkflowRadarChangedPath[];
} {
  try {
    const output = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const items = output
      .split(/\r?\n/)
      .map((line) => parseGitStatusLine(line))
      .filter((item): item is ParsedGitStatus => item !== null)
      .map((item) => {
        const classification = classifyPathForContextEfficiency(dir, item.path);
        const authOrDashboardSensitive = classification.dashboardSurface || isAuthOrDashboardSensitivePath(classification.normalizedPath);
        const productionSensitive = classification.releaseOwned || isProductionSensitivePath(classification.normalizedPath);
        const inExpectedScope = expectedScopePaths.length > 0
          ? pathIsInExpectedScope(classification.normalizedPath || item.path, expectedScopePaths)
          : false;
        const tags = unique([
          ...classification.tags,
          ...(authOrDashboardSensitive ? ["auth_or_dashboard_sensitive"] : []),
          ...(productionSensitive ? ["production_sensitive"] : []),
          ...(inExpectedScope ? ["expected_scope"] : ["unexpected_scope"]),
        ]);

        return {
          path: classification.normalizedPath || item.path,
          status: item.status,
          staged: item.staged,
          unstaged: item.unstaged,
          tags,
          workTypeHints: classification.workTypeHints,
          riskLevel: classification.riskLevel,
          inExpectedScope,
          classification: {
            generatedOutput: classification.generatedOutput,
            runtimeArtifact: classification.runtimeArtifact,
            releaseOwned: classification.releaseOwned,
            productionSensitive,
            billingSensitive: classification.billingSensitive,
            secretSensitive: classification.secretSensitive,
            authOrDashboardSensitive,
          },
        } satisfies WorkflowRadarChangedPath;
      });

    return { available: true, items };
  } catch {
    return { available: false, items: [] };
  }
}

export function buildWorkflowRadarSignals(input: {
  contextBriefAvailable: boolean;
  modelRoutingProfileAvailable: boolean;
  workspaceMapAvailable: boolean;
  expectedScopeAvailable: boolean;
  changedPaths: WorkflowRadarChangedPath[];
  validationMissing: boolean;
  evidenceMissing: boolean;
  workModeMismatch: boolean;
  humanReviewRequired: boolean;
}): WorkflowRadarSignal[] {
  const signals: WorkflowRadarSignal[] = [];
  const push = (
    type: WorkflowRadarSignal["type"],
    severity: WorkflowRadarSignal["severity"],
    summary: string,
    reasonCode: string,
    paths: string[] = [],
  ) => {
    signals.push({ type, severity, summary, reasonCode, paths: unique(paths) });
  };

  const generatedPaths = input.changedPaths.filter((item) => item.classification.generatedOutput).map((item) => item.path);
  const runtimePaths = input.changedPaths.filter((item) => item.classification.runtimeArtifact).map((item) => item.path);
  const releasePaths = input.changedPaths.filter((item) => item.classification.releaseOwned).map((item) => item.path);
  const productionPaths = input.changedPaths.filter((item) => item.classification.productionSensitive).map((item) => item.path);
  const billingPaths = input.changedPaths.filter((item) => item.classification.billingSensitive).map((item) => item.path);
  const secretPaths = input.changedPaths.filter((item) => item.classification.secretSensitive).map((item) => item.path);
  const reviewPaths = input.changedPaths.filter((item) => item.classification.authOrDashboardSensitive).map((item) => item.path);
  const unexpectedPaths = input.changedPaths.filter((item) => !item.inExpectedScope).map((item) => item.path);

  if (input.contextBriefAvailable) {
    push("context_brief_available", "info", "Context Efficiency brief was reused.", "WORKFLOW_RADAR_CONTEXT_BRIEF_USED");
  }
  if (input.modelRoutingProfileAvailable) {
    push("model_routing_profile_available", "info", "Model Routing Input profile was reused.", "WORKFLOW_RADAR_MODEL_ROUTING_PROFILE_USED");
  }
  if (input.workspaceMapAvailable) {
    push("workspace_map_available", "info", "Workspace Map metadata is available.", "WORKFLOW_RADAR_WORKSPACE_MAP_AVAILABLE");
  }
  if (input.expectedScopeAvailable) {
    push("expected_scope_available", "info", "Expected scope metadata is available.", "WORKFLOW_RADAR_EXPECTED_SCOPE_AVAILABLE");
  }
  if (input.changedPaths.length > 0) {
    push(
      "changed_paths_detected",
      "info",
      `Reviewed ${input.changedPaths.length} changed path(s) from git metadata only.`,
      "WORKFLOW_RADAR_CHANGED_PATHS_REVIEWED",
      input.changedPaths.map((item) => item.path),
    );
  }
  if (unexpectedPaths.length > 0 && input.expectedScopeAvailable) {
    push("unexpected_path_touched", "warning", "Changed paths drifted outside the expected scope.", "WORKFLOW_RADAR_UNEXPECTED_PATH_TOUCH", unexpectedPaths);
  }
  if (generatedPaths.length > 0) {
    push("generated_output_touched", "warning", "Generated output paths were touched.", "WORKFLOW_RADAR_GENERATED_OUTPUT_TOUCH", generatedPaths);
  }
  if (runtimePaths.length > 0) {
    push("runtime_artifact_touched", "warning", "Local runtime artifact paths were touched.", "WORKFLOW_RADAR_RUNTIME_ARTIFACT_TOUCH", runtimePaths);
  }
  if (releasePaths.length > 0) {
    push("release_owned_path_touched", "critical", "Release-owned paths were touched.", "WORKFLOW_RADAR_RELEASE_SCOPE_BLOCKED", releasePaths);
  }
  if (productionPaths.length > 0) {
    push("production_sensitive_path_touched", "critical", "Production-sensitive paths were touched.", "WORKFLOW_RADAR_PRODUCTION_SCOPE_BLOCKED", productionPaths);
  }
  if (billingPaths.length > 0) {
    push("billing_sensitive_path_touched", "high", "Billing or entitlement paths were touched.", "WORKFLOW_RADAR_BILLING_SCOPE_REVIEW", billingPaths);
  }
  if (secretPaths.length > 0) {
    push("secret_sensitive_path_touched", "critical", "Secret-sensitive paths were touched.", "WORKFLOW_RADAR_SECRET_SCOPE_REVIEW", secretPaths);
  }
  if (input.validationMissing) {
    push("validation_missing", "warning", "Required validation evidence is still missing.", "WORKFLOW_RADAR_VALIDATION_MISSING");
  }
  if (input.evidenceMissing) {
    push("evidence_missing", "warning", "Expected receipt or evidence metadata is still missing.", "WORKFLOW_RADAR_EVIDENCE_MISSING");
  }
  if (input.workModeMismatch) {
    push("work_mode_mismatch", "warning", "Touched paths require a safer work mode than the planned profile.", "WORKFLOW_RADAR_WORK_MODE_MISMATCH");
  }
  if (input.humanReviewRequired) {
    push(
      "human_review_required",
      "high",
      "Human review is required before trusting this work session.",
      "WORKFLOW_RADAR_HUMAN_REVIEW_REQUIRED",
      reviewPaths,
    );
  }

  push("safe_metadata_only", "info", "Workflow Radar stores safe metadata only.", "WORKFLOW_RADAR_SAFE_METADATA_ONLY");

  return signals;
}
