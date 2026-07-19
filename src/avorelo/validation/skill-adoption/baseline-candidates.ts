// Avorelo Baseline Skill/Repo Adoption Candidates. Every candidate has a decision — no UNKNOWN.
import type { Candidate } from "./index.ts";

// Helper for concise definitions
const c = (id: string, name: string, sourceType: Candidate["sourceType"], category: Candidate["category"], layers: Candidate["applicableLayers"], decision: Candidate["decision"], overrides: Partial<Candidate> = {}): Candidate => ({
  id, name, sourceType, sourceUrl: overrides.sourceUrl ?? "", licenseStatus: overrides.licenseStatus ?? "known_ok",
  provenance: overrides.provenance ?? "community", category, targetUseCase: overrides.targetUseCase ?? name,
  applicableLayers: layers, expectedValue: overrides.expectedValue ?? `Improves ${category}`,
  expectedRisk: overrides.expectedRisk ?? "low", contextCost: overrides.contextCost ?? "low",
  sideEffectLevel: overrides.sideEffectLevel ?? "read_only", conflictsWith: overrides.conflictsWith ?? [],
  overlapsWith: overrides.overlapsWith ?? [], decision, rationale: overrides.rationale ?? "",
  owner: overrides.owner ?? "validation", status: "evaluated",
});

