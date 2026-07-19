import type { ProjectCapabilities } from "../../capabilities/capability-discovery/index.ts";

export type WorkType =
  | "quick_code_fix"
  | "ui_product_surface"
  | "api_backend"
  | "security_sensitive"
  | "dependency_package"
  | "docs_marketing"
  | "release_readiness"
  | "activation_onboarding"
  | "dashboard_receipt"
  | "model_routing_control"
  | "unknown_mixed";

export interface ProofRequirement {
  id: string;
  description: string;
  critical: boolean;
  adapterId: string;
}

export interface ProofContract {
  timestamp: string;
  workType: WorkType;
  workTypeReasons: string[];
  requiredProof: ProofRequirement[];
  optionalProof: ProofRequirement[];
  blockedActions: string[];
  missingCapabilities: string[];
  recommendedCommands: string[];
  closureRules: string[];
  containsRawSecret: false;
}

const UI_PATH_PATTERNS = [
  /\.(tsx|jsx|vue|svelte|astro)$/i,
  /components?\//i,
  /pages?\//i,
  /views?\//i,
  /layouts?\//i,
  /\.css$/i,
  /\.scss$/i,
  /\.html$/i,
  /site\//i,
  /dashboard\//i,
  /ui\//i,
];

const API_PATH_PATTERNS = [
  /api\//i,
  /routes?\//i,
  /controllers?\//i,
  /handlers?\//i,
  /middleware/i,
  /endpoints?\//i,
  /graphql/i,
  /schema\.(ts|js|graphql|gql)$/i,
  /openapi/i,
  /swagger/i,
];

const SECURITY_PATH_PATTERNS = [
  /auth/i,
  /security/i,
  /secrets?/i,
  /tokens?/i,
  /permissions?/i,
  /crypto/i,
  /\.env/i,
  /password/i,
  /credentials?/i,
  /billing/i,
  /payment/i,
];

const DEPENDENCY_PATH_PATTERNS = [
  /package\.json$/i,
  /package-lock\.json$/i,
  /pnpm-lock\.yaml$/i,
  /yarn\.lock$/i,
];

const DOCS_PATH_PATTERNS = [
  /docs?\//i,
  /\.md$/i,
  /marketing\//i,
  /readme/i,
  /changelog/i,
  /release-notes/i,
];

const RELEASE_PATH_PATTERNS = [
  /\.github\/workflows/i,
  /netlify/i,
  /deploy/i,
  /release/i,
  /Dockerfile/i,
];

const ACTIVATION_PATH_PATTERNS = [
  /activation/i,
  /onboarding/i,
  /setup/i,
  /init/i,
];

const RECEIPT_PATH_PATTERNS = [
  /receipt/i,
  /evidence/i,
  /proof/i,
  /dashboard/i,
  /history/i,
];

const ROUTING_PATH_PATTERNS = [
  /model-routing/i,
  /work-control/i,
  /work-contract/i,
  /control-router/i,
  /routing/i,
];

