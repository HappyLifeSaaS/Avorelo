// Avorelo Skill Operating System Registry. Every skill/repo/reference item individually catalogued.
// No group-level summaries. Every item has activation triggers, anti-triggers, cost, evidence, decision.

export type AdoptionDecision = "ACTIVE_EXECUTABLE_NOW" | "ACTIVE_DETERMINISTIC_GUARD" | "ACTIVE_CHECKLIST_NOW" | "ACTIVE_REFERENCE_NOW" | "AVORELO_NATIVE_REWRITE_NOW" | "MERGE_INTO_EXISTING_SKILL" | "BACKLOG_REQUIRES_BROWSER" | "BACKLOG_REQUIRES_TOOL_INSTALL" | "BACKLOG_REQUIRES_LICENSE_REVIEW" | "BACKLOG_REQUIRES_BENJAMIN_APPROVAL" | "BACKLOG_REQUIRES_CLOUD_AUTH" | "REJECT_UNSAFE" | "REJECT_DUPLICATE" | "REJECT_LICENSE_UNKNOWN" | "REJECT_NOT_RELEVANT" | "NEEDS_MORE_EVIDENCE";

export type RegistryItem = {
  id: string;
  name: string;
  category: string;
  sourceType: string;
  origin: string;
  sourcePath: string;
  summary: string;
  applicableLayers: string[];
  adoptionDecision: AdoptionDecision;
  adoptionMode: string;
  currentStatus: string;
  riskLevel: string;
  contextCost: string;
  latencyBudgetMs: number;
  sideEffectLevel: string;
  activationTriggers: string[];
  antiTriggers: string[];
  conflictsWith: string[];
  overlapsWith: string[];
  requiredEvidence: string[];
  dogfoodScenario: string;
  evidencePath: string;
  owner: string;
};

const r = (id: string, name: string, cat: string, srcType: string, origin: string, decision: AdoptionDecision, o: Partial<RegistryItem> = {}): RegistryItem => ({
  id, name, category: cat, sourceType: srcType, origin, sourcePath: o.sourcePath ?? "",
  summary: o.summary ?? name, applicableLayers: o.applicableLayers ?? ["Validation"],
  adoptionDecision: decision, adoptionMode: o.adoptionMode ?? decision.replace("ACTIVE_", "").replace("BACKLOG_REQUIRES_", "backlog:"),
  currentStatus: decision.startsWith("ACTIVE") || decision.startsWith("AVORELO") || decision === "MERGE_INTO_EXISTING_SKILL" ? "active" : decision.startsWith("BACKLOG") ? "backlog" : decision.startsWith("REJECT") ? "rejected" : "pending",
  riskLevel: o.riskLevel ?? "low", contextCost: o.contextCost ?? "low", latencyBudgetMs: o.latencyBudgetMs ?? 100,
  sideEffectLevel: o.sideEffectLevel ?? "read_only",
  activationTriggers: o.activationTriggers ?? ["on_relevant_change"],
  antiTriggers: o.antiTriggers ?? ["low_risk_docs_only"],
  conflictsWith: o.conflictsWith ?? [], overlapsWith: o.overlapsWith ?? [],
  requiredEvidence: o.requiredEvidence ?? ["test_or_dogfood"],
  dogfoodScenario: o.dogfoodScenario ?? "scenario_2_security",
  evidencePath: o.evidencePath ?? "", owner: o.owner ?? "validation",
});

