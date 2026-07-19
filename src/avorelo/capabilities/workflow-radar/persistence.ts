import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { WorkflowRadarAssessment } from "./types.ts";

function workflowRadarDir(dir: string): string {
  return join(dir, ".avorelo", "workflow-radar");
}

export function latestWorkflowRadarPath(dir: string): string {
  return join(workflowRadarDir(dir), "latest.json");
}

export function writeWorkflowRadarAssessment(dir: string, assessment: WorkflowRadarAssessment): string {
  if (assessment.contract !== "avorelo.workflowRadar.v1") {
    throw new Error("workflow_radar_invalid_contract");
  }
  const outDir = workflowRadarDir(dir);
  mkdirSync(outDir, { recursive: true });
  const path = latestWorkflowRadarPath(dir);
  writeFileSync(path, JSON.stringify(assessment, null, 2));
  return path;
}

export function loadLatestWorkflowRadarAssessment(dir: string): WorkflowRadarAssessment | null {
  const path = latestWorkflowRadarPath(dir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as WorkflowRadarAssessment;
  } catch {
    return null;
  }
}