export const baselineCandidates: Candidate[] = [
  // === Security / Code ===
  c("sec-old-scan", "Agent Security Scan (old repo)", "old_repo_artifact", "agent_security", ["Validation"], "ADOPT_AS_AVORELO_NATIVE_REWRITE", { provenance: "old_repo", rationale: "Rewrite old security scan patterns into kernel-governed checks" }),
  c("sec-old-rules", "Security Rule Pack (old repo)", "old_repo_artifact", "code_security", ["Validation"], "ADOPT_AS_AVORELO_NATIVE_REWRITE", { provenance: "old_repo" }),
  c("sec-codeql", "CodeQL-style SAST", "external_repo", "code_security", ["Validation"], "DEFER_BACKLOG", { contextCost: "high", rationale: "Valuable but high setup/CI cost — backlog for post-launch" }),
  c("sec-semgrep", "Semgrep custom rules", "tool", "code_security", ["Validation"], "ADOPT_CHECKLIST_NOW", { rationale: "Checklist of security patterns; no executable dependency needed now" }),
  c("sec-sonarqube", "SonarQube-style quality", "tool", "code_security", ["Validation"], "DEFER_BACKLOG", { contextCost: "high", rationale: "Heavy tool — backlog" }),
  c("sec-eslint", "ESLint security rules", "tool", "code_security", ["Validation"], "DEFER_BACKLOG", { rationale: "Zero-dep repo has no ESLint — backlog until build tooling added" }),
  c("sec-ts-strict", "TypeScript strictness", "checklist", "code_security", ["Kernel", "Capability"], "ADOPT_CHECKLIST_NOW", { rationale: "Checklist: verify strict patterns in code review" }),
  c("sec-dep-boundary", "Dependency boundary review", "checklist", "architecture", ["Kernel", "Capability"], "ADOPT_CHECKLIST_NOW", { rationale: "Review circular imports and layer violations" }),
  c("sec-dead-code", "Dead code / unused exports", "checklist", "architecture", ["Kernel", "Capability"], "ADOPT_CHECKLIST_NOW", { rationale: "Manual or future tooling" }),
  c("sec-gitleaks", "Gitleaks secret scanning", "tool", "secret_scanning", ["Validation"], "ADOPT_CHECKLIST_NOW", { rationale: "Pattern checklist; Avorelo has built-in secret detection" }),
  c("sec-trufflehog", "TruffleHog secret scanning", "tool", "secret_scanning", ["Validation"], "MERGE_INTO_EXISTING_SKILL", { rationale: "Avorelo secret-protection already covers this", overlapsWith: ["secret-protection"] }),
  c("sec-gitguardian", "GitGuardian", "tool", "secret_scanning", ["Validation"], "MERGE_INTO_EXISTING_SKILL", { overlapsWith: ["secret-protection"] }),
  c("sec-osv", "OSV/npm audit", "tool", "supply_chain", ["Validation"], "DEFER_BACKLOG", { rationale: "Zero-dep repo — relevant post-dependency addition" }),
  c("sec-syft", "Syft SBOM", "tool", "supply_chain", ["Validation"], "DEFER_BACKLOG", { rationale: "SBOM relevant at publish time" }),
  c("sec-grype", "Grype vulnerability scan", "tool", "supply_chain", ["Validation"], "DEFER_BACKLOG"),
  c("sec-cyclonedx", "CycloneDX/SPDX", "framework", "supply_chain", ["Docs"], "ADOPT_AS_REFERENCE", { rationale: "Reference for future SBOM format" }),
  c("sec-deptrack", "Dependency-Track", "tool", "supply_chain", ["Validation"], "DEFER_BACKLOG"),
  c("sec-scorecard", "OpenSSF Scorecard", "framework", "supply_chain", ["Validation"], "ADOPT_AS_REFERENCE", { rationale: "Reference criteria for repo security posture" }),
  c("sec-bughunter", "Claude-BugHunter", "tool", "code_security", ["Validation"], "DEFER_BACKLOG", { licenseStatus: "unknown", rationale: "License unknown — backlog pending review" }),
  c("sec-mcp-scan", "mcp-scan", "tool", "mcp_security", ["Validation"], "ADOPT_CHECKLIST_NOW", { rationale: "MCP security patterns as checklist" }),
  c("sec-agent-scan", "agent-scan", "tool", "agent_security", ["Validation"], "ADOPT_CHECKLIST_NOW"),
  c("sec-mcp-sandbox", "MCP-SandboxScan", "tool", "mcp_security", ["Validation"], "ADOPT_CHECKLIST_NOW"),
  c("sec-mcp-poison", "MCP tool poisoning review", "research_reference", "mcp_security", ["Docs"], "ADOPT_AS_REFERENCE"),
  c("sec-abandoned", "Abandoned skill repo review", "checklist", "agent_security", ["Validation"], "ADOPT_CHECKLIST_NOW"),
  c("sec-prompt-guard", "Prompt/source/secret exposure guard", "old_repo_artifact", "secret_scanning", ["Kernel"], "MERGE_INTO_EXISTING_SKILL", { overlapsWith: ["secret-protection", "redaction"] }),

  // === UX / Visual Proof ===
  c("ux-old-vqa", "Visual QA pack (old repo)", "old_repo_artifact", "visual_proof", ["Validation", "Browser"], "ADOPT_AS_AVORELO_NATIVE_REWRITE", { provenance: "old_repo" }),
  c("ux-playwright", "Playwright screenshot journeys", "tool", "visual_proof", ["Validation", "Browser"], "DEFER_BACKLOG", { contextCost: "high", rationale: "Browser tool unavailable — backlog" }),
  c("ux-visual-regression", "Visual regression/screenshot diff", "tool", "visual_proof", ["Validation"], "DEFER_BACKLOG"),
  c("ux-lighthouse", "Lighthouse/PageSpeed", "tool", "performance", ["Validation", "Browser"], "DEFER_BACKLOG", { rationale: "Browser required — backlog" }),
  c("ux-webvitals", "Web Vitals", "framework", "performance", ["Docs"], "ADOPT_AS_REFERENCE"),
  c("ux-axe", "axe-core accessibility", "tool", "accessibility", ["Validation", "Browser"], "DEFER_BACKLOG", { rationale: "Browser required" }),
  c("ux-pa11y", "pa11y accessibility", "tool", "accessibility", ["Validation"], "DEFER_BACKLOG"),
  c("ux-wcag", "WCAG static review", "checklist", "accessibility", ["Validation"], "ADOPT_CHECKLIST_NOW"),
  c("ux-nng", "NN/g 10 Heuristics", "research_reference", "ux", ["Docs"], "ADOPT_AS_REFERENCE"),
  c("ux-baymard", "Baymard checkout/pricing UX", "research_reference", "ux", ["Docs"], "ADOPT_AS_REFERENCE"),
  c("ux-dashboard-review", "Dashboard comprehension review", "checklist", "dashboard_truth", ["Validation"], "ADOPT_CHECKLIST_NOW"),

  // === AI Agent / Skills / MCP ===
  c("agent-claude-hooks", "Claude Code hooks", "framework", "skill_routing", ["Kernel", "Adapter"], "ADOPT_AS_REFERENCE", { provenance: "official", rationale: "Already integrated via claude-code adapter" }),
  c("agent-claude-skills", "Claude Skills / SKILL.md", "framework", "skill_routing", ["Docs"], "ADOPT_AS_REFERENCE", { provenance: "official" }),
  c("agent-agents-md", "AGENTS.md / Codex instructions", "framework", "skill_routing", ["Docs"], "ADOPT_AS_REFERENCE"),
  c("agent-cursor-rules", "Cursor rules", "framework", "skill_routing", ["Docs"], "ADOPT_AS_REFERENCE"),
  c("agent-openhands", "OpenHands SDK architecture", "research_reference", "architecture", ["Docs"], "ADOPT_AS_REFERENCE"),
  c("agent-swe-skills", "SWE-Skills-Bench", "benchmark", "skill_routing", ["Docs"], "ADOPT_AS_REFERENCE"),
  c("agent-mcp-eco", "MCP ecosystem", "framework", "mcp_security", ["Docs", "Adapter"], "ADOPT_AS_REFERENCE"),
  c("agent-headroom", "Headroom", "external_repo", "token_cost_optimization", ["Capability"], "ADOPT_AS_REFERENCE", { rationale: "Token cost reference — not executable adoption" }),
  c("agent-pointfive", "PointFive", "external_repo", "token_cost_optimization", ["Docs"], "ADOPT_AS_REFERENCE", { rationale: "Validates AI coding overhead problem — reference only" }),
  c("agent-otel", "OpenTelemetry semantic conventions", "framework", "telemetry", ["Docs"], "ADOPT_AS_REFERENCE"),

  // === Token / Cost / Context ===
  c("tok-context-waste", "Context waste reduction", "product_pattern", "context_budget", ["Capability"], "MERGE_INTO_EXISTING_SKILL", { overlapsWith: ["context-budget"], rationale: "Already in context-budget capability" }),
  c("tok-repeated-setup", "Repeated setup reduction", "product_pattern", "context_budget", ["Capability"], "MERGE_INTO_EXISTING_SKILL", { overlapsWith: ["context-budget"] }),
  c("tok-stale-instruction", "Stale instruction reduction", "product_pattern", "context_budget", ["Capability"], "MERGE_INTO_EXISTING_SKILL", { overlapsWith: ["context-budget"] }),
  c("tok-tool-schema", "Tool schema overhead reduction", "product_pattern", "tool_governance", ["Capability"], "MERGE_INTO_EXISTING_SKILL", { overlapsWith: ["tool-governance"] }),
  c("tok-model-routing", "Model routing", "product_pattern", "model_routing", ["Capability"], "DEFER_BACKLOG", { rationale: "Routing infrastructure deferred" }),
  c("tok-exact-claim", "Exact savings claim guard", "checklist", "ai_work_economics", ["Validation"], "ADOPT_CHECKLIST_NOW", { rationale: "Enforced by value measurement system" }),
];

export const BASELINE_COUNT = baselineCandidates.length;
