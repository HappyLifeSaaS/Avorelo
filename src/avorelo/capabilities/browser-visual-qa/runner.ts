import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { serve } from "../../surfaces/preview-server/index.ts";
import {
  evaluateTargetSafety,
  normalizeRoute,
  normalizeRoutes,
  resolveTargetInput,
  sanitizeTargetLabel,
} from "./policy.ts";
import { browserQaScreenshotDir, writeBrowserQaLatest } from "./persistence.ts";
import type {
  BrowserQaArtifact,
  BrowserQaDecision,
  BrowserQaFinding,
  BrowserQaFindingSeverity,
  BrowserQaRouteInput,
  BrowserQaRouteSummary,
  BrowserQaRunOptions,
  BrowserQaScreenshotPolicy,
} from "./types.ts";

type BrowserConsoleEntry = { type: "error" | "warning"; text: string };
type BrowserInspectionResult = {
  ok: boolean;
  httpStatus: number | null;
  hasBody: boolean;
  hasFavicon: boolean;
  primaryCtaCount: number;
  contactFormPresent: boolean;
  dashboardShellPresent: boolean;
  brokenLinkCount: number;
  disabledSubmitCount: number;
  overflowDetected: boolean;
  placeholderMetricDetected: boolean;
  privateDataDetected: boolean;
  authRequiredDetected: boolean;
  consoleEntries: BrowserConsoleEntry[];
  screenshot: {
    capturePng?: (path: string) => Promise<void>;
    writePlaceholder?: (path: string, variant: "safe_capture" | "redacted") => Promise<void>;
  };
};

type BrowserInspector = {
  inspect(routeUrl: string, expectation: BrowserQaRouteInput, timeoutMs: number): Promise<BrowserInspectionResult>;
  close(): Promise<void>;
};

const DEFAULT_TIMEOUT_MS = 10000;

function hasFakeBrowserQaMode(): boolean {
  return process.env.AVORELO_FAKE_BROWSER_QA === "1";
}

function safeEvidenceRef(route: string, suffix: string): string {
  return `browser-qa:route:${route}:${suffix}`;
}

function finding(
  route: string,
  severity: BrowserQaFindingSeverity,
  reasonCode: string,
  safeSummary: string,
  recommendedNextAction: string,
  extras?: Partial<BrowserQaFinding>,
): BrowserQaFinding {
  return {
    route,
    selector: extras?.selector ?? null,
    severity,
    reasonCode,
    safeSummary,
    evidenceRef: extras?.evidenceRef ?? safeEvidenceRef(route, reasonCode.toLowerCase()),
    screenshotPolicyResult: extras?.screenshotPolicyResult ?? "metadata_only",
    consoleCategory: extras?.consoleCategory ?? null,
    recommendedNextAction,
  };
}

function artifactBase(target: string, screenshotPolicy: BrowserQaScreenshotPolicy): Omit<BrowserQaArtifact, "generatedAt" | "decision" | "riskLevel" | "routesChecked" | "failedRoutes" | "warningCount" | "screenshotsPersisted" | "unsafeCapturesBlocked" | "topFindings" | "findings" | "routeSummaries" | "nextSafeAction"> {
  return {
    contract: "avorelo.browserVisualQa.v1",
    schemaVersion: 1,
    target,
    screenshotPolicy,
    containsRawScreenshot: false,
    containsRawHtml: false,
    containsRawDom: false,
    containsRawConsoleLog: false,
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawDiff: false,
    containsRawSecret: false,
    containsRawEnvValue: false,
    containsRawTerminalOutput: false,
    contentStorageClass: "safe_metadata_only",
  };
}