export function inferWorkType(changedFiles: string[]): { workType: WorkType; reasons: string[] } {
  if (changedFiles.length === 0) return { workType: "unknown_mixed", reasons: ["no_changed_files"] };

  const scores: Record<WorkType, number> = {
    quick_code_fix: 0,
    ui_product_surface: 0,
    api_backend: 0,
    security_sensitive: 0,
    dependency_package: 0,
    docs_marketing: 0,
    release_readiness: 0,
    activation_onboarding: 0,
    dashboard_receipt: 0,
    model_routing_control: 0,
    unknown_mixed: 0,
  };
  const reasons: string[] = [];

  for (const f of changedFiles) {
    if (UI_PATH_PATTERNS.some(p => p.test(f))) { scores.ui_product_surface += 2; reasons.push(`ui_file:${f}`); }
    if (API_PATH_PATTERNS.some(p => p.test(f))) { scores.api_backend += 2; reasons.push(`api_file:${f}`); }
    if (SECURITY_PATH_PATTERNS.some(p => p.test(f))) { scores.security_sensitive += 3; reasons.push(`security_file:${f}`); }
    if (DEPENDENCY_PATH_PATTERNS.some(p => p.test(f))) { scores.dependency_package += 2; reasons.push(`dep_file:${f}`); }
    if (DOCS_PATH_PATTERNS.some(p => p.test(f))) { scores.docs_marketing += 2; reasons.push(`docs_file:${f}`); }
    if (RELEASE_PATH_PATTERNS.some(p => p.test(f))) { scores.release_readiness += 2; reasons.push(`release_file:${f}`); }
    if (ACTIVATION_PATH_PATTERNS.some(p => p.test(f))) { scores.activation_onboarding += 2; reasons.push(`activation_file:${f}`); }
    if (RECEIPT_PATH_PATTERNS.some(p => p.test(f))) { scores.dashboard_receipt += 2; reasons.push(`receipt_file:${f}`); }
    if (ROUTING_PATH_PATTERNS.some(p => p.test(f))) { scores.model_routing_control += 2; reasons.push(`routing_file:${f}`); }
  }

  if (changedFiles.length <= 3 && Object.values(scores).every(s => s <= 2)) {
    scores.quick_code_fix += 1;
  }

  let max = 0;
  let winner: WorkType = "unknown_mixed";
  for (const [type, score] of Object.entries(scores)) {
    if (score > max) { max = score; winner = type as WorkType; }
  }

  if (max === 0) {
    return { workType: "unknown_mixed", reasons: ["no_pattern_match"] };
  }

  const uniqueReasons = [...new Set(reasons)].slice(0, 10);
  return { workType: winner, reasons: uniqueReasons };
}

function buildRequiredProof(workType: WorkType, caps: ProjectCapabilities): ProofRequirement[] {
  const req: ProofRequirement[] = [];
  const add = (id: string, desc: string, critical: boolean, adapter: string) => {
    req.push({ id, description: desc, critical, adapterId: adapter });
  };

  add("artifact_guard", "Artifact guard scan with no critical findings", true, "security-secrets");

  if (caps.build.available) {
    add("build_pass", "Build completes without errors", true, "build-test");
  }
  if (caps.test.available) {
    add("tests_pass", "Relevant tests pass", workType !== "docs_marketing", "build-test");
  }

  switch (workType) {
    case "ui_product_surface":
      add("product_surface", "No placeholder/fake/noisy copy in changed surfaces", true, "product-surface");
      if (caps.browserTooling.available) {
        add("browser_proof", "UI route opens without console errors", true, "ui-browser");
      }
      break;

    case "api_backend":
      if (caps.apiSchema.available) {
        add("api_contract", "API schema validation passes", true, "api-contract");
      }
      break;

    case "security_sensitive":
      add("secret_scan", "No secret patterns in changed files", true, "security-secrets");
      add("no_raw_secrets", "No raw secrets in receipts or output", true, "security-secrets");
      break;

    case "dependency_package":
      add("dep_audit", "Dependency audit shows no critical vulnerabilities", true, "security-secrets");
      break;

    case "docs_marketing":
      add("claims_check", "Claims match implemented capabilities", true, "product-surface");
      break;

    case "release_readiness":
      add("clean_worktree", "Git worktree is clean", true, "build-test");
      add("product_surface", "No launch-visible gaps", true, "product-surface");
      break;

    case "activation_onboarding":
    case "dashboard_receipt":
      add("product_surface", "No misleading states post-activation", true, "product-surface");
      break;

    case "model_routing_control":
      add("routing_proof", "Routing decisions verified by kernel", false, "build-test");
      break;
  }

  return req;
}

function buildOptionalProof(workType: WorkType, caps: ProjectCapabilities): ProofRequirement[] {
  const opt: ProofRequirement[] = [];

  if (caps.lint.available) {
    opt.push({ id: "lint_pass", description: "Lint checks pass", critical: false, adapterId: "build-test" });
  }
  if (caps.typecheck.available) {
    opt.push({ id: "typecheck_pass", description: "Type checking passes", critical: false, adapterId: "build-test" });
  }
  if (workType === "ui_product_surface" && !caps.browserTooling.available) {
    opt.push({ id: "manual_ui_check", description: "Manual UI verification recommended", critical: false, adapterId: "ui-browser" });
  }

  return opt;
}

