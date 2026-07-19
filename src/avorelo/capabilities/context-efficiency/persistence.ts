import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ContextEfficiencyBrief } from "./types.ts";

function contextEfficiencyDir(dir: string): string {
  return join(dir, ".avorelo", "context-efficiency");
}

export function latestContextEfficiencyBriefPath(dir: string): string {
  return join(contextEfficiencyDir(dir), "latest-brief.json");
}

export function writeContextEfficiencyBrief(dir: string, brief: ContextEfficiencyBrief): string {
  const outDir = contextEfficiencyDir(dir);
  mkdirSync(outDir, { recursive: true });
  const path = latestContextEfficiencyBriefPath(dir);
  writeFileSync(path, JSON.stringify(brief, null, 2));
  return path;
}

export function loadLatestContextEfficiencyBrief(dir: string): ContextEfficiencyBrief | null {
  const path = latestContextEfficiencyBriefPath(dir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ContextEfficiencyBrief;
  } catch {
    return null;
  }
}
