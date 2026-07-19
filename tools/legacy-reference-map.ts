// Avorelo Legacy Reference Map — Canonical Activation Slice.
// Structured map of what was inherited/adapted/rejected from HappyLifeSaaS/ClaudeCode-Optimizer.

export type LegacyAdoptionDecision =
  | "INHERITED_AS_IS"
  | "ADAPT"
  | "REIMPLEMENT"
  | "REFERENCE_ONLY"
  | "REJECT"
  | "HOLD";

export type LegacyReference = {
  area: string;
  legacyRepo: "HappyLifeSaaS/ClaudeCode-Optimizer";
  legacyPaths: string[];
  currentTargetPaths: string[];
  decision: LegacyAdoptionDecision;
  reason: string;
  activationImpact: string;
  productionImpact: string;
  mustNotInherit: string[];
  requiredProof: string[];
};

export const LEGACY_CANONICAL_ACTIVATION_REFERENCES: readonly LegacyReference[] = [
  {
    area: "activation-command",
    legacyRepo: "HappyLifeSaaS/ClaudeCode-Optimizer",
    legacyPaths: [
      "bin/avorelo",
      "scripts/lib/public-cli.js",
    ],
    currentTargetPaths: [
      "src/avorelo/surfaces/cli/avorelo.ts",
      "src/avorelo/capabilities/activation/index.ts",
      "src/avorelo/capabilities/activation/activation-state.ts",
    ],
    decision: "ADAPT",
    reason: "Old repo dispatches activate through public-cli.js. New repo has its own CLI with kernel-backed activation. Default activation must be local-first/free without hook install.",
    activationImpact: "Required for Canonical Activation",
    productionImpact: "HOLD",
    mustNotInherit: ["old repo readiness truth", "production claims", ".claude/cco state path", "wuz/cco naming"],
    requiredProof: ["activation state written to .avorelo/activation/activation-state.json", "status reads state", "idempotent rerun"],
  },
  {
    area: "activation-state",
    legacyRepo: "HappyLifeSaaS/ClaudeCode-Optimizer",
    legacyPaths: [
      "scripts/lib/activation/activation-state.js",
      "scripts/lib/activation/activation-summary.js",
    ],
    currentTargetPaths: [
      "src/avorelo/capabilities/activation/activation-state.ts",
      ".avorelo/activation/activation-state.json",
    ],
    decision: "REIMPLEMENT",
    reason: "Old repo stores state at .claude/cco/state/activation.json with a different schema (version/status/project/environment/account/firstValue). New repo uses AvoreloActivationStateV1 contract at .avorelo/activation/activation-state.json with billing/cloud/production holds.",
    activationImpact: "Required — new contract is canonical",
    productionImpact: "HOLD",
    mustNotInherit: [".claude/cco path", "old schema version field", "account.connected/plan field", "old firstValue model"],
    requiredProof: ["state written with correct contract", "state is redacted", "billing/auth/cloud are false", "productionReady is false"],
  },
  {
    area: "activation-runner-self-healing",
    legacyRepo: "HappyLifeSaaS/ClaudeCode-Optimizer",
    legacyPaths: [
      "scripts/lib/activation/activation-runner.js",
      "scripts/lib/activation/activation-self-healing.js",
      "scripts/lib/activation/repair-engine.js",
      "scripts/lib/activation/detect-environment.js",
    ],
    currentTargetPaths: [
      "src/avorelo/capabilities/activation/index.ts",
      "src/avorelo/capabilities/activation/activation-state.ts",
    ],
    decision: "ADAPT",
    reason: "Old repo has extensive self-healing (gitignore patterns, readiness checks, repair engine). New repo adapts the concepts: workspace detection, writable-dir probe, git detection. Repair is simplified to state re-creation.",
    activationImpact: "Adapted concepts in activation-state.ts buildActivationState + verifyActivationState",
    productionImpact: "HOLD",
    mustNotInherit: ["ensureCcoDirs", ".claude/cco dir creation", "old ACTIVATION_CONTRACT version", "MAX_REPAIR_ATTEMPTS loop"],
    requiredProof: ["workspace detection works", ".avorelo dir writable", "corrupt state gives safe repair message"],
  },
  {
    area: "status-command",
    legacyRepo: "HappyLifeSaaS/ClaudeCode-Optimizer",
    legacyPaths: [
      "scripts/cco-status.js",
    ],
    currentTargetPaths: [
      "src/avorelo/surfaces/cli/avorelo.ts",
    ],
    decision: "REIMPLEMENT",
    reason: "Old status reads .claude/cco/state/ and builds a dashboard with score/value-summary/plan-surface. New status reads .avorelo/activation/activation-state.json and prints compact truthful status.",
    activationImpact: "Required — status must read activation state",
    productionImpact: "HOLD",
    mustNotInherit: ["cco-status imports", ".claude/cco/state/last-score.json", "buildStatusDashboard", "buildValueSummary"],
    requiredProof: ["status reads activation state", "shows activation mode", "shows billing/auth/cloud not live", "shows production not ready"],
  },
  {
    area: "open-dashboard-command",
    legacyRepo: "HappyLifeSaaS/ClaudeCode-Optimizer",
    legacyPaths: [
      "scripts/cco-dashboard.js",
    ],
    currentTargetPaths: [
      "src/avorelo/surfaces/cli/avorelo.ts",
      "src/avorelo/capabilities/local-dashboard/index.ts",
    ],
    decision: "ADAPT",
    reason: "Old dashboard reads activation-summary + workspace-map. New dashboard reads local receipts. The existing open command already works via local-dashboard capability.",
    activationImpact: "Already functional — receipts-based dashboard",
    productionImpact: "HOLD",
    mustNotInherit: ["cco-dashboard imports", "buildEffectivenessScorecard", "old platform adapter"],
    requiredProof: ["open reads/generates local dashboard", "no cloud login required"],
  },
  {
    area: "local-dashboard",
    legacyRepo: "HappyLifeSaaS/ClaudeCode-Optimizer",
    legacyPaths: [
      "scripts/lib/dashboard.js",
    ],
    currentTargetPaths: [
      "src/avorelo/capabilities/local-dashboard/index.ts",
    ],
    decision: "REIMPLEMENT",
    reason: "New repo has its own receipt-based local dashboard with truth rules (STOP_DONE without OUTCOME+POST_ACTION = needs_attention). Fundamentally different from old dashboard.",
    activationImpact: "Already implemented in new architecture",
    productionImpact: "HOLD",
    mustNotInherit: ["old dashboard.js", "old buildStatusDashboard"],
    requiredProof: ["dashboard reads receipts", "renders HTML/text/JSON"],
  },
  {
    area: "public-landing-page",
    legacyRepo: "HappyLifeSaaS/ClaudeCode-Optimizer",
    legacyPaths: [
      "apps/public-web/src/index.html",
    ],
    currentTargetPaths: [
      "src/avorelo/surfaces/public-web/static/index.html",
    ],
    decision: "INHERITED_AS_IS",
    reason: "Landing page was explicitly inherited and approved as canonical static content in the new repo.",
    activationImpact: "None — already canonical",
    productionImpact: "None",
    mustNotInherit: [],
    requiredProof: ["landing page builds", "no fake metrics", "no production claims"],
  },
  {
    area: "pricing-page",
    legacyRepo: "HappyLifeSaaS/ClaudeCode-Optimizer",
    legacyPaths: [
      "apps/public-web/src/pricing.html",
    ],
    currentTargetPaths: [
      "src/avorelo/surfaces/public-web/static/pricing.html",
    ],
    decision: "INHERITED_AS_IS",
    reason: "Pricing page was explicitly inherited. Shows Free/$12-Pro/$120-year/Teams-waitlist.",
    activationImpact: "None — already canonical",
    productionImpact: "None — billing not live",
    mustNotInherit: [],
    requiredProof: ["pricing builds", "does not imply live checkout", "Lemon Squeezy mentioned as future provider only"],
  },
  {
    area: "lemon-squeezy-adapter",
    legacyRepo: "HappyLifeSaaS/ClaudeCode-Optimizer",
    legacyPaths: [
      "src/avorelo-hub/billing/billing-adapter.ts",
    ],
    currentTargetPaths: [
      "src/avorelo/adapters/lemon-squeezy/index.ts",
      "src/avorelo/capabilities/payment-readiness/index.ts",
    ],
    decision: "HOLD",
    reason: "New repo already has a test-mode Lemon Squeezy adapter. Old billing-adapter.ts has getCheckoutUrl/getCustomerPortalUrl/isConfigured. Not connecting live billing in this slice.",
    activationImpact: "None — billing not required for activation",
    productionImpact: "HOLD — must connect before production",
    mustNotInherit: ["live LS credentials", "live checkout sessions", "live webhooks"],
    requiredProof: ["billingLive=false", "checkoutConfigured=false", "webhookConfigured=false"],
  },
  {
    area: "hub-auth-wasp-cloud",
    legacyRepo: "HappyLifeSaaS/ClaudeCode-Optimizer",
    legacyPaths: [
      "main.wasp",
      "schema.prisma",
      "src/avorelo-hub/operations.ts",
      "src/avorelo-hub/pages/OverviewPage.tsx",
      "src/avorelo-hub/pages/HistoryPage.tsx",
      "src/avorelo-hub/pages/SettingsPage.tsx",
      "src/avorelo-hub/pages/SupportPage.tsx",
    ],
    currentTargetPaths: [],
    decision: "HOLD",
    reason: "Wasp/Prisma/Hub is the cloud app stack. Not applicable to this local-first slice. Will be reconsidered for auth/cloud slice.",
    activationImpact: "None — local-first does not need cloud",
    productionImpact: "HOLD — auth/cloud required for production",
    mustNotInherit: ["Wasp framework", "Prisma schema", "hub operations", "live auth"],
    requiredProof: ["authLive=false", "cloudSyncLive=false"],
  },
  {
    area: "product-entitlements-cache",
    legacyRepo: "HappyLifeSaaS/ClaudeCode-Optimizer",
    legacyPaths: [
      "src/product-system/catalog.ts",
      "src/product-system/service.ts",
      "src/product-system/operations.ts",
    ],
    currentTargetPaths: [],
    decision: "REFERENCE_ONLY",
    reason: "Old product-system paths do not exist in old repo (searched, not found). Entitlements are defined in shared/schemas as PlanTier Free/Pro/Teams in new repo.",
    activationImpact: "None",
    productionImpact: "REFERENCE_ONLY",
    mustNotInherit: [],
    requiredProof: [],
  },
  {
    area: "receipts-events-run-entry",
    legacyRepo: "HappyLifeSaaS/ClaudeCode-Optimizer",
    legacyPaths: [
      "scripts/lib/activation/run-entry.js",
    ],
    currentTargetPaths: [
      "src/avorelo/kernel/receipts/index.ts",
      "src/avorelo/kernel/state-ledger/index.ts",
      ".avorelo/receipts/",
      ".avorelo/events/",
    ],
    decision: "REIMPLEMENT",
    reason: "run-entry.js does not exist in old repo. New repo has its own receipt writer (allowlist-only, SHA256 digest, redacted) and state ledger (immutable events). Fundamentally different architecture.",
    activationImpact: "Already implemented — activation writes receipt",
    productionImpact: "HOLD",
    mustNotInherit: [],
    requiredProof: ["receipt written and redacted", "no raw prompts/secrets"],
  },
  {
    area: "founder-admin-truth",
    legacyRepo: "HappyLifeSaaS/ClaudeCode-Optimizer",
    legacyPaths: [
      "src/founder/FounderConsolePage.tsx",
      "src/founder/operations.ts",
    ],
    currentTargetPaths: [
      "tools/generate-founder.ts",
      "src/avorelo/surfaces/public-web/static/founder.html",
      "src/avorelo/capabilities/company-loop/persona-runner.ts",
    ],
    decision: "REIMPLEMENT",
    reason: "Old founder is a Wasp/React page with runtime queries. New founder is a generated static HTML page from company-loop data. Fundamentally different: generated vs runtime.",
    activationImpact: "Update to show activation state and PASS_WITH_HOLDS distinction",
    productionImpact: "HOLD",
    mustNotInherit: ["Wasp operations", "React components", "runtime auth queries"],
    requiredProof: ["Founder shows activation allowed", "shows production NOT READY", "shows billing/auth NOT LIVE", "PASS_WITH_HOLDS visually distinct"],
  },
  {
    area: "company-loop-integration",
    legacyRepo: "HappyLifeSaaS/ClaudeCode-Optimizer",
    legacyPaths: [
      "scripts/lib/company-loop.js",
    ],
    currentTargetPaths: [
      "src/avorelo/capabilities/company-loop/index.ts",
      "src/avorelo/capabilities/company-loop/persona-runner.ts",
      "src/avorelo/capabilities/company-loop/persona-contracts.ts",
    ],
    decision: "REIMPLEMENT",
    reason: "New repo has its own 10-persona company loop consuming SkillOutputs. Old company-loop.js is a simpler script. New architecture is fundamentally different.",
    activationImpact: "Update to consume activation SkillOutputs",
    productionImpact: "HOLD",
    mustNotInherit: ["old company-loop.js", "old persona definitions"],
    requiredProof: ["Company Loop consumes activation outputs", "PM persona improves", "Revenue persona keeps HOLD"],
  },
  {
    area: "production-readiness-blockers",
    legacyRepo: "HappyLifeSaaS/ClaudeCode-Optimizer",
    legacyPaths: [],
    currentTargetPaths: [
      "docs/qa/production-readiness-gate.md",
      "src/avorelo/capabilities/production-confidence/index.ts",
    ],
    decision: "HOLD",
    reason: "Production readiness requires live billing, auth, cloud sync, deploy, npm publish — none of which are in this slice.",
    activationImpact: "None — activation is non-production",
    productionImpact: "HOLD — all production blockers remain",
    mustNotInherit: ["production claims", "deploy state", "npm publish state"],
    requiredProof: ["productionReady=false", "production readiness gate doc exists"],
  },
  {
    area: "legacy-naming-cleanup",
    legacyRepo: "HappyLifeSaaS/ClaudeCode-Optimizer",
    legacyPaths: [
      "scripts/wuz-activate.js",
      "scripts/wuz-doctor.js",
      "scripts/wuz-post-run.js",
      "scripts/wuz-score.js",
    ],
    currentTargetPaths: [
      "tools/naming-check.ts",
    ],
    decision: "REJECT",
    reason: "All Wuz/CCO/ClaudeCode-Optimizer naming is rejected. New repo enforces naming via naming-check.ts which scans src/avorelo for legacy tokens.",
    activationImpact: "naming-check must pass",
    productionImpact: "naming-check must pass",
    mustNotInherit: ["wuz prefix", "cco prefix", "ClaudeCode-Optimizer references in public surfaces"],
    requiredProof: ["naming-check passes", "no public leakage"],
  },
  {
    area: "duplicate-conflict-cleanup",
    legacyRepo: "HappyLifeSaaS/ClaudeCode-Optimizer",
    legacyPaths: [
      ".claude/cco/state/activation.json",
    ],
    currentTargetPaths: [
      ".avorelo/activation/activation-state.json",
    ],
    decision: "REJECT",
    reason: ".claude/cco is the old state model. .avorelo is the new canonical state model. They must not coexist as truth sources.",
    activationImpact: ".avorelo/activation/activation-state.json is the only canonical state",
    productionImpact: "HOLD",
    mustNotInherit: [".claude/cco as truth source"],
    requiredProof: ["activation state at .avorelo path", "no .claude/cco creation"],
  },
] as const;
