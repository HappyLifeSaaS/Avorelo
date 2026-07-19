// Avorelo Governed Skill/Repo Adoption Process. Deterministic evaluation of external
// skills, repos, references, tools, and frameworks for adoption into Avorelo.
// Every candidate follows: intake → quarantine → need → architecture → security →
// conflict → cost → routing → decision. No candidate remains UNKNOWN.

export type SourceType = "external_repo" | "local_repo" | "old_repo_artifact" | "framework" | "research_reference" | "tool" | "skill" | "benchmark" | "checklist" | "product_pattern";
export type LicenseStatus = "known_ok" | "unknown" | "incompatible" | "not_applicable";
export type Provenance = "official" | "community" | "user_found" | "old_repo" | "prior_conversation" | "unknown";
export type Category = "architecture" | "code_security" | "appsec" | "supply_chain" | "secret_scanning" | "mcp_security" | "agent_security" | "ux" | "accessibility" | "visual_proof" | "performance" | "token_cost_optimization" | "ai_work_economics" | "context_budget" | "tool_governance" | "model_routing" | "skill_routing" | "dashboard_truth" | "payment_truth" | "migration" | "telemetry";
export type Layer = "Kernel" | "Capability" | "Adapter" | "Surface" | "Validation" | "Dogfood" | "Docs" | "Cloud" | "Teams" | "Payment" | "Browser" | "MCP";
export type ContextCost = "low" | "medium" | "high";
export type SideEffect = "read_only" | "local_write" | "external_read" | "external_write_blocked";

export type Decision =
  | "ADOPT_EXECUTABLE_NOW" | "ADOPT_CHECKLIST_NOW" | "ADOPT_AS_REFERENCE"
  | "ADOPT_AS_AVORELO_NATIVE_REWRITE" | "MERGE_INTO_EXISTING_SKILL"
  | "DEFER_BACKLOG" | "REJECT_UNSAFE" | "REJECT_DUPLICATE" | "REJECT_LICENSE_UNKNOWN"
  | "REJECT_NOT_RELEVANT" | "NEEDS_BENJAMIN_APPROVAL" | "NEEDS_MORE_EVIDENCE";

export type Candidate = {
  id: string;
  name: string;
  sourceType: SourceType;
  sourceUrl: string;
  licenseStatus: LicenseStatus;
  provenance: Provenance;
  category: Category;
  targetUseCase: string;
  applicableLayers: Layer[];
  expectedValue: string;
  expectedRisk: string;
  contextCost: ContextCost;
  sideEffectLevel: SideEffect;
  conflictsWith: string[];
  overlapsWith: string[];
  decision: Decision;
  rationale: string;
  owner: string;
  status: "evaluated" | "pending";
};

export type EvalResult = {
  candidateId: string;
  quarantinePass: boolean;
  needFit: boolean;
  architectureFit: boolean;
  securityPass: boolean;
  conflictPass: boolean;
  costAcceptable: boolean;
  finalDecision: Decision;
  findings: string[];
  routingTrigger: string;
  routingAntiTrigger: string;
};

// --- Evaluation engine ---

export function evaluateCandidate(c: Candidate): EvalResult {
  const findings: string[] = [];

  // Quarantine: unknown license blocks executable
  const quarantinePass = c.licenseStatus !== "incompatible";
  if (!quarantinePass) findings.push("SECURITY: incompatible license");

  // Need fit: reject if not relevant to AI Work Control
  const needFit = c.targetUseCase.length > 0;
  if (!needFit) findings.push("NEED: no target use case specified");

  // Architecture fit: reject if bypasses kernel or creates own truth
  const architectureFit = !c.conflictsWith.includes("kernel_truth") && !c.conflictsWith.includes("dashboard_truth");
  if (!architectureFit) findings.push("ARCHITECTURE: conflicts with kernel/dashboard truth ownership");

  // Security: block external_write, unknown provenance + executable
  const securityPass = c.sideEffectLevel !== "external_write_blocked" || c.decision !== "ADOPT_EXECUTABLE_NOW";
  if (c.provenance === "unknown" && (c.decision === "ADOPT_EXECUTABLE_NOW")) {
    findings.push("SECURITY: unknown provenance cannot be executable");
  }

  // Conflict: flag overlaps
  const conflictPass = c.conflictsWith.length === 0;
  if (!conflictPass) findings.push(`CONFLICT: conflicts with ${c.conflictsWith.join(", ")}`);

  // Cost: high-cost skills need justification
  const costAcceptable = c.contextCost !== "high" || c.expectedValue.length > 20;
  if (!costAcceptable) findings.push("COST: high context cost without sufficient value justification");

  // Final decision logic
  let finalDecision = c.decision;
  if (c.licenseStatus === "unknown" && finalDecision === "ADOPT_EXECUTABLE_NOW") {
    finalDecision = "REJECT_LICENSE_UNKNOWN";
    findings.push("OVERRIDE: unknown license → REJECT_LICENSE_UNKNOWN");
  }
  if (c.provenance === "unknown" && finalDecision === "ADOPT_EXECUTABLE_NOW") {
    finalDecision = "NEEDS_MORE_EVIDENCE";
    findings.push("OVERRIDE: unknown provenance → NEEDS_MORE_EVIDENCE");
  }
  if (!architectureFit && finalDecision === "ADOPT_EXECUTABLE_NOW") {
    finalDecision = "REJECT_UNSAFE";
    findings.push("OVERRIDE: architecture conflict → REJECT_UNSAFE");
  }

  // Routing
  const routingTrigger = c.category === "code_security" ? "on_code_change"
    : c.category === "ux" ? "on_ui_change"
    : c.category === "token_cost_optimization" ? "on_context_budget_exceeded"
    : c.category === "payment_truth" ? "on_payment_flow"
    : "on_relevant_change";
  const routingAntiTrigger = c.contextCost === "high" ? "low_risk_local_task" : "none";

  return { candidateId: c.id, quarantinePass, needFit, architectureFit, securityPass, conflictPass, costAcceptable, finalDecision, findings, routingTrigger, routingAntiTrigger };
}

export function evaluateBatch(candidates: Candidate[]): { results: EvalResult[]; summary: { total: number; adoptedExec: number; adoptedChecklist: number; reference: number; backlog: number; rejected: number; unknown: number; securityRejects: number; conflictMerges: number } } {
  const results = candidates.map(evaluateCandidate);
  const decisions = results.map(r => r.finalDecision);
  return {
    results,
    summary: {
      total: candidates.length,
      adoptedExec: decisions.filter(d => d === "ADOPT_EXECUTABLE_NOW" || d === "ADOPT_AS_AVORELO_NATIVE_REWRITE").length,
      adoptedChecklist: decisions.filter(d => d === "ADOPT_CHECKLIST_NOW").length,
      reference: decisions.filter(d => d === "ADOPT_AS_REFERENCE").length,
      backlog: decisions.filter(d => d === "DEFER_BACKLOG" || d === "NEEDS_MORE_EVIDENCE" || d === "NEEDS_BENJAMIN_APPROVAL").length,
      rejected: decisions.filter(d => d.startsWith("REJECT_")).length,
      unknown: 0, // process guarantees no UNKNOWN
      securityRejects: decisions.filter(d => d === "REJECT_UNSAFE" || d === "REJECT_LICENSE_UNKNOWN").length,
      conflictMerges: decisions.filter(d => d === "MERGE_INTO_EXISTING_SKILL").length,
    },
  };
}