async function createPlaywrightInspector(): Promise<BrowserInspector | null> {
  let playwright: any;
  try {
    playwright = await import("playwright");
  } catch {
    return null;
  }

  const browser = await playwright.chromium.launch({ headless: true });
  return {
    async inspect(routeUrl: string, expectation: BrowserQaRouteInput, timeoutMs: number): Promise<BrowserInspectionResult> {
      const page = await browser.newPage();
      const consoleEntries: BrowserConsoleEntry[] = [];
      page.on("console", (message: { type: () => string; text: () => string }) => {
        const type = message.type();
        if (type === "error" || type === "warning") {
          consoleEntries.push({ type, text: message.text().slice(0, 200) });
        }
      });
      try {
        const response = await page.goto(routeUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        const snapshot = await page.evaluate((exp) => {
          const bodyText = document.body?.innerText ?? "";
          const normalized = bodyText.toLowerCase();
          const hrefs = Array.from(document.querySelectorAll("a[href]"))
            .map((node) => node.getAttribute("href") ?? "")
            .filter(Boolean);
          const submitButtons = Array.from(document.querySelectorAll("button, input[type='submit']"))
            .filter((node) => {
              if ((node as HTMLInputElement).type === "submit") return true;
              return node instanceof HTMLButtonElement && (node.type === "submit" || node.getAttribute("data-role") === "submit");
            });
          const ctaCandidates = Array.from(document.querySelectorAll("a, button"))
            .map((node) => (node.textContent ?? "").trim())
            .filter((text) => /(activate|get started|start|sign up|contact|book demo|open dashboard)/i.test(text));
          const hasDashboardShell = !!document.querySelector("[data-testid='dashboard-shell'], .db-shell, .dashboard-shell");
          const overflowDetected =
            document.documentElement.scrollWidth > window.innerWidth + 24 ||
            Array.from(document.querySelectorAll("body *")).some((node) => (node as HTMLElement).scrollWidth > (node as HTMLElement).clientWidth + 80);
          return {
            hasBody: Boolean(document.body && bodyText.trim().length > 0),
            hasFavicon: document.querySelector("link[rel*='icon']") !== null,
            primaryCtaCount: ctaCandidates.length,
            contactFormPresent: document.querySelector("form") !== null || document.querySelector("a[href^='mailto:']") !== null,
            dashboardShellPresent: hasDashboardShell || /dashboard/.test(normalized) || /dashboard/.test(document.title.toLowerCase()),
            brokenLinkCount: hrefs.filter((href) => href === "" || href.startsWith("javascript:") || href === "#").length,
            disabledSubmitCount: submitButtons.filter((node) => (node as HTMLButtonElement).disabled === true).length,
            overflowDetected,
            placeholderMetricDetected: /placeholder metric|sample metric|demo metric|todo metric/.test(normalized),
            privateDataDetected: /@|customer|account|invoice|token|password/.test(normalized),
            authRequiredDetected: /sign in|log in|authentication required|access denied/.test(normalized),
            expectedTextFound: exp.requiredText ? normalized.includes(String(exp.requiredText).toLowerCase()) : true,
          };
        }, expectation);
        return {
          ok: true,
          httpStatus: response?.status() ?? null,
          hasBody: snapshot.hasBody && snapshot.expectedTextFound,
          hasFavicon: snapshot.hasFavicon,
          primaryCtaCount: snapshot.primaryCtaCount,
          contactFormPresent: snapshot.contactFormPresent,
          dashboardShellPresent: snapshot.dashboardShellPresent,
          brokenLinkCount: snapshot.brokenLinkCount,
          disabledSubmitCount: snapshot.disabledSubmitCount,
          overflowDetected: snapshot.overflowDetected,
          placeholderMetricDetected: snapshot.placeholderMetricDetected,
          privateDataDetected: snapshot.privateDataDetected,
          authRequiredDetected: snapshot.authRequiredDetected,
          consoleEntries,
          screenshot: {
            capturePng: async (path: string) => {
              await page.screenshot({ path, fullPage: true });
            },
            writePlaceholder: async (path: string, variant: "safe_capture" | "redacted") => {
              writeFileSync(path, `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="100%" height="100%" fill="${variant === "redacted" ? "#f4e7d4" : "#e8f2eb"}"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="28">${variant === "redacted" ? "Browser QA redacted capture" : "Browser QA safe capture placeholder"}</text></svg>`);
            },
          },
        };
      } finally {
        await page.close();
      }
    },
    async close(): Promise<void> {
      await browser.close();
    },
  };
}

function readMetaFlag(html: string, name: string): string | null {
  const pattern = new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, "i");
  const match = html.match(pattern);
  return match?.[1] ?? null;
}

function textContentFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function createFakeInspector(): Promise<BrowserInspector> {
  return {
    async inspect(routeUrl: string, expectation: BrowserQaRouteInput): Promise<BrowserInspectionResult> {
      const response = await fetch(routeUrl);
      const html = await response.text();
      const text = textContentFromHtml(html).toLowerCase();
      const hrefMatches = Array.from(html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)).map((match) => match[1] ?? "");
      const buttonMatches = Array.from(html.matchAll(/<(a|button)[^>]*>([\s\S]*?)<\/(a|button)>/gi)).map((match) => textContentFromHtml(match[0]));
      const formMatches = Array.from(html.matchAll(/<form[\s\S]*?<\/form>/gi)).map((match) => match[0]);
      const brokenLocalLinks = hrefMatches.filter((href) => href === "" || href.startsWith("javascript:") || href === "#").length;
      const disabledSubmitCount = formMatches.filter((markup) => /disabled/i.test(markup) && /submit/i.test(markup)).length;
      const consoleMeta = readMetaFlag(html, "avorelo-console");
      const consoleEntries: BrowserConsoleEntry[] = [];
      if (consoleMeta) {
        for (const entry of consoleMeta.split("|")) {
          const [level, ...rest] = entry.split(":");
          if (level === "error" || level === "warning") {
            consoleEntries.push({ type: level, text: rest.join(":").slice(0, 200) });
          }
        }
      }
      const expectedTextFound = expectation.requiredText ? text.includes(expectation.requiredText.toLowerCase()) : true;
      return {
        ok: true,
        httpStatus: response.status,
        hasBody: text.length > 0 && expectedTextFound,
        hasFavicon: /<link[^>]+rel=["'][^"']*icon/i.test(html),
        primaryCtaCount: buttonMatches.filter((candidate) => /(activate|get started|start|sign up|contact|book demo|open dashboard)/i.test(candidate)).length,
        contactFormPresent: formMatches.length > 0 || /mailto:/i.test(html),
        dashboardShellPresent: /\bdashboard\b/i.test(text) || /data-testid=["']dashboard-shell["']/i.test(html),
        brokenLinkCount: brokenLocalLinks,
        disabledSubmitCount,
        overflowDetected: readMetaFlag(html, "avorelo-layout-overflow") === "true",
        placeholderMetricDetected: /placeholder metric|sample metric|demo metric|todo metric/.test(text),
        privateDataDetected: readMetaFlag(html, "avorelo-private-data") === "true" || /customer@example\.com|account owner|private account/i.test(text),
        authRequiredDetected: readMetaFlag(html, "avorelo-auth-required") === "true" || /sign in required|authentication required|access denied/i.test(text),
        consoleEntries,
        screenshot: {
          writePlaceholder: async (path: string, variant: "safe_capture" | "redacted") => {
            const fill = variant === "redacted" ? "#f4e7d4" : "#e8f2eb";
            const label = variant === "redacted" ? "Browser QA redacted fixture capture" : "Browser QA safe fixture capture";
            writeFileSync(path, `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="100%" height="100%" fill="${fill}"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="28">${label}</text></svg>`);
          },
        },
      };
    },
    async close(): Promise<void> {},
  };
}

async function createInspector(): Promise<{ inspector: BrowserInspector | null; fake: boolean }> {
  if (hasFakeBrowserQaMode()) return { inspector: await createFakeInspector(), fake: true };
  return { inspector: await createPlaywrightInspector(), fake: false };
}

function computeDecision(findings: BrowserQaFinding[]): BrowserQaDecision {
  if (findings.some((item) => item.reasonCode === "BROWSER_QA_UNSAFE_PRODUCTION_TARGET")) return "BLOCKED";
  if (findings.some((item) => item.reasonCode === "BROWSER_QA_BROWSER_DEPENDENCY_UNAVAILABLE")) return "UNAVAILABLE";
  if (findings.some((item) => item.severity === "critical")) return "FAIL";
  if (findings.some((item) => item.severity === "high")) return "FAIL";
  if (findings.some((item) => ["BROWSER_QA_AUTH_REQUIRED", "BROWSER_QA_PLACEHOLDER_METRIC_VISIBLE", "BROWSER_QA_SCREENSHOT_BLOCKED_PRIVATE_DATA", "BROWSER_QA_SCREENSHOT_REDACTED"].includes(item.reasonCode))) return "NEEDS_REVIEW";
  if (findings.some((item) => item.severity === "warning")) return "PASS_WITH_WARNINGS";
  return "PASS";
}

function computeRiskLevel(findings: BrowserQaFinding[]): BrowserQaArtifact["riskLevel"] {
  if (findings.some((item) => item.severity === "critical")) return "critical";
  if (findings.some((item) => item.severity === "high")) return "high";
  if (findings.length >= 2) return "medium";
  return "low";
}

function nextSafeAction(decision: BrowserQaDecision): string {
  switch (decision) {
    case "UNAVAILABLE":
      return "Install Playwright locally, then rerun Browser QA.";
    case "BLOCKED":
      return "Retarget Browser QA to a localhost or explicitly safe staging surface.";
    case "FAIL":
      return "Fix the blocking UI or browser findings, then rerun the same route set.";
    case "NEEDS_REVIEW":
      return "Review the flagged route manually before making broader UI claims.";
    case "PASS_WITH_WARNINGS":
      return "Triage the warnings and decide whether they are acceptable for the current feature review.";
    default:
      return "Keep Browser QA metadata with the feature branch and rerun after the next UI change.";
  }
}

function requiredUiPresent(result: BrowserInspectionResult, route: BrowserQaRouteInput): boolean {
  if (route.requiredUiRef === "contact_form") return result.contactFormPresent;
  if (route.requiredUiRef === "dashboard_shell") return result.dashboardShellPresent;
  if (route.requiredUiRef === "primary_cta") return result.primaryCtaCount > 0;
  return true;
}

async function persistScreenshot(
  dir: string,
  route: string,
  policy: BrowserQaScreenshotPolicy,
  result: BrowserInspectionResult,
  unsafeContent: boolean,
): Promise<{ persisted: number; policyResult: BrowserQaScreenshotPolicy; blocked: number }> {
  if (policy === "metadata_only") return { persisted: 0, policyResult: "metadata_only", blocked: 0 };
  if (policy === "blocked") return { persisted: 0, policyResult: "blocked", blocked: unsafeContent ? 1 : 0 };

  const shotDir = browserQaScreenshotDir(dir);
  mkdirSync(shotDir, { recursive: true });
  const baseName = route === "/" ? "root" : route.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "route";

  if (policy === "redacted") {
    const path = join(shotDir, `${baseName}.svg`);
    await result.screenshot.writePlaceholder?.(path, "redacted");
    return { persisted: 1, policyResult: "redacted", blocked: 0 };
  }

  if (unsafeContent) return { persisted: 0, policyResult: "blocked", blocked: 1 };

  if (result.screenshot.capturePng) {
    const path = join(shotDir, `${baseName}.png`);
    await result.screenshot.capturePng(path);
    return { persisted: 1, policyResult: "safe_capture", blocked: 0 };
  }

  const path = join(shotDir, `${baseName}.svg`);
  await result.screenshot.writePlaceholder?.(path, "safe_capture");
  return { persisted: 1, policyResult: "safe_capture", blocked: 0 };
}

export async function runBrowserVisualQa(options: BrowserQaRunOptions): Promise<BrowserQaArtifact> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const routes = normalizeRoutes(options.routes);
  const targetInfo = resolveTargetInput(options.dir, options.target);
  const targetLabel = sanitizeTargetLabel(targetInfo.targetKind, targetInfo.targetInput);
  const base = artifactBase(targetLabel, options.screenshotPolicy ?? "metadata_only");

  let previewHandle: Awaited<ReturnType<typeof serve>> | null = null;
  let baseUrl: string;

  if (targetInfo.targetKind === "directory" && targetInfo.localPath) {
    previewHandle = await serve(targetInfo.localPath, { host: "127.0.0.1" });
    baseUrl = previewHandle.url.replace(/\/$/, "");
  } else {
    const safety = evaluateTargetSafety(targetInfo.targetInput, {
      allowLocalhostOnly: options.allowLocalhostOnly ?? true,
      staging: options.staging ?? false,
    });
    if (!safety.allowed) {
      const blockedFinding = finding(
        "/",
        "critical",
        safety.reasonCode ?? "BROWSER_QA_UNSAFE_PRODUCTION_TARGET",
        safety.safeSummary ?? "Target is blocked by Browser QA safety policy.",
        "Use a localhost or clearly staged target for this feature workstream.",
      );
      const artifact: BrowserQaArtifact = {
        ...base,
        generatedAt: new Date().toISOString(),
        decision: "BLOCKED",
        riskLevel: "critical",
        routesChecked: 0,
        failedRoutes: 0,
        warningCount: 0,
        screenshotsPersisted: 0,
        unsafeCapturesBlocked: 0,
        topFindings: [blockedFinding],
        findings: [blockedFinding],
        routeSummaries: [],
        nextSafeAction: nextSafeAction("BLOCKED"),
      };
      writeBrowserQaLatest(options.dir, artifact);
      return artifact;
    }
    baseUrl = targetInfo.targetInput.replace(/\/$/, "");
  }

  const { inspector } = await createInspector();
  if (!inspector) {
    previewHandle && await previewHandle.close();
    const unavailableFinding = finding(
      "/",
      "warning",
      "BROWSER_QA_BROWSER_DEPENDENCY_UNAVAILABLE",
      "Playwright is not installed, so Browser QA cannot run a real browser inspection in this environment.",
      "Install Playwright locally or run the fake Browser QA fixture path for non-browser contract coverage.",
    );
    const artifact: BrowserQaArtifact = {
      ...base,
      generatedAt: new Date().toISOString(),
      decision: "UNAVAILABLE",
      riskLevel: "medium",
      routesChecked: 0,
      failedRoutes: 0,
      warningCount: 1,
      screenshotsPersisted: 0,
      unsafeCapturesBlocked: 0,
      topFindings: [unavailableFinding],
      findings: [unavailableFinding],
      routeSummaries: [],
      nextSafeAction: nextSafeAction("UNAVAILABLE"),
    };
    writeBrowserQaLatest(options.dir, artifact);
    return artifact;
  }

  const findings: BrowserQaFinding[] = [];
  const routeSummaries: BrowserQaRouteSummary[] = [];
  let screenshotsPersisted = 0;
  let unsafeCapturesBlocked = 0;

  try {
    for (const route of routes) {
      const routeUrl = `${baseUrl}${normalizeRoute(route.route)}`;
      let inspection: BrowserInspectionResult;
      try {
        inspection = await inspector.inspect(routeUrl, route, timeoutMs);
      } catch {
        findings.push(finding(
          route.route,
          "high",
          "BROWSER_QA_ROUTE_UNREACHABLE",
          "Route could not be reached by Browser QA.",
          "Check the local preview or route wiring before relying on this surface.",
        ));
        routeSummaries.push({
          route: route.route,
          loaded: false,
          httpStatus: null,
          screenshotPolicyResult: "metadata_only",
          consoleErrorCount: 0,
          consoleWarningCount: 0,
          findingCount: 1,
          evidenceRef: safeEvidenceRef(route.route, "route"),
        });
        continue;
      }

      const routeFindingsStart = findings.length;
      const unsafeContent = inspection.privateDataDetected || inspection.authRequiredDetected;
      const screenshotResult = await persistScreenshot(
        options.dir,
        route.route,
        options.screenshotPolicy ?? "metadata_only",
        inspection,
        unsafeContent,
      );
      screenshotsPersisted += screenshotResult.persisted;
      unsafeCapturesBlocked += screenshotResult.blocked;

      if (!inspection.ok || inspection.httpStatus === null || inspection.httpStatus >= 400) {
        findings.push(finding(
          route.route,
          "high",
          inspection.httpStatus === 401 || inspection.httpStatus === 403 ? "BROWSER_QA_AUTH_REQUIRED" : "BROWSER_QA_ROUTE_UNREACHABLE",
          inspection.httpStatus === 401 || inspection.httpStatus === 403
            ? "Route appears to require authentication before Browser QA can inspect it safely."
            : "Route did not load successfully in Browser QA.",
          inspection.httpStatus === 401 || inspection.httpStatus === 403
            ? "Use a safe local preview route or keep this route out of the default Browser QA set."
            : "Check the route, preview server, or local build before rerunning Browser QA.",
          { screenshotPolicyResult: screenshotResult.policyResult },
        ));
      }

      if (!inspection.hasBody) {
        findings.push(finding(
          route.route,
          "high",
          "BROWSER_QA_ROUTE_TIMEOUT",
          "Route did not present an inspectable body state.",
          "Check whether the page is stalling before render or serving an empty shell.",
          { screenshotPolicyResult: screenshotResult.policyResult },
        ));
      }

      if (!inspection.hasFavicon) {
        findings.push(finding(
          route.route,
          "warning",
          "BROWSER_QA_MISSING_FAVICON",
          "Page is missing a favicon reference.",
          "Add a favicon link so the route presents a complete browser surface.",
          { selector: "head > link[rel*=icon]", screenshotPolicyResult: screenshotResult.policyResult },
        ));
      }

      if (!requiredUiPresent(inspection, route)) {
        const mapping = route.requiredUiRef === "contact_form"
          ? { code: "BROWSER_QA_FORM_BROKEN", summary: "Expected contact entry point is missing or unusable.", next: "Restore the safe public contact form or mailto entry point.", selector: "contact_form" }
          : route.requiredUiRef === "dashboard_shell"
            ? { code: "BROWSER_QA_MISSING_ACTIVATION_CARD", summary: "Dashboard shell markers were not found.", next: "Check the dashboard preview route and its shell markup.", selector: "dashboard_shell" }
            : { code: "BROWSER_QA_MISSING_PRIMARY_CTA", summary: "Primary CTA was not found on the route.", next: "Restore the main CTA before claiming this route is ready for review.", selector: "primary_cta" };
        findings.push(finding(
          route.route,
          "high",
          mapping.code,
          mapping.summary,
          mapping.next,
          { selector: mapping.selector, screenshotPolicyResult: screenshotResult.policyResult },
        ));
      }

      if (inspection.consoleEntries.some((entry) => entry.type === "error")) {
        findings.push(finding(
          route.route,
          "warning",
          "BROWSER_QA_CONSOLE_ERROR",
          "Console errors were observed during Browser QA.",
          "Inspect the browser console locally and fix the underlying runtime issue.",
          { consoleCategory: "error", screenshotPolicyResult: screenshotResult.policyResult },
        ));
      }

      if (inspection.consoleEntries.some((entry) => entry.type === "warning")) {
        findings.push(finding(
          route.route,
          "info",
          "BROWSER_QA_CONSOLE_WARNING",
          "Console warnings were observed during Browser QA.",
          "Review the warning locally if it is relevant to this route.",
          { consoleCategory: "warning", screenshotPolicyResult: screenshotResult.policyResult },
        ));
      }

      if (inspection.brokenLinkCount > 0) {
        findings.push(finding(
          route.route,
          "warning",
          "BROWSER_QA_LINK_TARGET_INVALID",
          "Route includes obviously invalid link targets.",
          "Replace empty or javascript-only links on this route.",
          { selector: "a[href]", screenshotPolicyResult: screenshotResult.policyResult },
        ));
      }

      if (inspection.disabledSubmitCount > 0) {
        findings.push(finding(
          route.route,
          "warning",
          "BROWSER_QA_FORM_BROKEN",
          "Route shows a disabled submit action in a visible form.",
          "Check whether the form is unintentionally disabled in the current state.",
          { selector: "form", screenshotPolicyResult: screenshotResult.policyResult },
        ));
      }

      if (inspection.overflowDetected) {
        findings.push(finding(
          route.route,
          "warning",
          "BROWSER_QA_LAYOUT_OVERFLOW",
          "Layout overflow was detected on the route.",
          "Check the layout at the default desktop viewport and remove the overflow source.",
          { selector: "document", screenshotPolicyResult: screenshotResult.policyResult },
        ));
      }

      if (inspection.placeholderMetricDetected) {
        findings.push(finding(
          route.route,
          "warning",
          "BROWSER_QA_PLACEHOLDER_METRIC_VISIBLE",
          "Placeholder metric text is visible on the route.",
          "Replace placeholder metrics before using this route as product proof.",
          { selector: "metric_placeholder", screenshotPolicyResult: screenshotResult.policyResult },
        ));
      }

      if (inspection.authRequiredDetected) {
        findings.push(finding(
          route.route,
          "warning",
          "BROWSER_QA_AUTH_REQUIRED",
          "Route appears to require authentication or private account context.",
          "Keep this route out of the default Browser QA set unless a safe local test session is explicitly configured.",
          { selector: "auth_gate", screenshotPolicyResult: screenshotResult.policyResult },
        ));
      }

      if (screenshotResult.policyResult === "metadata_only") {
        findings.push(finding(
          route.route,
          "info",
          "BROWSER_QA_SCREENSHOT_METADATA_ONLY",
          "Screenshot capture stayed in metadata-only mode.",
          "Use safe capture only for routes that are explicitly confirmed to be safe.",
          { screenshotPolicyResult: screenshotResult.policyResult },
        ));
      } else if (screenshotResult.policyResult === "redacted") {
        findings.push(finding(
          route.route,
          "warning",
          "BROWSER_QA_SCREENSHOT_REDACTED",
          "Browser QA persisted only a redacted capture artifact for this route.",
          "Review whether a raw-safe capture is necessary, or keep the metadata-only record.",
          { screenshotPolicyResult: screenshotResult.policyResult },
        ));
      } else if (screenshotResult.policyResult === "blocked") {
        findings.push(finding(
          route.route,
          "warning",
          "BROWSER_QA_SCREENSHOT_BLOCKED_PRIVATE_DATA",
          "Screenshot persistence was blocked because the route appears to expose private or authenticated content.",
          "Leave this route in metadata-only mode unless it is redesigned for safe public capture.",
          { screenshotPolicyResult: screenshotResult.policyResult },
        ));
      }

      routeSummaries.push({
        route: route.route,
        loaded: inspection.ok && inspection.hasBody,
        httpStatus: inspection.httpStatus,
        screenshotPolicyResult: screenshotResult.policyResult,
        consoleErrorCount: inspection.consoleEntries.filter((entry) => entry.type === "error").length,
        consoleWarningCount: inspection.consoleEntries.filter((entry) => entry.type === "warning").length,
        findingCount: findings.length - routeFindingsStart,
        evidenceRef: safeEvidenceRef(route.route, "route"),
      });
    }
  } finally {
    await inspector.close();
    previewHandle && await previewHandle.close();
  }

  const decision = computeDecision(findings);
  const artifact: BrowserQaArtifact = {
    ...base,
    generatedAt: new Date().toISOString(),
    decision,
    riskLevel: computeRiskLevel(findings),
    routesChecked: routeSummaries.length,
    failedRoutes: routeSummaries.filter((item) => !item.loaded || item.httpStatus === null || item.httpStatus >= 400).length,
    warningCount: findings.filter((item) => item.severity === "warning").length,
    screenshotsPersisted,
    unsafeCapturesBlocked,
    topFindings: findings.slice(0, 5),
    findings,
    routeSummaries,
    nextSafeAction: nextSafeAction(decision),
  };
  writeBrowserQaLatest(options.dir, artifact);
  return artifact;
}
