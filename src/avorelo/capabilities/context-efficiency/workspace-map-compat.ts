import { existsSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

import type {
  ContextEfficiencyDecisionState,
  ContextEfficiencyPathRecommendation,
  ContextEfficiencyRiskLevel,
  ContextEfficiencyWorkType,
  ContextRecommendationMode,
} from "./types.ts";

export type WorkspaceMapCompatClassification = {
  inputPath: string;
  normalizedPath: string;
  existsInRepo: boolean;
  sourceOfTruth: boolean;
  generatedOutput: boolean;
  runtimeArtifact: boolean;
  releaseOwned: boolean;
  billingSensitive: boolean;
  secretSensitive: boolean;
  publicWebSource: boolean;
  capabilitySource: boolean;
  dashboardSurface: boolean;
  tags: string[];
  workTypeHints: ContextEfficiencyWorkType[];
  recommendation: ContextRecommendationMode;
  decisionState: ContextEfficiencyDecisionState;
  riskLevel: ContextEfficiencyRiskLevel;
  summary: string;
  safeNextAction: string;
  reasonCodes: string[];
};

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function normalizePath(dir: string, inputPath: string): { normalizedPath: string; existsInRepo: boolean } {
  const cleanedInput = normalizeSlashes(inputPath.trim());
  if (!cleanedInput) return { normalizedPath: "", existsInRepo: false };
  const absolute = isAbsolute(inputPath) ? inputPath : join(dir, inputPath);
  const repoRelative = normalizeSlashes(relative(dir, absolute));
  if (repoRelative && !repoRelative.startsWith("..") && repoRelative !== ".") {
    return { normalizedPath: repoRelative, existsInRepo: existsSync(absolute) };
  }
  if (cleanedInput.startsWith("./")) return { normalizedPath: cleanedInput.slice(2), existsInRepo: existsSync(join(dir, cleanedInput)) };
  return { normalizedPath: cleanedInput, existsInRepo: existsSync(join(dir, cleanedInput.split("/").join(sep))) };
}

export function classifyPathForContextEfficiency(dir: string, inputPath: string): WorkspaceMapCompatClassification {
  const { normalizedPath, existsInRepo } = normalizePath(dir, inputPath);
  const path = normalizedPath.toLowerCase();
  const generatedOutput =
    path.startsWith("dist/") ||
    path.startsWith("tmp-avorelo-pack-check/") ||
    path.startsWith("dist/site/") ||
    path.endsWith("generated-pages.ts");
  const runtimeArtifact = path.startsWith(".avorelo/") || path.startsWith(".avorelo-sandbox/");
  const releaseOwned =
    path.startsWith("docs/release/") ||
    path.startsWith("docs/private-alpha/") ||
    path === "netlify.toml" ||
    path === "railway.json";
  const billingSensitive =
    /(^|\/)(billing|entitlement|checkout|subscription|invoice|payment)(\/|$)/.test(path) ||
    path.includes("adapters/lemon-squeezy");
  const secretSensitive =
    path.includes(".env") ||
    path.includes(".ssh") ||
    path.endsWith(".pem") ||
    path.includes("id_rsa") ||
    /\b(secret|credential|token)\b/.test(path);
  const publicWebSource =
    path.startsWith("src/avorelo/surfaces/public-web/static/") &&
    !path.endsWith("generated-pages.ts");
  const capabilitySource =
    path.startsWith("src/avorelo/capabilities/") ||
    path.startsWith("src/avorelo/kernel/") ||
    path.startsWith("src/avorelo/surfaces/cli/");
  const dashboardSurface =
    path.includes("dashboard") || path.includes("login.html") || path.includes("signup.html") || path.includes("settings");
  const docsSource =
    path === "readme.md" ||
    path.startsWith("docs/") ||
    path.endsWith(".md");
  const sourceOfTruth =
    docsSource ||
    publicWebSource ||
    path.startsWith("src/avorelo/capabilities/") ||
    path.startsWith("src/avorelo/kernel/") ||
    path.startsWith("tests/");

  const tags = [
    ...(sourceOfTruth ? ["source_of_truth"] : []),
    ...(generatedOutput ? ["generated_output"] : []),
    ...(runtimeArtifact ? ["runtime_artifact"] : []),
    ...(releaseOwned ? ["release_owned"] : []),
    ...(billingSensitive ? ["billing_sensitive"] : []),
    ...(secretSensitive ? ["secret_sensitive"] : []),
    ...(publicWebSource ? ["public_web_source"] : []),
    ...(capabilitySource ? ["capability_source"] : []),
    ...(dashboardSurface ? ["dashboard_surface"] : []),
    ...(!existsInRepo ? ["missing_in_repo"] : []),
  ];

  let recommendation: ContextRecommendationMode = "include";
  let decisionState: ContextEfficiencyDecisionState = "READY";
  let riskLevel: ContextEfficiencyRiskLevel = "low";
  let summary = "Inspect this path directly if it is part of the task.";
  let safeNextAction = "Inspect the path and nearby tests before editing.";
  const reasonCodes: string[] = [];
  const workTypeHints: ContextEfficiencyWorkType[] = [];

  if (publicWebSource) workTypeHints.push("public_site");
  if (capabilitySource) workTypeHints.push("feature_development");
  if (dashboardSurface) workTypeHints.push("dashboard_ux");
  if (billingSensitive) workTypeHints.push("billing_or_entitlement");
  if (docsSource) workTypeHints.push("documentation");

  if (!normalizedPath) {
    recommendation = "exclude";
    decisionState = "UNAVAILABLE";
    riskLevel = "medium";
    summary = "No path was provided.";
    safeNextAction = "Provide --path with a repo-relative file or directory.";
    reasonCodes.push("path_missing");
  } else if (generatedOutput) {
    recommendation = "exclude";
    decisionState = "READY_WITH_WARNINGS";
    riskLevel = "medium";
    summary = "Generated output should not be edited or used as primary context.";
    safeNextAction = "Inspect the canonical source path instead of this generated output.";
    reasonCodes.push("generated_output_excluded");
  } else if (runtimeArtifact) {
    recommendation = "exclude";
    decisionState = "READY_WITH_WARNINGS";
    riskLevel = "medium";
    summary = "Local runtime artifacts are useful for readback, not for staging or direct editing.";
    safeNextAction = "Keep this path local-only and out of the staging set.";
    reasonCodes.push("runtime_artifact_excluded");
  } else if (releaseOwned) {
    recommendation = "requires_user_confirmation";
    decisionState = "BLOCKED";
    riskLevel = "critical";
    summary = "Release-owned or production-owned paths are out of scope for this workstream.";
    safeNextAction = "Stay out of this path and document release needs separately.";
    reasonCodes.push("release_scope_blocked");
  } else if (billingSensitive || secretSensitive) {
    recommendation = "requires_user_confirmation";
    decisionState = "NEEDS_REVIEW";
    riskLevel = billingSensitive ? "high" : "critical";
    summary = billingSensitive
      ? "Billing or entitlement paths need tighter review, proof, and careful scope."
      : "Secret-sensitive paths must stay metadata-only and require extra care.";
    safeNextAction = billingSensitive
      ? "Inspect source-of-truth files first and keep proof requirements explicit before editing."
      : "Do not load or persist raw values; use safe references and narrow the scope.";
    reasonCodes.push(billingSensitive ? "billing_scope_review" : "secret_scope_review");
  } else if (dashboardSurface) {
    recommendation = "summarize";
    decisionState = "NEEDS_REVIEW";
    riskLevel = "high";
    summary = "Dashboard, auth, or settings surfaces appear to be owned by a separate UX lane.";
    safeNextAction = "Avoid editing this path in this workstream unless the overlap is explicitly documented.";
    reasonCodes.push("dashboard_scope_review");
  } else if (!existsInRepo) {
    recommendation = "defer_until_needed";
    decisionState = "UNAVAILABLE";
    riskLevel = "medium";
    summary = "The path is not present in this repo checkout.";
    safeNextAction = "Confirm the path or inspect the nearest source-of-truth path instead.";
    reasonCodes.push("path_not_found");
  } else if (publicWebSource) {
    recommendation = "include";
    decisionState = "READY";
    riskLevel = "medium";
    summary = "Canonical public-web source path.";
    safeNextAction = "Inspect the static source file and run public-web checks after changes.";
    reasonCodes.push("public_web_source");
  } else if (capabilitySource) {
    recommendation = "include";
    decisionState = "READY";
    riskLevel = "medium";
    summary = "Capability or CLI source path with nearby tests and build checks.";
    safeNextAction = "Inspect nearby tests and run targeted capability validation after edits.";
    reasonCodes.push("capability_source");
  }

  return {
    inputPath,
    normalizedPath,
    existsInRepo,
    sourceOfTruth,
    generatedOutput,
    runtimeArtifact,
    releaseOwned,
    billingSensitive,
    secretSensitive,
    publicWebSource,
    capabilitySource,
    dashboardSurface,
    tags,
    workTypeHints,
    recommendation,
    decisionState,
    riskLevel,
    summary,
    safeNextAction,
    reasonCodes,
  };
}

export function toRecommendation(
  classification: WorkspaceMapCompatClassification,
  recommendation: ContextRecommendationMode = classification.recommendation,
): ContextEfficiencyPathRecommendation {
  return {
    path: classification.normalizedPath || classification.inputPath,
    recommendation,
    summary: classification.summary,
    reasonCode:
      classification.generatedOutput
        ? "CONTEXT_EFFICIENCY_GENERATED_OUTPUT_EXCLUDED"
        : classification.runtimeArtifact
        ? "CONTEXT_EFFICIENCY_RUNTIME_ARTIFACT_EXCLUDED"
        : classification.releaseOwned
        ? "CONTEXT_EFFICIENCY_RELEASE_SCOPE_BLOCKED"
        : classification.billingSensitive
        ? "CONTEXT_EFFICIENCY_BILLING_SCOPE_REVIEW"
        : classification.secretSensitive
        ? "CONTEXT_EFFICIENCY_SECRET_SCOPE_REVIEW"
        : "CONTEXT_EFFICIENCY_SOURCE_OF_TRUTH",
    tags: classification.tags,
  };
}
