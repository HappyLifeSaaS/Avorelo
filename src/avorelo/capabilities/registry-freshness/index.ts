// Explicit update check for the Avorelo CLI (Community Edition).
// The ONLY network-capable update operation. One bounded GET to a fixed npm URL for the literal
// package `avorelo`. No cache, no persistent state, no suppression, no automatic invocation.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";

export const REGISTRY_FRESHNESS_CONTRACT = "avorelo.registryFreshness.v1";

const FETCH_TIMEOUT_MS = 3000;
const REGISTRY_URL = "https://registry.npmjs.org/avorelo/latest";

// Exact registry boundary: one GET to the fixed npm URL. Sends only Accept; no credentials, no request
// payload; bounded timeout; redirects rejected. The destination is a module constant and cannot be
// changed by CLI input, environment, or npm config.
export const EXPLICIT_UPDATE_CHECK_URL = REGISTRY_URL;

export type FreshnessResult = {
  contract: typeof REGISTRY_FRESHNESS_CONTRACT;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  source: "registry" | "unavailable";
  message: string;
  guidanceCommand: string | null;
};

function getCurrentVersion(): string {
  try {
    const pkgPath = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "../../../../package.json");
    return JSON.parse(readFileSync(pkgPath, "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// Semantic (not lexical) comparison against the stable release; prerelease suffixes are ignored so an
// `-rc`/`-beta` local build is not treated as newer than a stable latest.
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/[-+].*$/, "").split(".").map(Number);
  const pb = b.replace(/[-+].*$/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
  }
  return 0;
}

function isValidSemver(v: unknown): v is string {
  return typeof v === "string" && /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(v);
}

export async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(REGISTRY_URL, {
      method: "GET",
      redirect: "error", // never follow a redirect to another host
      signal: controller.signal,
      headers: { "Accept": "application/json" },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json() as { version?: unknown };
    return isValidSemver(data.version) ? data.version : null; // malformed -> unable to determine
  } catch {
    return null;
  }
}

function buildResult(current: string, latest: string | null): FreshnessResult {
  if (latest === null) {
    return {
      contract: REGISTRY_FRESHNESS_CONTRACT, currentVersion: current, latestVersion: null,
      updateAvailable: false, source: "unavailable",
      message: "Could not check the npm registry. Avorelo continues normally.",
      guidanceCommand: null,
    };
  }
  const updateAvailable = compareVersions(current, latest) < 0;
  return {
    contract: REGISTRY_FRESHNESS_CONTRACT, currentVersion: current, latestVersion: latest,
    updateAvailable, source: "registry",
    message: updateAvailable ? `Avorelo ${latest} is available. You are using ${current}.` : `Avorelo ${current} is the latest version.`,
    guidanceCommand: updateAvailable ? "npm install -g avorelo@latest" : null,
  };
}

// Explicit `avorelo update check`: one bounded request, NO persistent cache/state, NO suppression
// (the user asked explicitly). Malformed/offline -> honest "unavailable", never a false "up to date".
export async function checkUpdateExplicit(opts?: { fetchOverride?: () => Promise<string | null> }): Promise<FreshnessResult> {
  const latest = await (opts?.fetchOverride ?? fetchLatestVersion)();
  return buildResult(getCurrentVersion(), latest);
}

export function renderFreshnessResult(r: FreshnessResult): string {
  const lines = [
    `  Update check: ${r.source}`,
    `    Current: ${r.currentVersion}`,
    `    Latest:  ${r.latestVersion ?? "unknown"}`,
  ];
  if (r.source === "unavailable") {
    lines.push(`    Status:  could not determine (Avorelo works normally)`);
  } else if (r.updateAvailable) {
    lines.push(`    Update:  ${r.message}`);
    lines.push(`    One-off: npx avorelo@latest <command>`);
    lines.push(`    Global:  npm install -g avorelo@latest`);
  } else {
    lines.push(`    Status:  up to date`);
  }
  return lines.join("\n");
}
