import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { BrowserQaArtifact } from "./types.ts";

export function browserQaRoot(dir: string): string {
  return join(dir, ".avorelo", "browser-qa");
}

export function browserQaLatestPath(dir: string): string {
  return join(browserQaRoot(dir), "latest.json");
}

export function browserQaScreenshotDir(dir: string): string {
  return join(browserQaRoot(dir), "screenshots");
}

export function writeBrowserQaLatest(dir: string, artifact: BrowserQaArtifact): string {
  const root = browserQaRoot(dir);
  mkdirSync(root, { recursive: true });
  const path = browserQaLatestPath(dir);
  writeFileSync(path, JSON.stringify(artifact, null, 2));
  return path;
}

export function readBrowserQaLatest(dir: string): BrowserQaArtifact | null {
  const path = browserQaLatestPath(dir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as BrowserQaArtifact;
  } catch {
    return null;
  }
}
