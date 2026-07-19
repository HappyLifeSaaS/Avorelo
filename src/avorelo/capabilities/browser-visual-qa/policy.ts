import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import type { BrowserQaRouteInput, BrowserQaScreenshotPolicy } from "./types.ts";

export const DEFAULT_BROWSER_QA_ROUTES: BrowserQaRouteInput[] = [
  { route: "/", requiredUiRef: "primary_cta" },
  { route: "/activate", requiredUiRef: "primary_cta" },
  { route: "/pricing", requiredUiRef: "primary_cta" },
  { route: "/contact", requiredUiRef: "contact_form" },
  { route: "/dashboard", requiredUiRef: "dashboard_shell" },
];

const SAFE_STAGING_HOST_PATTERNS = [
  /localhost/i,
  /^127\.0\.0\.1$/,
  /\.local$/i,
  /preview/i,
  /staging/i,
  /\.vercel\.app$/i,
  /\.netlify\.app$/i,
  /\.railway\.app$/i,
];

const PRODUCTION_HOST_PATTERNS = [
  /^avorelo\.com$/i,
  /^www\.avorelo\.com$/i,
  /^app\.avorelo\.com$/i,
];

export function normalizeRoutes(routes?: BrowserQaRouteInput[]): BrowserQaRouteInput[] {
  const selected = routes?.length ? routes : DEFAULT_BROWSER_QA_ROUTES;
  return selected.map((item) => ({
    route: normalizeRoute(item.route),
    requiredUiRef: item.requiredUiRef ?? null,
    requiredText: item.requiredText ?? null,
  }));
}

export function normalizeRoute(route: string): string {
  if (!route || route === ".") return "/";
  const trimmed = route.trim();
  if (!trimmed || trimmed === "/") return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function resolveTargetInput(dir: string, target?: string): {
  targetInput: string;
  targetKind: "directory" | "url";
  localPath: string | null;
} {
  const targetInput = (target ?? resolve(dir, "src", "avorelo", "surfaces", "public-web", "static")).trim();
  const maybePath = isAbsolute(targetInput) ? targetInput : resolve(dir, targetInput);
  if (existsSync(maybePath)) {
    return { targetInput, targetKind: "directory", localPath: maybePath };
  }
  return { targetInput, targetKind: "url", localPath: null };
}

export function sanitizeTargetLabel(targetKind: "directory" | "url", targetInput: string): string {
  if (targetKind === "directory") return "local_static_preview";
  try {
    const url = new URL(targetInput);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return "localhost";
    return url.hostname.toLowerCase();
  } catch {
    return "unknown";
  }
}

export function parseBooleanFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  return defaultValue;
}

export function normalizeScreenshotPolicy(
  requested: BrowserQaScreenshotPolicy | undefined,
  args: { safeCapture?: boolean; metadataOnly?: boolean; noScreenshots?: boolean },
): BrowserQaScreenshotPolicy {
  if (args.noScreenshots) return "blocked";
  if (args.metadataOnly) return "metadata_only";
  if (args.safeCapture) return "safe_capture";
  return requested ?? "metadata_only";
}

export function evaluateTargetSafety(targetInput: string, opts: {
  allowLocalhostOnly: boolean;
  staging: boolean;
}): { allowed: boolean; reasonCode: string | null; safeSummary: string | null } {
  let url: URL;
  try {
    url = new URL(targetInput);
  } catch {
    return { allowed: false, reasonCode: "BROWSER_QA_ROUTE_UNREACHABLE", safeSummary: "Target is not a valid URL." };
  }

  const hostname = url.hostname.toLowerCase();
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
  if (opts.allowLocalhostOnly && !isLocalhost) {
    return {
      allowed: false,
      reasonCode: "BROWSER_QA_UNSAFE_PRODUCTION_TARGET",
      safeSummary: "Browser QA is restricted to localhost targets unless a safe staging target is explicitly allowed.",
    };
  }

  if (PRODUCTION_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) {
    return {
      allowed: false,
      reasonCode: "BROWSER_QA_UNSAFE_PRODUCTION_TARGET",
      safeSummary: "Production-looking hosts are blocked in this feature workstream.",
    };
  }

  if (!isLocalhost && opts.staging && SAFE_STAGING_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) {
    return { allowed: true, reasonCode: null, safeSummary: null };
  }

  if (!isLocalhost && !opts.allowLocalhostOnly) {
    if (SAFE_STAGING_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) return { allowed: true, reasonCode: null, safeSummary: null };
    return {
      allowed: false,
      reasonCode: "BROWSER_QA_UNSAFE_PRODUCTION_TARGET",
      safeSummary: "Only localhost or clearly staging-like targets are allowed.",
    };
  }

  return { allowed: true, reasonCode: null, safeSummary: null };
}