function buildBlockedActions(workType: WorkType): string[] {
  const blocked = ["npm publish", "production deploy", "netlify deploy --prod"];
  if (workType === "security_sensitive") {
    blocked.push("commit secrets", "expose env variables");
  }
  return blocked;
}

function buildMissingCapabilities(caps: ProjectCapabilities): string[] {
  const missing: string[] = [];
  if (!caps.build.available) missing.push("No build command detected");
  if (!caps.test.available) missing.push("No test command detected");
  if (!caps.browserTooling.available) missing.push("No browser/E2E tooling detected");
  if (!caps.apiSchema.available) missing.push("No API schema detected");
  if (!caps.securityScanning.available) missing.push("No dedicated security scanning script");
  if (!caps.ciWorkflows.available) missing.push("No CI workflows detected");
  return missing;
}

function buildRecommendedCommands(caps: ProjectCapabilities): string[] {
  const cmds: string[] = [];
  if (caps.build.command) cmds.push(caps.build.command);
  if (caps.test.command) cmds.push(caps.test.command);
  if (caps.typecheck?.command) cmds.push(caps.typecheck.command);
  if (caps.lint?.command) cmds.push(caps.lint.command);
  cmds.push("npm audit");
  return cmds;
}

function buildClosureRules(workType: WorkType): string[] {
  const rules = [
    "Agent text is never proof",
    "All critical proof requirements must pass or have explicit skip reason",
    "Missing critical proof blocks safe-to-close",
  ];

  switch (workType) {
    case "ui_product_surface":
      rules.push("Build pass alone is insufficient — product surface check required");
      break;
    case "security_sensitive":
      rules.push("Security changes without secret scan cannot be safe to close");
      break;
    case "release_readiness":
      rules.push("Dirty worktree blocks release readiness");
      rules.push("No deploy/publish without owner approval");
      break;
    case "docs_marketing":
      rules.push("Claims must not exceed implemented capabilities");
      rules.push("No unsupported token/cost savings claims");
      break;
  }

  return rules;
}

export function generateProofContract(
  changedFiles: string[],
  capabilities: ProjectCapabilities,
  taskDescription?: string,
): ProofContract {
  const { workType, reasons } = inferWorkType(changedFiles);

  return {
    timestamp: new Date().toISOString(),
    workType,
    workTypeReasons: reasons,
    requiredProof: buildRequiredProof(workType, capabilities),
    optionalProof: buildOptionalProof(workType, capabilities),
    blockedActions: buildBlockedActions(workType),
    missingCapabilities: buildMissingCapabilities(capabilities),
    recommendedCommands: buildRecommendedCommands(capabilities),
    closureRules: buildClosureRules(workType),
    containsRawSecret: false,
  };
}

export function renderProofContract(contract: ProofContract): string {
  const lines = [
    `Proof Contract: ${contract.workType.replace(/_/g, " ")}`,
    "",
    "Required proof:",
  ];
  for (const r of contract.requiredProof) {
    lines.push(`  ${r.critical ? "[CRITICAL]" : "[optional]"} ${r.description}`);
  }
  if (contract.optionalProof.length > 0) {
    lines.push("");
    lines.push("Optional proof:");
    for (const r of contract.optionalProof) {
      lines.push(`  ${r.description}`);
    }
  }
  if (contract.missingCapabilities.length > 0) {
    lines.push("");
    lines.push("Missing capabilities:");
    for (const m of contract.missingCapabilities) {
      lines.push(`  - ${m}`);
    }
  }
  if (contract.blockedActions.length > 0) {
    lines.push("");
    lines.push("Blocked actions:");
    for (const b of contract.blockedActions) {
      lines.push(`  - ${b}`);
    }
  }
  lines.push("");
  lines.push("Closure rules:");
  for (const r of contract.closureRules) {
    lines.push(`  - ${r}`);
  }
  return lines.join("\n");
}
