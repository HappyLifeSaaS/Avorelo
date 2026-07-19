export type BrowserQaScreenshotPolicy = "metadata_only" | "safe_capture" | "redacted" | "blocked";
export type BrowserQaDecision = "PASS" | "PASS_WITH_WARNINGS" | "NEEDS_REVIEW" | "FAIL" | "BLOCKED" | "UNAVAILABLE";
export type BrowserQaRiskLevel = "low" | "medium" | "high" | "critical";
export type BrowserQaFindingSeverity = "info" | "warning" | "high" | "critical";

export type BrowserQaRouteInput = {
  route: string;
  requiredUiRef?: "primary_cta" | "contact_form" | "dashboard_shell" | "activation_card" | null;
  requiredText?: string | null;
};

export type BrowserQaFinding = {
  route: string;
  selector: string | null;
  severity: BrowserQaFindingSeverity;
  reasonCode: string;
  safeSummary: string;
  evidenceRef: string;
  screenshotPolicyResult: BrowserQaScreenshotPolicy;
  consoleCategory?: "error" | "warning" | null;
  recommendedNextAction: string;
};

export type BrowserQaRouteSummary = {
  route: string;
  loaded: boolean;
  httpStatus: number | null;
  screenshotPolicyResult: BrowserQaScreenshotPolicy;
  consoleErrorCount: number;
  consoleWarningCount: number;
  findingCount: number;
  evidenceRef: string;
};

export type BrowserQaArtifact = {
  contract: "avorelo.browserVisualQa.v1";
  schemaVersion: 1;
  generatedAt: string;
  target: string;
  decision: BrowserQaDecision;
  riskLevel: BrowserQaRiskLevel;
  routesChecked: number;
  failedRoutes: number;
  warningCount: number;
  screenshotPolicy: BrowserQaScreenshotPolicy;
  screenshotsPersisted: number;
  unsafeCapturesBlocked: number;
  topFindings: BrowserQaFinding[];
  findings: BrowserQaFinding[];
  routeSummaries: BrowserQaRouteSummary[];
  nextSafeAction: string;
  containsRawScreenshot: false;
  containsRawHtml: false;
  containsRawDom: false;
  containsRawConsoleLog: false;
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawDiff: false;
  containsRawSecret: false;
  containsRawEnvValue: false;
  containsRawTerminalOutput: false;
  contentStorageClass: "safe_metadata_only";
};

export type BrowserQaRunOptions = {
  dir: string;
  target?: string;
  routes?: BrowserQaRouteInput[];
  timeoutMs?: number;
  screenshotPolicy?: BrowserQaScreenshotPolicy;
  allowLocalhostOnly?: boolean;
  staging?: boolean;
};

export type BrowserQaControlCenterSummary = {
  status: "available" | "unavailable";
  generatedAt?: string;
  decision?: BrowserQaDecision;
  routesChecked?: number;
  failedRoutes?: number;
  warningCount?: number;
  screenshotPolicy?: BrowserQaScreenshotPolicy;
  screenshotsPersisted?: number;
  unsafeCapturesBlocked?: number;
  topFindings?: Array<{
    route: string;
    severity: BrowserQaFindingSeverity;
    reasonCode: string;
    safeSummary: string;
  }>;
  nextSafeAction?: string;
};