export const REGISTRY: RegistryItem[] = [
  // === A. OLD REPO / PRIOR AVORELO ===
  r("sec-agent-visibility", "Agent Security Visibility Scan", "code_security", "avorelo_native_guard", "old_repo", "ACTIVE_DETERMINISTIC_GUARD",
    { sourcePath: "old-repo/agent-security-check", summary: "Skills/MCP/commands/config inventory + trust cards + risk diff + permission preview", applicableLayers: ["Kernel","Capability","Adapter","MCP"], activationTriggers: ["agent_config_change","mcp_change","skill_change","tool_change"], antiTriggers: ["docs_only","no_tool_config"], requiredEvidence: ["inventory_output","trust_card"], evidencePath: "dogfood:skills-os scenario 2" }),
  r("sec-rule-pack", "Security Rule Pack", "code_security", "avorelo_native_guard", "old_repo", "ACTIVE_DETERMINISTIC_GUARD",
    { sourcePath: "scripts/lib/security-scan.js", summary: "Remote include, unpinned git, overbroad permissions, private key, env file, generated page exposure", activationTriggers: ["security_file_change","package_change","config_change","public_page_change"], antiTriggers: ["docs_only"], evidencePath: "dogfood:skills-os scenario 2" }),
  r("sec-capability-registry", "Capability Registry / External Source Safety", "code_security", "avorelo_native_guard", "current_repo", "ACTIVE_DETERMINISTIC_GUARD",
    { sourcePath: "src/avorelo/kernel/registry/", summary: "Single ownership, license check, trust level, unknown=untrusted", applicableLayers: ["Kernel"], activationTriggers: ["capability_change","registry_change"], evidencePath: "tests/slice1.test.ts collision test" }),
  r("ux-visual-proof-pack", "Visual Proof / UX QA Pack", "visual_browser", "manual_checklist", "old_repo", "ACTIVE_CHECKLIST_NOW",
    { sourcePath: "old_repo scripts", summary: "Screenshot review, sidebar proof, bounding box, mobile, journey screenshots", applicableLayers: ["Surface","Browser"], activationTriggers: ["ui_change","dashboard_change","public_page_change"], antiTriggers: ["no_ui_change"], dogfoodScenario: "scenario_3_ui_no_browser" }),
  r("ux-visual-browser-exec", "Visual Proof Browser Execution", "visual_browser", "future_integration", "old_repo", "BACKLOG_REQUIRES_BROWSER",
    { summary: "Playwright screenshot journeys, visual regression, rendered proof", activationTriggers: ["ui_change_with_browser"], antiTriggers: ["browser_unavailable"], requiredEvidence: ["screenshot_artifacts"] }),

  // GStack skills (found locally)
  r("gstack-design-review", "GStack Design Review", "ux_accessibility", "external_framework", "external_reference", "ACTIVE_REFERENCE_NOW",
    { sourcePath: "~/.claude/skills/gstack", summary: "Design review skill reference", activationTriggers: ["ui_design_change"], antiTriggers: ["no_ui_change"] }),
  r("gstack-devex-review", "GStack DevEx Review", "code_quality", "external_framework", "external_reference", "ACTIVE_REFERENCE_NOW",
    { sourcePath: "~/.claude/skills/gstack", activationTriggers: ["developer_experience_change"] }),
  r("gstack-cso", "GStack CSO Security", "code_security", "external_framework", "external_reference", "ACTIVE_REFERENCE_NOW",
    { sourcePath: "~/.claude/skills/gstack", activationTriggers: ["security_change"] }),
  r("gstack-qa", "GStack QA", "code_quality", "external_framework", "external_reference", "ACTIVE_REFERENCE_NOW",
    { sourcePath: "~/.claude/skills/gstack", activationTriggers: ["quality_review"] }),
  r("gstack-review", "GStack Review", "code_quality", "external_framework", "external_reference", "ACTIVE_REFERENCE_NOW",
    { sourcePath: "~/.claude/skills/gstack", activationTriggers: ["code_review"] }),
  r("gstack-browse", "GStack Browse", "visual_browser", "external_framework", "external_reference", "BACKLOG_REQUIRES_BROWSER",
    { sourcePath: "~/.claude/skills/gstack", activationTriggers: ["browser_proof_needed"], antiTriggers: ["browser_unavailable"] }),
  r("gstack-guard", "GStack Guard", "code_security", "external_framework", "external_reference", "ACTIVE_REFERENCE_NOW",
    { sourcePath: "~/.claude/skills/gstack", activationTriggers: ["destructive_command"] }),
  r("gstack-skillify", "GStack Skillify", "ai_agent", "external_framework", "external_reference", "ACTIVE_REFERENCE_NOW",
    { sourcePath: "~/.claude/skills/gstack", activationTriggers: ["skill_creation"] }),

  // Agent/MCP security research
  r("agent-mcp-poison", "MCP Tool Poisoning Review", "mcp_tooling", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW",
    { summary: "Implicit tool poisoning, malicious MCP servers", activationTriggers: ["mcp_change","tool_config_change"] }),
  r("agent-malicious-skills", "Malicious Skills in the Wild", "mcp_tooling", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW",
    { summary: "Abandoned repo hijacking, MalSkillBench runtime-verified malicious skills", activationTriggers: ["external_skill_intake"] }),
  r("agent-openclaw", "OpenClaw Skills Marketplace Risks", "mcp_tooling", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW",
    { summary: "Marketplace trust model risks — Avorelo is NOT a marketplace", activationTriggers: ["skill_marketplace_discussion"] }),

  // === B. SECURITY / CODE SKILLS ===
  r("sec-codeql", "CodeQL-style SAST", "code_security", "future_integration", "external_reference", "BACKLOG_REQUIRES_TOOL_INSTALL",
    { contextCost: "high", latencyBudgetMs: 30000, activationTriggers: ["deep_security_review","launch_readiness"], antiTriggers: ["simple_change","low_risk"] }),
  r("sec-semgrep", "Semgrep Custom Rules", "code_security", "manual_checklist", "external_reference", "ACTIVE_CHECKLIST_NOW",
    { summary: "Custom security rule patterns as review checklist", activationTriggers: ["security_file_change"] }),
  r("sec-sonarqube", "SonarQube Code Quality", "code_quality", "future_integration", "external_reference", "BACKLOG_REQUIRES_TOOL_INSTALL",
    { contextCost: "high", latencyBudgetMs: 60000 }),
  r("sec-eslint", "ESLint Security Rules", "code_security", "future_integration", "external_reference", "BACKLOG_REQUIRES_TOOL_INSTALL",
    { summary: "Zero-dep repo has no ESLint yet" }),
  r("sec-ts-strict", "TypeScript Strictness Review", "code_quality", "manual_checklist", "current_repo", "ACTIVE_CHECKLIST_NOW",
    { activationTriggers: ["ts_file_change"], summary: "Check strict patterns, no any, proper types" }),
  r("sec-dep-boundary", "Dependency Boundary / Circular Import Review", "architecture", "manual_checklist", "current_repo", "ACTIVE_CHECKLIST_NOW",
    { applicableLayers: ["Kernel","Capability"], activationTriggers: ["import_structure_change"] }),
  r("sec-dead-code", "Dead Code / Unused Exports Review", "code_quality", "manual_checklist", "current_repo", "ACTIVE_CHECKLIST_NOW",
    { activationTriggers: ["refactoring","cleanup_task"] }),
  r("sec-complexity", "Complexity / Duplication Review", "code_quality", "manual_checklist", "external_reference", "ACTIVE_CHECKLIST_NOW",
    { activationTriggers: ["large_file_change","refactoring"] }),
  r("sec-test-quality", "Test Quality: Would Tests Fail", "code_quality", "manual_checklist", "external_reference", "ACTIVE_CHECKLIST_NOW",
    { summary: "Google Code Review: tests should fail if code broke", activationTriggers: ["test_change","feature_change"] }),
  r("sec-mutation-testing", "Mutation / Property-Based Testing", "code_quality", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW",
    { summary: "Reference for future test quality improvement" }),
  r("sec-gitleaks", "Gitleaks Secret Scanning", "secret_scanning", "manual_checklist", "external_reference", "ACTIVE_CHECKLIST_NOW",
    { summary: "Pattern checklist — Avorelo has built-in secret detection", overlapsWith: ["sec-capability-registry"], activationTriggers: ["secret_sensitive_change"] }),
  r("sec-trufflehog", "TruffleHog Secret Scanning", "secret_scanning", "future_integration", "external_reference", "MERGE_INTO_EXISTING_SKILL",
    { overlapsWith: ["secret-protection"], summary: "Covered by Avorelo secret-protection capability" }),
  r("sec-github-secret", "GitHub Secret Scanning", "secret_scanning", "future_integration", "external_reference", "MERGE_INTO_EXISTING_SKILL",
    { overlapsWith: ["secret-protection"] }),
  r("sec-gitguardian", "GitGuardian", "secret_scanning", "future_integration", "external_reference", "MERGE_INTO_EXISTING_SKILL",
    { overlapsWith: ["secret-protection"] }),
  r("sec-osv", "OSV / npm audit", "supply_chain", "future_integration", "external_reference", "BACKLOG_REQUIRES_TOOL_INSTALL",
    { summary: "Zero-dep repo — relevant post-dependency addition" }),
  r("sec-syft", "Syft SBOM", "supply_chain", "future_integration", "external_reference", "BACKLOG_REQUIRES_TOOL_INSTALL"),
  r("sec-grype", "Grype Vulnerability Scan", "supply_chain", "future_integration", "external_reference", "BACKLOG_REQUIRES_TOOL_INSTALL"),
  r("sec-cyclonedx", "CycloneDX / SPDX", "supply_chain", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW"),
  r("sec-deptrack", "Dependency-Track", "supply_chain", "future_integration", "external_reference", "BACKLOG_REQUIRES_TOOL_INSTALL"),
  r("sec-scorecard", "OpenSSF Scorecard", "supply_chain", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW",
    { summary: "Repo security posture reference criteria" }),
  r("sec-nist", "NIST SSDF SP 800-218", "code_security", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW",
    { summary: "Already used in reference-backed review", evidencePath: "review:references NIST skill" }),
  r("sec-owasp", "OWASP ASVS v4", "appsec", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW",
    { evidencePath: "review:references OWASP skill" }),
  r("sec-slsa", "SLSA Framework", "supply_chain", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW",
    { evidencePath: "review:references SLSA skill" }),
  r("sec-soc2", "SOC 2 Readiness Mapping", "code_security", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW",
    { summary: "Mapping only — NOT certification claim" }),
  r("sec-bughunter", "Claude-BugHunter", "code_security", "future_integration", "external_reference", "BACKLOG_REQUIRES_LICENSE_REVIEW",
    { summary: "License unknown — backlog pending review" }),
  r("sec-mcp-scan", "mcp-scan", "mcp_tooling", "manual_checklist", "external_reference", "ACTIVE_CHECKLIST_NOW",
    { activationTriggers: ["mcp_change","tool_config_change"] }),
  r("sec-agent-scan", "agent-scan", "mcp_tooling", "manual_checklist", "external_reference", "ACTIVE_CHECKLIST_NOW",
    { activationTriggers: ["agent_config_change"] }),
  r("sec-mcp-sandbox", "MCP-SandboxScan", "mcp_tooling", "manual_checklist", "external_reference", "ACTIVE_CHECKLIST_NOW"),
  r("sec-prompt-guard", "Prompt/Source/Secret Exposure Guard", "secret_scanning", "avorelo_native_guard", "current_repo", "ACTIVE_DETERMINISTIC_GUARD",
    { sourcePath: "src/avorelo/capabilities/secret-protection/", summary: "Built-in pre-context scan + redaction", evidencePath: "tests/slice1.test.ts + dogfood:core", activationTriggers: ["always_on_lightweight"] }),

  // === C. UX / ACCESSIBILITY ===
  r("ux-wcag", "WCAG Static Review", "ux_accessibility", "manual_checklist", "external_reference", "ACTIVE_CHECKLIST_NOW",
    { summary: "Headings, landmarks, aria, alt text — static inspection", activationTriggers: ["html_change","ui_change"], evidencePath: "review:references WCAG skill" }),
  r("ux-axe", "axe-core Accessibility", "ux_accessibility", "future_integration", "external_reference", "BACKLOG_REQUIRES_BROWSER"),
  r("ux-pa11y", "pa11y Accessibility", "ux_accessibility", "future_integration", "external_reference", "BACKLOG_REQUIRES_BROWSER"),
  r("ux-lighthouse", "Lighthouse / PageSpeed", "performance", "future_integration", "external_reference", "BACKLOG_REQUIRES_BROWSER"),
  r("ux-webvitals", "Web Vitals Reference", "performance", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW",
    { evidencePath: "review:references Web Vitals skill" }),
  r("ux-playwright", "Playwright Browser Journeys", "visual_browser", "future_integration", "external_reference", "BACKLOG_REQUIRES_BROWSER",
    { contextCost: "high", latencyBudgetMs: 30000 }),
  r("ux-visual-regression", "Visual Regression / Screenshot Diff", "visual_browser", "future_integration", "external_reference", "BACKLOG_REQUIRES_BROWSER"),
  r("ux-nng", "Nielsen Norman 10 Heuristics", "ux_accessibility", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW",
    { evidencePath: "review:references NN/g skill" }),
  r("ux-baymard", "Baymard Checkout/Pricing UX", "ux_accessibility", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW"),
  r("ux-dashboard-comprehension", "Dashboard Comprehension Review", "dashboard_truth", "manual_checklist", "current_repo", "ACTIVE_CHECKLIST_NOW",
    { activationTriggers: ["dashboard_change","receipt_schema_change"] }),
  r("ux-keyboard-focus", "Keyboard / Focus / Contrast Review", "ux_accessibility", "manual_checklist", "external_reference", "BACKLOG_REQUIRES_BROWSER",
    { summary: "Needs browser for interactive testing" }),
  r("ux-mobile-screenshot", "Mobile Screenshot Journey", "visual_browser", "future_integration", "external_reference", "BACKLOG_REQUIRES_BROWSER"),

  // === D. AI-AGENT / CODING-AGENT / TOOLS ===
  r("agent-addy", "Addy Osmani AI Engineering", "ai_agent", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW",
    { evidencePath: "review:references Addy skill" }),
  r("agent-claude-skills", "Claude Skills / SKILL.md", "ai_agent", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW"),
  r("agent-claude-hooks", "Claude Code Hooks", "ai_agent", "external_framework", "current_repo", "ACTIVE_REFERENCE_NOW",
    { summary: "Already integrated via claude-code adapter", evidencePath: "src/avorelo/adapters/claude-code/" }),
  r("agent-claude-memory", "Claude Code Memory", "ai_agent", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW"),
  r("agent-claude-subagents", "Claude Code Subagents", "ai_agent", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW"),
  r("agent-agents-md", "AGENTS.md / Codex Instructions", "ai_agent", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW"),
  r("agent-cursor-rules", "Cursor Rules", "ai_agent", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW"),
  r("agent-gemini-cli", "Gemini CLI / Antigravity", "ai_agent", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW"),
  r("agent-openhands", "OpenHands SDK Architecture", "architecture", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW"),
  r("agent-gittaskbench", "GitTaskBench", "ai_agent", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW"),
  r("agent-swe-skills", "SWE-Skills-Bench", "ai_agent", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW"),
  r("agent-mcp-eco", "MCP Ecosystem", "mcp_tooling", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW"),
  r("agent-otel", "OpenTelemetry Semantic Conventions", "telemetry", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW"),
  r("agent-headroom", "Headroom", "ai_work_economics", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW",
    { summary: "Token cost visibility reference — not executable adoption" }),
  r("agent-pointfive", "PointFive", "ai_work_economics", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW",
    { summary: "Validates AI coding overhead problem — reference only" }),
  r("agent-tank", "Tank Skills-MCP Supply Chain", "mcp_tooling", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW"),
  r("agent-factory", "Factory Agent Workflow", "ai_agent", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW"),
  r("agent-devin", "Devin Agent Workflow", "ai_agent", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW"),
  r("agent-replit", "Replit Agent", "ai_agent", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW"),
  r("agent-moderne", "Moderne Deterministic Analysis", "ai_agent", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW"),

  // === E. TOKEN / COST / CONTEXT ===
  r("tok-context-waste", "Context Waste Reduction", "ai_work_economics", "avorelo_native_guard", "current_repo", "MERGE_INTO_EXISTING_SKILL",
    { overlapsWith: ["context-budget"], summary: "Already in context-budget capability", evidencePath: "src/avorelo/capabilities/context-budget/" }),
  r("tok-repeated-setup", "Repeated Setup Reduction", "ai_work_economics", "avorelo_native_guard", "current_repo", "MERGE_INTO_EXISTING_SKILL",
    { overlapsWith: ["context-budget"] }),
  r("tok-stale-instruction", "Stale Instruction Reduction", "ai_work_economics", "avorelo_native_guard", "current_repo", "MERGE_INTO_EXISTING_SKILL",
    { overlapsWith: ["context-budget"] }),
  r("tok-tool-schema", "Tool Schema Overhead Reduction", "ai_work_economics", "avorelo_native_guard", "current_repo", "MERGE_INTO_EXISTING_SKILL",
    { overlapsWith: ["tool-governance"], evidencePath: "src/avorelo/capabilities/tool-governance/" }),
  r("tok-model-routing", "Model Routing", "ai_work_economics", "future_integration", "inferred_from_roadmap", "BACKLOG_REQUIRES_BENJAMIN_APPROVAL",
    { summary: "Routing infrastructure deferred" }),
  r("tok-exact-claim-guard", "Exact Savings Claim Guard", "ai_work_economics", "manual_checklist", "current_repo", "ACTIVE_CHECKLIST_NOW",
    { summary: "No unsupported % or ROI claims", activationTriggers: ["public_copy_change","value_claim_change"], evidencePath: "review:references AI Economics skill" }),

  // === F. ARCHITECTURE / REVIEW SKILLS ===
  r("rev-core-12", "Internal Review Skills (12)", "architecture", "internal_executable", "current_repo", "ACTIVE_EXECUTABLE_NOW",
    { summary: "12 internal governed review skills", evidencePath: "npm run review:core", activationTriggers: ["architecture_change","capability_change"] }),
  r("rev-refs-12", "Reference-Backed Review Skills (12)", "architecture", "internal_executable", "current_repo", "ACTIVE_EXECUTABLE_NOW",
    { summary: "12 reference-backed review skills (Google SRE, NIST, OWASP, etc)", evidencePath: "npm run review:references" }),
  r("rev-arch-8", "Architecture Evaluation Skills (8)", "architecture", "internal_executable", "current_repo", "ACTIVE_EXECUTABLE_NOW",
    { summary: "ATAM, SAAM, ISO 42010, arc42, Well-Architected, ISO 25010, DDD, fitness functions", evidencePath: "npm run review:architecture-deep" }),
  r("rev-google-code", "Google Code Review", "code_quality", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW",
    { evidencePath: "review:references Google Code Health skill" }),
  r("rev-google-sre", "Google SRE", "architecture", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW",
    { evidencePath: "review:references Google SRE skill" }),
  r("rev-c4", "C4 Model", "architecture", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW"),
  r("rev-adr", "ADR Decision Records", "architecture", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW"),
  r("rev-iso25010", "ISO/IEC 25010 Quality", "architecture", "research_reference", "external_reference", "ACTIVE_REFERENCE_NOW"),
];

export const REGISTRY_COUNT = REGISTRY.length;
const VALID_DECISIONS = new Set<string>(["ACTIVE_EXECUTABLE_NOW","ACTIVE_DETERMINISTIC_GUARD","ACTIVE_CHECKLIST_NOW","ACTIVE_REFERENCE_NOW","AVORELO_NATIVE_REWRITE_NOW","MERGE_INTO_EXISTING_SKILL","BACKLOG_REQUIRES_BROWSER","BACKLOG_REQUIRES_TOOL_INSTALL","BACKLOG_REQUIRES_LICENSE_REVIEW","BACKLOG_REQUIRES_BENJAMIN_APPROVAL","BACKLOG_REQUIRES_CLOUD_AUTH","REJECT_UNSAFE","REJECT_DUPLICATE","REJECT_LICENSE_UNKNOWN","REJECT_NOT_RELEVANT","NEEDS_MORE_EVIDENCE"]);
export function getUnknownCount(): number {
  return REGISTRY.filter(i =>
    !i.adoptionDecision || !VALID_DECISIONS.has(i.adoptionDecision) ||
    !i.category || !i.sourceType || !i.activationTriggers?.length ||
    !i.antiTriggers?.length || !i.requiredEvidence?.length ||
    !i.contextCost || !i.owner
  ).length;
}
export function getByDecision(d: AdoptionDecision): RegistryItem[] { return REGISTRY.filter(i => i.adoptionDecision === d); }
export function getByCategory(c: string): RegistryItem[] { return REGISTRY.filter(i => i.category === c); }
