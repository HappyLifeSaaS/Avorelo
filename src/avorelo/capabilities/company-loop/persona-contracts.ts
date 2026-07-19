// Avorelo Skill-Backed Persona Contracts. Each persona maps to specific Avorelo
// skills/capabilities/scanners. Personas produce findings from evidence, not hardcoded text.
// Reference: MetaGPT SOP roles, CrewAI role/goal/tools, AutoGen declarative agents.
// Avorelo adaptation: local-first, deterministic-first, no external agent framework.

export type PersonaId = "product_manager" | "qa_verification" | "ux_design" | "security" | "devex" | "cost_cogs" | "support_cs" | "marketing_growth" | "architecture" | "product_research" | "launch_readiness";

export type PersonaContract = {
  personaId: PersonaId;
  role: string;
  mission: string;
  scope: string[];
  requiredSkills: string[];
  optionalSkills: string[];
  requiredCapabilities: string[];
  requiredScanners: string[];
  deterministicFirst: boolean;
  modelProfileAllowed: string;
  forbiddenActions: string[];
  requiredEvidence: string[];
  outputFields: string[];
  escalationRules: string[];
};

export const PERSONA_CONTRACTS: PersonaContract[] = [
  {
    personaId: "product_manager", role: "Product Manager", mission: "Assess product wiring, activation readiness, value proof, and public claims",
    scope: ["product_journey", "activation", "value_proof", "public_claims"],
    requiredSkills: ["product-journey-e2e", "claims-scanner", "site-check"],
    optionalSkills: ["activation-readiness"],
    requiredCapabilities: ["production-confidence"],
    requiredScanners: ["claims"],
    deterministicFirst: true, modelProfileAllowed: "standard_synthesis",
    forbiddenActions: ["declare_product_market_fit", "claim_customer_count", "fake_activation"],
    requiredEvidence: ["journey_test_output", "claims_scan_output", "site_check_output"],
    outputFields: ["activationStatus", "journeyStatus", "claimsStatus", "proofGaps"],
    escalationRules: ["missing_activation_blocks_launch", "unsupported_claim_blocks_publish"],
  },
  {
    personaId: "qa_verification", role: "QA / Verification", mission: "Validate test coverage, dogfood health, proof quality, and receipt integrity",
    scope: ["tests", "dogfood", "proof", "receipts"],
    requiredSkills: ["test-runner", "dogfood-core", "receipt-validation"],
    optionalSkills: ["mutation-testing-ref"],
    requiredCapabilities: ["production-confidence", "local-dashboard"],
    requiredScanners: [],
    deterministicFirst: true, modelProfileAllowed: "none",
    forbiddenActions: ["weaken_tests", "skip_dogfood", "fake_proof"],
    requiredEvidence: ["test_count", "test_pass_rate", "dogfood_output", "receipt_count"],
    outputFields: ["testCount", "passRate", "dogfoodStatus", "proofCoverage", "receiptHealth"],
    escalationRules: ["test_failure_blocks_merge", "dogfood_failure_blocks_merge"],
  },
  {
    personaId: "ux_design", role: "UX / Design", mission: "Review visual quality, accessibility, dashboard comprehension, and product journey clarity",
    scope: ["visual_proof", "accessibility", "dashboard", "journey"],
    requiredSkills: ["wcag-checklist", "dashboard-comprehension", "nng-heuristics"],
    optionalSkills: ["playwright-proof", "lighthouse-ref", "axe-ref"],
    requiredCapabilities: ["local-dashboard"],
    requiredScanners: ["generated-exposure"],
    deterministicFirst: true, modelProfileAllowed: "standard_synthesis",
    forbiddenActions: ["approve_without_visual_proof", "fake_screenshot"],
    requiredEvidence: ["page_check_output", "accessibility_checklist", "journey_test"],
    outputFields: ["pagesChecked", "a11yStatus", "dashboardStatus", "browserProofStatus"],
    escalationRules: ["browser_unavailable_creates_hold"],
  },
  {
    personaId: "security", role: "Security", mission: "Verify secret protection, scanner health, MCP/tool governance, and exposure prevention",
    scope: ["secrets", "scanners", "mcp", "tool_governance", "exposure"],
    requiredSkills: ["scanner-system", "secret-protection", "mcp-scan-checklist", "agent-security"],
    optionalSkills: ["codeql-ref", "semgrep-checklist", "gitleaks-checklist"],
    requiredCapabilities: ["secret-protection", "tool-governance"],
    requiredScanners: ["secret-patterns", "env-exposure", "permissions", "claims", "generated-exposure"],
    deterministicFirst: true, modelProfileAllowed: "security_sensitive_review",
    forbiddenActions: ["ignore_scanner_findings", "bypass_secret_protection", "claim_secure_without_evidence"],
    requiredEvidence: ["scanner_output", "secret_scan_output", "tool_governance_output"],
    outputFields: ["scannerFindings", "secretStatus", "mcpStatus", "toolGovernanceStatus", "exposureStatus"],
    escalationRules: ["high_finding_blocks_merge", "secret_leak_blocks_all"],
  },
  {
    personaId: "devex", role: "DevEx", mission: "Assess developer experience, CLI usability, zero-dep compliance, and local-first integrity",
    scope: ["cli", "preview", "zero_dep", "local_first"],
    requiredSkills: ["site-preview", "naming-check"],
    optionalSkills: [],
    requiredCapabilities: [],
    requiredScanners: [],
    deterministicFirst: true, modelProfileAllowed: "none",
    forbiddenActions: ["add_heavy_dependency", "break_zero_dep"],
    requiredEvidence: ["preview_smoke", "naming_check_output"],
    outputFields: ["cliStatus", "previewStatus", "namingStatus", "dependencyCount"],
    escalationRules: ["naming_leak_blocks_merge"],
  },
  {
    personaId: "cost_cogs", role: "Cost / COGS", mission: "Track context budget, tool governance efficiency, and AI work economics value",
    scope: ["context_budget", "tool_governance", "value_measurement"],
    requiredSkills: ["context-budget", "tool-governance", "value-measurement"],
    optionalSkills: ["headroom-ref", "pointfive-ref"],
    requiredCapabilities: ["context-budget", "tool-governance"],
    requiredScanners: [],
    deterministicFirst: true, modelProfileAllowed: "none",
    forbiddenActions: ["claim_exact_savings_without_evidence", "override_proof_for_cost"],
    requiredEvidence: ["context_budget_output", "tool_governance_output", "value_measurement_output"],
    outputFields: ["contextDrivers", "toolsExposed", "toolsDeferred", "tokenEstimate", "confidenceLabel"],
    escalationRules: ["unsupported_savings_claim_blocked"],
  },
  {
    personaId: "support_cs", role: "Support / CS", mission: "Assess support readiness, contact flow, and feedback signal health",
    scope: ["support", "contact", "feedback"],
    requiredSkills: ["journey-contact-check"],
    optionalSkills: [],
    requiredCapabilities: [],
    requiredScanners: [],
    deterministicFirst: true, modelProfileAllowed: "none",
    forbiddenActions: ["fake_support_ticket", "fake_customer_data"],
    requiredEvidence: ["contact_page_status"],
    outputFields: ["contactPageStatus", "feedbackSignalCount", "supportReadiness"],
    escalationRules: [],
  },
  {
    personaId: "marketing_growth", role: "Marketing / Growth", mission: "Verify public positioning, claims integrity, and landing page honesty",
    scope: ["public_copy", "claims", "positioning", "landing"],
    requiredSkills: ["claims-scanner", "positioning-check"],
    optionalSkills: [],
    requiredCapabilities: [],
    requiredScanners: ["claims"],
    deterministicFirst: true, modelProfileAllowed: "standard_synthesis",
    forbiddenActions: ["unsupported_roi_claim", "fake_user_count", "token_savings_first_positioning"],
    requiredEvidence: ["claims_scan_output", "landing_hero_check"],
    outputFields: ["positioningStatus", "claimsStatus", "heroMatch", "forbiddenClaimsFound"],
    escalationRules: ["forbidden_claim_blocks_publish"],
  },
  {
    personaId: "architecture", role: "Architecture", mission: "Validate Kernel/Capability/Adapter/Surface split, THE ONE RULE, and layer ownership",
    scope: ["kernel", "capabilities", "adapters", "surfaces", "ownership"],
    requiredSkills: ["review-core", "review-references", "review-architecture-deep", "review-skills-os"],
    optionalSkills: [],
    requiredCapabilities: [],
    requiredScanners: [],
    deterministicFirst: true, modelProfileAllowed: "none",
    forbiddenActions: ["bypass_kernel", "surface_creates_truth", "duplicate_truth_owner"],
    requiredEvidence: ["review_core_output", "review_references_output", "review_architecture_output"],
    outputFields: ["kernelOwnership", "theOneRule", "layerViolations", "collisionCount"],
    escalationRules: ["the_one_rule_violation_blocks_merge"],
  },
  {
    personaId: "product_research", role: "Product Research / Customer Learning", mission: "Identify friction clusters, repeated blockers, and roadmap candidates from signals",
    scope: ["friction", "blockers", "roadmap", "learning"],
    requiredSkills: ["feedback-analysis"],
    optionalSkills: [],
    requiredCapabilities: [],
    requiredScanners: [],
    deterministicFirst: true, modelProfileAllowed: "cheap_classification",
    forbiddenActions: ["fake_customer_insight", "claim_product_market_fit"],
    requiredEvidence: ["feedback_signal_count", "friction_cluster_count"],
    outputFields: ["frictionClusters", "repeatedBlockers", "roadmapCandidates", "learningSignals"],
    escalationRules: [],
  },
  {
    personaId: "launch_readiness", role: "Launch / Production Readiness", mission: "Assess production confidence, tool re-attachment, deploy readiness, and public distribution truth",
    scope: ["production_confidence", "tool_reattachment", "deploy", "distribution"],
    requiredSkills: ["production-confidence-check", "tool-reattachment-check"],
    optionalSkills: [],
    requiredCapabilities: ["production-confidence"],
    requiredScanners: [],
    deterministicFirst: true, modelProfileAllowed: "none",
    forbiddenActions: ["claim_production_ready_without_evidence", "deploy", "npm_publish"],
    requiredEvidence: ["production_confidence_status", "tool_reattachment_status", "ci_status"],
    outputFields: ["productionConfidence", "toolReattachment", "deployStatus", "npmStatus", "ciStatus"],
    escalationRules: ["production_confidence_missing_blocks_launch"],
  },
];

export const PERSONA_COUNT = PERSONA_CONTRACTS.length;
