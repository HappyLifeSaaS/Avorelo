import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ModelRoutingInputProfile } from "./types.ts";

function modelRoutingDir(dir: string): string {
  return join(dir, ".avorelo", "model-routing");
}

export function latestModelRoutingInputProfilePath(dir: string): string {
  return join(modelRoutingDir(dir), "latest-profile.json");
}

export function writeModelRoutingInputProfile(dir: string, profile: ModelRoutingInputProfile): string {
  const outDir = modelRoutingDir(dir);
  mkdirSync(outDir, { recursive: true });
  const path = latestModelRoutingInputProfilePath(dir);
  writeFileSync(path, JSON.stringify(profile, null, 2));
  return path;
}

export function loadLatestModelRoutingInputProfile(dir: string): ModelRoutingInputProfile | null {
  const path = latestModelRoutingInputProfilePath(dir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ModelRoutingInputProfile;
  } catch {
    return null;
  }
}
