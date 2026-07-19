import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { SessionContinuityHandoff } from "./types.ts";

function sessionContinuityDir(dir: string): string {
  return join(dir, ".avorelo", "session-continuity");
}

export function latestSessionContinuityPath(dir: string): string {
  return join(sessionContinuityDir(dir), "latest-handoff.json");
}

export function writeSessionContinuityHandoff(dir: string, handoff: SessionContinuityHandoff): string {
  const outDir = sessionContinuityDir(dir);
  mkdirSync(outDir, { recursive: true });
  const path = latestSessionContinuityPath(dir);
  writeFileSync(path, JSON.stringify(handoff, null, 2));
  return path;
}

export function loadLatestSessionContinuityHandoff(dir: string): SessionContinuityHandoff | null {
  const path = latestSessionContinuityPath(dir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SessionContinuityHandoff;
  } catch {
    return null;
  }
}
