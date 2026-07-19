import type { SessionContinuitySignal } from "./types.ts";
import { unique } from "./policy.ts";

export function buildSessionContinuitySignals(input: {
  contextBriefAvailable: boolean;
  modelRoutingAvailable: boolean;
  workflowRadarAvailable: boolean;
  workspaceMapAvailable: boolean;
  workControlsAvailable: boolean;
  receiptMetadataAvailable: boolean;
  dependencyBranchDetected: boolean;
  dependencyMergeRequired: boolean;
  changedPaths: string[];
  validationMissing: boolean;
  evidenceMissing: boolean;
  driftDetected: boolean;
  unsafePaths: string[];
}): SessionContinuitySignal[] {
  const signals: SessionContinuitySignal[] = [];
  const push = (
    type: SessionContinuitySignal["type"],
    severity: SessionContinuitySignal["severity"],
    summary: string,
    reasonCode: string,
    paths: string[] = [],
  ) => {
    signals.push({ type, severity, summary, reasonCode, paths: unique(paths) });
  };

  if (input.contextBriefAvailable) {
    push("context_brief_available", "info", "Context Efficiency brief metadata was reused.", "SESSION_CONTINUITY_CONTEXT_BRIEF_USED");
  }
  if (input.modelRoutingAvailable) {
    push("model_routing_profile_available", "info", "Model Routing Input metadata was reused.", "SESSION_CONTINUITY_MODEL_ROUTING_USED");
  }
  if (input.workflowRadarAvailable) {
    push("workflow_radar_available", "info", "Workflow Radar metadata was reused as the primary workflow signal.", "SESSION_CONTINUITY_WORKFLOW_RADAR_USED");
  }
  if (input.workspaceMapAvailable) {
    push("workspace_map_available", "info", "Workspace Map metadata is available.", "SESSION_CONTINUITY_WORKSPACE_MAP_AVAILABLE");
  }
  if (input.workControlsAvailable) {
    push("work_controls_available", "info", "Existing Work Controls metadata was reused.", "SESSION_CONTINUITY_WORK_CONTROLS_USED");
  }
  if (input.receiptMetadataAvailable) {
    push("receipt_metadata_available", "info", "Receipt or proof metadata is available for this session.", "SESSION_CONTINUITY_RECEIPT_METADATA_USED");
  }
  if (input.dependencyBranchDetected) {
    push("dependency_branch_detected", "warning", "This branch depends on another branch.", "SESSION_CONTINUITY_DEPENDENT_BRANCH");
  }
  if (input.dependencyMergeRequired) {
    push("dependency_merge_required", "warning", "A dependency branch must merge before this branch can retarget cleanly.", "SESSION_CONTINUITY_DEPENDENCY_MERGE_REQUIRED");
  }
  if (input.changedPaths.length > 0) {
    push("changed_paths_detected", "info", "Relevant changed paths were summarized from git metadata only.", "SESSION_CONTINUITY_CHANGED_PATHS_SUMMARIZED", input.changedPaths);
  }
  if (input.validationMissing) {
    push("validation_missing", "warning", "Validation metadata is still missing.", "SESSION_CONTINUITY_VALIDATION_MISSING");
  }
  if (input.evidenceMissing) {
    push("evidence_missing", "warning", "Evidence or receipt metadata is still missing.", "SESSION_CONTINUITY_EVIDENCE_MISSING");
  }
  if (input.driftDetected) {
    push("drift_detected", "warning", "Workflow drift was detected from changed-path metadata.", "SESSION_CONTINUITY_DRIFT_REPORTED");
  }
  if (input.unsafePaths.length > 0) {
    push("unsafe_path_touched", "high", "Unsafe or review-heavy paths were touched.", "SESSION_CONTINUITY_STOP_AND_REVIEW", input.unsafePaths);
  }

  push("safe_metadata_only", "info", "Session Continuity stores safe metadata only.", "SESSION_CONTINUITY_SAFE_METADATA_ONLY");
  return signals;
}
