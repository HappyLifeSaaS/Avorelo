import { existsSync } from "node:fs";
import { join } from "node:path";

import { redact } from "../../shared/redaction/index.ts";
import { compileContext } from "../context-compiler/index.ts";
import { loadLatestContinuity } from "../continuity/index.ts";
import { loadLatestRuntimeSession } from "../runtime-flow/index.ts";
import { decideRouting } from "../../kernel/work-contract/routing.ts";
import { buildCapabilityRouteDecision, detectProposalHints } from "../../kernel/work-controls/index.ts";
import { detectMonorepo } from "../workspace/monorepo.ts";

import { buildContextPlan, toSummaryRecommendation } from "./context-budget.ts";
import { inferContextEfficiencyWorkType } from "./work-type.ts";
import type {
  ContextEfficiencyBrief,
  ContextEfficiencyDecisionState,
  ContextEfficiencyEvidenceRecommendation,
  ContextEfficiencyPathCheck,
  ContextEfficiencyRiskLevel,
  ContextEfficiencyValidationCommand,
  ContextEfficiencyWorkType,
} from "./types.ts";
import { writeContextEfficiencyBrief } from "./persistence.ts";
import { classifyPathForContextEfficiency, toRecommendation } from "./workspace-map-compat.ts";

export type BuildContextEfficiencyBriefInput = {
  dir: string;
  task?: string;
  generatedAt?: string;
};

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function sanitizeVisibleText(value: string): string {
  let sanitized = redact(value).value;
  sanitized = sanitized.replace(/\b[A-Z][A-Z0-9_]{2,}=\S+/g, "[REDACTED:env_value]");
  sanitized = sanitized.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED:email]");
  sanitized = sanitized.replace(/\bhttps?:\/\/\S+/gi, "[REDACTED:remote_url]");
  sanitized = sanitized.replace(/(^|[\s"'(])(?:[A-Za-z]:\\Users\\[^\s"')]+|\/Users\/[^\s"')]+|\/home\/[^\s"')]+)/g, "$1[REDACTED:absolute_path]");
  return sanitized.replace(/\s+/g, " ").trim();
}

function resolveTaskSource(dir: string, explicitTask?: string): { task: string; taskSource: ContextEfficiencyBrief["taskSource"] } {
  const explicit = explicitTask?.trim();
  if (explicit) return { task: explicit, taskSource: "explicit_task" };
  const runtime = loadLatestRuntimeSession(dir);
  if (runtime?.objective) return { task: runtime.objective, taskSource: "runtime_flow" };
  const continuity = loadLatestContinuity(dir);
  if (continuity?.objectiveSummary) return { task: continuity.objectiveSummary, taskSource: "continuity" };
  return { task: "", taskSource: "fallback" };
}

function riskFromRouting(riskClass: string | null): ContextEfficiencyRiskLevel {
  if (riskClass === "critical") return "critical";
  if (riskClass === "high") return "high";
  if (riskClass === "medium") return "medium";
  return "low";
}

function decisionFromState(input: {
  task: string;
  workType: ContextEfficiencyWorkType;
  routingGate: ReturnType<typeof decideRouting> | null;
  blockedAreas: string[];
  gatedCount: number;
  warnings: string[];
}): ContextEfficiencyDecisionState {
  if (!input.task.trim() && input.warnings.length > 0) return "READY_WITH_WARNINGS";
  if (input.blockedAreas.length > 0) return "BLOCKED";
  if (input.routingGate?.gate === "blocked") return "BLOCKED";
  if (input.gatedCount > 0 || input.workType === "billing_or_entitlement" || input.workType === "dashboard_ux") return "NEEDS_REVIEW";
  if (!input.task.trim()) return "UNAVAILABLE";
  return input.warnings.length > 0 ? "READY_WITH_WARNINGS" : "READY";
}

function buildRepoAreaHints(workType: ContextEfficiencyWorkType, selectedRefs: string[]): string[] {
  const defaults = {
    public_site: ["src/avorelo/surfaces/public-web/static", "docs/product", "tests"],
    dashboard_ux: ["src/avorelo/surfaces/public-web/static", "docs/product", "tests"],
    billing_or_entitlement: ["tests"],
    documentation: ["README.md", "docs", "tests"],
    test_repair: ["tests", "src/avorelo", "package.json"],
    security_review: ["src/avorelo", "tests", "docs/security"],
    feature_development: ["src/avorelo", "tests", "docs"],
    bug_fix: ["src/avorelo", "tests", "docs"],
    release_preparation: ["docs/release", "package.json", ".github"],
    unknown: ["src/avorelo", "tests", "docs"],
  } satisfies Record<ContextEfficiencyWorkType, string[]>;
  return unique([...selectedRefs.map((label) => label.split("/").slice(0, 3).join("/")), ...defaults[workType]]).slice(0, 8);
}

function buildValidationCommands(dir: string, workType: ContextEfficiencyWorkType, paths: string[]): ContextEfficiencyValidationCommand[] {
  const commands: ContextEfficiencyValidationCommand[] = [
    { command: "git diff --check", reason: "Detect whitespace and patch hygiene issues before staging." },
  ];
  const lower = paths.map((path) => path.toLowerCase());
  const touchesCode = lower.some((path) => path.startsWith("src/") || path.startsWith("tests/"));
  const touchesPublicWeb = lower.some((path) => path.startsWith("src/avorelo/surfaces/public-web/static/"));
  const touchesCapability = lower.some((path) => path.startsWith("src/avorelo/capabilities/") || path.startsWith("src/avorelo/kernel/") || path.startsWith("src/avorelo/surfaces/cli/"));

  if (touchesCode || workType === "feature_development" || workType === "bug_fix" || workType === "test_repair") {
    commands.push({ command: "npm run build", reason: "Keep the CLI bundle and TypeScript entrypoints healthy." });
    commands.push({ command: "npm run naming-check", reason: "Preserve repo naming and boundary invariants." });
  }

  if (touchesPublicWeb || workType === "public_site") {
    commands.push({ command: "npm run build:site", reason: "Regenerate and validate canonical public-web output from source." });
    commands.push({ command: "npm run site:check", reason: "Verify static public-web health after changes." });
  }

  if (touchesCapability) {
    commands.push({ command: "node --test tests/context-efficiency.test.ts", reason: "Run the nearest targeted capability test." });
  }

  if (existsSync(join(dir, "tests", "context-efficiency-cli.test.ts"))) {
    commands.push({ command: "node --test tests/context-efficiency-cli.test.ts", reason: "Verify CLI surface behavior for work-brief flows." });
  }

  return unique(commands.map((item) => item.command)).map((command) => commands.find((item) => item.command === command)!);
}

function buildExpectedEvidence(capabilityEvidence: string[], decisionState: ContextEfficiencyDecisionState): ContextEfficiencyEvidenceRecommendation[] {
  const expected: ContextEfficiencyEvidenceRecommendation[] = [
    {
      key: "context_efficiency_brief",
      summary: "Persist a metadata-only work brief before the AI work session starts or resumes.",
      source: "context-efficiency",
    },
    {
      key: "safe_next_action_confirmed",
      summary: "End the session with a clear, safe next action and validation summary.",
      source: "context-efficiency",
    },
  ];
  for (const evidence of capabilityEvidence) {
    expected.push({
      key: evidence,
      summary: `Carry forward existing work-controls evidence expectation: ${evidence}.`,
      source: "work-controls",
    });
  }
  if (decisionState === "NEEDS_REVIEW" || decisionState === "BLOCKED") {
    expected.push({
      key: "manual_scope_review",
      summary: "Capture explicit scope and approval handling before touching sensitive areas.",
      source: "context-efficiency",
    });
  }
  return expected;
}

function buildSourceOfTruthPaths(workType: ContextEfficiencyWorkType, packetRefs: string[]): string[] {
  const defaults = {
    public_site: ["docs/product/canonical-visible-ui-source-of-truth.md", "src/avorelo/surfaces/public-web/static"],
    dashboard_ux: ["docs/product/dashboard-route-and-surface-audit.md", "src/avorelo/surfaces/public-web/static/dashboard.html"],
    billing_or_entitlement: ["tests"],
    documentation: ["README.md", "docs"],
    test_repair: ["tests", "src/avorelo"],
    security_review: ["docs/security", "src/avorelo"],
    feature_development: ["src/avorelo", "tests"],
    bug_fix: ["src/avorelo", "tests"],
    release_preparation: ["docs/release", "package.json"],
    unknown: ["src/avorelo", "tests", "docs"],
  } satisfies Record<ContextEfficiencyWorkType, string[]>;
  return unique([...packetRefs, ...defaults[workType]]).slice(0, 8);
}

function generatedOutputPaths(): string[] {
  return ["dist/**", "dist/site/**", "src/avorelo/surfaces/public-web/generated-pages.ts", "tmp-avorelo-pack-check/**"];
}

function runtimeArtifactPaths(): string[] {
  return [".avorelo/**", ".avorelo-sandbox/**"];
}

function blockedAreas(): string[] {
  return ["docs/release/**", "netlify.toml", "railway.json", ".env*", "**/*.pem", "**/.ssh/**"];
}

export function buildContextEfficiencyBrief(input: BuildContextEfficiencyBriefInput): ContextEfficiencyBrief {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const taskInfo = resolveTaskSource(input.dir, input.task);
  const objectiveSummary = sanitizeVisibleText(taskInfo.task || "No active task recorded.");
  const routing = taskInfo.task ? decideRouting({ task: taskInfo.task, dir: input.dir }) : null;
  const packet = taskInfo.task ? compileContext({ task: taskInfo.task, dir: input.dir, createdAt: generatedAt }) : null;
  const selectedRefs = packet?.selectedRefs.map((ref) => ref.label) ?? [];
  const workType = inferContextEfficiencyWorkType(taskInfo.task, selectedRefs);
  const repoAreas = buildRepoAreaHints(workType, selectedRefs);
  const sourceOfTruthPaths = buildSourceOfTruthPaths(
    workType,
    (packet?.selectedRefs ?? [])
      .filter((ref) => ref.authority === "source_of_truth")
      .map((ref) => ref.label),
  );

  const sourceOfTruthRecommendations = sourceOfTruthPaths
    .map((path) => classifyPathForContextEfficiency(input.dir, path))
    .map((classification) => toRecommendation(classification, classification.secretSensitive ? "summarize" : "include"));
  const excludedRecommendations = [
    ...generatedOutputPaths().map((path) => toRecommendation(classifyPathForContextEfficiency(input.dir, path), "exclude")),
    ...runtimeArtifactPaths().map((path) => toRecommendation(classifyPathForContextEfficiency(input.dir, path), "exclude")),
  ];
  const selectedClassifications = (packet?.selectedRefs ?? []).map((ref) => classifyPathForContextEfficiency(input.dir, ref.label));
  const gatedRecommendations = selectedClassifications
    .filter((classification) => classification.billingSensitive || classification.secretSensitive || classification.dashboardSurface || classification.releaseOwned)
    .map((classification) => toRecommendation(classification, "requires_user_confirmation"));
  const blockedMatches = selectedClassifications.filter((classification) => classification.releaseOwned).map((classification) => classification.normalizedPath);
  const summarizedRecommendations = selectedClassifications
    .filter((classification) => classification.secretSensitive || classification.billingSensitive || classification.dashboardSurface)
    .map((classification) => toSummaryRecommendation(classification));
  const deferredRecommendations = selectedClassifications
    .filter((classification) => classification.generatedOutput === false && classification.runtimeArtifact === false)
    .slice(4)
    .map((classification) => ({
      path: classification.normalizedPath,
      recommendation: "defer_until_needed" as const,
      summary: "Keep this path out of the first pass until the task proves it is needed.",
      reasonCode: "CONTEXT_EFFICIENCY_CONTEXT_BUDGET_APPLIED",
      tags: classification.tags,
    }));

  const warnings = unique([
    ...(taskInfo.task ? [] : ["No explicit task found; the brief is using conservative fallback guidance."]),
    ...(packet?.route === "needs_decision" ? ["Task scope is broad; narrow the objective before loading more context."] : []),
    ...(workType === "dashboard_ux" ? ["Dashboard, auth, or settings surfaces may overlap with a separate UX workstream."] : []),
    ...(workType === "billing_or_entitlement" ? ["Billing and entitlement work should stay tightly scoped and review-heavy."] : []),
  ]);

  const proposalHints = detectProposalHints(taskInfo.task, selectedRefs);
  const capabilityRoute = buildCapabilityRouteDecision({
    taskType: workType,
    riskClass: routing?.contract.riskClass ?? "medium",
    proofTier: routing?.contract.proofTier ?? "local",
    approvalPolicy: routing?.contract.approvalPolicy ?? "require_confirmation",
    proposalHints,
    touchedLayers: selectedRefs,
    paymentTouched: workType === "billing_or_entitlement",
    authTouched: workType === "security_review",
    dashboardTouched: workType === "dashboard_ux",
    publicCopyTouched: workType === "public_site" || workType === "documentation",
    contextBudgetRemaining: packet?.contextBudget.targetSize === "tiny" ? 10 : packet?.contextBudget.targetSize === "small" ? 40 : 70,
    tokenBudgetRemaining: packet?.contextBudget.targetSize === "tiny" ? 4000 : 20000,
  });

  const decisionState = decisionFromState({
    task: taskInfo.task,
    workType,
    routingGate: routing,
    blockedAreas: blockedMatches,
    gatedCount: gatedRecommendations.length + (routing?.gate === "require_approval" ? 1 : 0),
    warnings,
  });
  const riskLevel = routing ? riskFromRouting(routing.contract.riskClass) : decisionState === "UNAVAILABLE" ? "medium" : "low";
  const validations = buildValidationCommands(input.dir, workType, sourceOfTruthPaths);
  const contextPlan = buildContextPlan({
    packet,
    sourceOfTruth: sourceOfTruthRecommendations,
    summarized: summarizedRecommendations,
    excluded: excludedRecommendations,
    deferred: deferredRecommendations,
    gated: gatedRecommendations,
  });

  const monorepo = detectMonorepo(input.dir);
  const workspaceMapCompatibility = {
    workspaceMapAvailable: false,
    provider: "fallback_path_rules_v1",
    notes: unique([
      "No standalone Workspace Map capability exists in this base; brief-specific fallback rules are active.",
      monorepo.isMonorepo ? `Monorepo detected via ${monorepo.strategy}.` : "Single-repo fallback classification is active.",
    ]),
  };

  const safeNextAction =
    decisionState === "BLOCKED"
      ? "Do not proceed into release-owned or blocked areas; narrow the task and stay in source-of-truth paths."
      : decisionState === "NEEDS_REVIEW"
      ? "Inspect the source-of-truth paths first, keep sensitive areas summarized only, and confirm scope before editing."
      : decisionState === "UNAVAILABLE"
      ? "Provide --task or inspect the first source-of-truth path before opening more context."
      : "Inspect the first source-of-truth path, keep generated output excluded, and run the recommended validation after changes.";

  return {
    contract: "avorelo.contextEfficiencyBrief.v1",
    schemaVersion: 1,
    generatedAt,
    repoRoot: input.dir,
    taskSource: taskInfo.taskSource,
    objectiveSummary,
    decisionState,
    riskLevel,
    workType,
    repoAreas,
    sourceOfTruthPaths,
    generatedOutputPaths: generatedOutputPaths(),
    runtimeArtifactPaths: runtimeArtifactPaths(),
    blockedAreas: blockedAreas(),
    contextPlan,
    validation: { commands: validations },
    expectedEvidence: buildExpectedEvidence(capabilityRoute.expectedEvidence, decisionState),
    workControls: {
      selectedCapabilities: capabilityRoute.selectedCapabilities,
      expectedEvidence: capabilityRoute.expectedEvidence,
      reasonCodes: capabilityRoute.reasonCodes,
    },
    workspaceMapCompatibility,
    safeNextAction,
    warnings,
    containsRawSource: false,
    containsRawPrompt: false,
    containsRawDiff: false,
    containsRawSecret: false,
    containsRawEnvValue: false,
    containsRawTerminalOutput: false,
    containsRawCustomerData: false,
    containsRawScreenshot: false,
    contentStorageClass: "safe_metadata_only",
  };
}

export function buildAndPersistContextEfficiencyBrief(input: BuildContextEfficiencyBriefInput): { brief: ContextEfficiencyBrief; path: string } {
  const brief = buildContextEfficiencyBrief(input);
  const path = writeContextEfficiencyBrief(input.dir, brief);
  return { brief, path };
}

export function buildContextEfficiencyPathCheck(dir: string, inputPath: string, generatedAt = new Date().toISOString()): ContextEfficiencyPathCheck {
  const classification = classifyPathForContextEfficiency(dir, inputPath);
  const workTypeHints = classification.workTypeHints.length > 0 ? classification.workTypeHints : ["unknown"];
  const validation = buildValidationCommands(dir, workTypeHints[0] ?? "unknown", [classification.normalizedPath]);
  return {
    contract: "avorelo.contextEfficiencyPathCheck.v1",
    schemaVersion: 1,
    generatedAt,
    repoRoot: dir,
    inputPath,
    normalizedPath: classification.normalizedPath,
    decisionState: classification.decisionState,
    riskLevel: classification.riskLevel,
    recommendation: classification.recommendation,
    summary: classification.summary,
    safeNextAction: classification.safeNextAction,
    workTypeHints,
    tags: classification.tags,
    reasonCodes: classification.reasonCodes,
    validation: { commands: validation },
    containsRawSource: false,
    containsRawPrompt: false,
    containsRawDiff: false,
    containsRawSecret: false,
    containsRawEnvValue: false,
    containsRawTerminalOutput: false,
    containsRawCustomerData: false,
    containsRawScreenshot: false,
    contentStorageClass: "safe_metadata_only",
  };
}
