// Avorelo Enriched WorkContract + Safe Routing (Phase 3, Layer 2). Deterministic. Consumes the Layer-1
// Secret Boundary (Phase 2) — it does NOT reimplement it. Hard invariants:
//   - routing can never turn a Secret Boundary BLOCK into allow (routingCannotOverrideSafetyBoundary),
//   - token/cost optimization can never LOWER the proof tier (tokenOptimizationCannotOverrideProof).

import { parseTaskToContract, classifyTask, extractPaths } from "./task-parser.ts";
import { evaluateSafeRun } from "../../capabilities/secret-boundary/safe-run.ts";
import { detectInString } from "../../capabilities/secret-boundary/detector.ts";
import { redactString } from "../../capabilities/secret-boundary/redactor.ts";
import { classifySource } from "../../capabilities/secret-boundary/source-trust.ts";
import { scanInstructionRisk } from "../../capabilities/secret-boundary/instruction-risk.ts";
import { PROOF_ORDER } from "../../shared/schemas/index.ts";
import type {
  EnrichedWorkContract,
  RiskClass,
  Route,
  ProofTier,
  ApprovalPolicy,
  SafetyBoundarySummary,
  CostPolicy,
} from "../../shared/schemas/index.ts";

const COST_POLICY: CostPolicy = {
  preferDeterministic: true,
  avoidDeepModelUnlessNeeded: true,
  tokenOptimizationCannotOverrideProof: true,
  routingCannotOverrideSafetyBoundary: true,
};

// Sensitive surfaces — touching these raises risk + proof tier.
const SENSITIVE = /\b(auth|login|signup|session|token|billing|payment|invoice|subscription|webhook|secret|credential|security|permission|drizzle|migration|\.env|deploy|production|prod)\b/i;
const AUTH_BILLING_SECURITY = /\b(auth|login|signup|billing|payment|invoice|subscription|webhook|security|permission|credential)\b/i;
const DEPLOY = /\b(deploy|publish|release|ship to prod|production)\b/i;
const BROWSER_PROD_CLAIM = /\b(browser|e2e|end[- ]to[- ]end|in production|on prod|live site|user[- ]facing)\b/i;
const BROAD_SCOPE = /\b(refactor (the )?(whole|entire|app|codebase|everything)|rewrite everything|migrate everything|overhaul|all files)\b/i;

export const PROOF_RANK = (t: ProofTier): number => PROOF_ORDER.indexOf(t);

/** Raise to the higher of two proof tiers (proof FLOOR — never lowers). */
export function maxProof(a: ProofTier, b: ProofTier): ProofTier {
  return PROOF_RANK(a) >= PROOF_RANK(b) ? a : b;
}

/**
 * Attempt a cost-driven proof reduction. By invariant this is a NO-OP downward: the returned tier is never
 * lower than the current tier. Exposed so callers/tests can prove cost optimization cannot lower proof.
 */
export function applyCostProofFloor(current: ProofTier, desiredCheaper: ProofTier): ProofTier {
  return maxProof(current, desiredCheaper); // can only keep or raise — never lower
}

export type RouteInput = { task: string; dir: string; planTier?: "Free" | "Pro" | "Teams" };

/** Build the Layer-1 safety summary for a task (sanitized — codes/decisions only). */
function safetySummary(task: string): SafetyBoundarySummary {
  const safeRun = evaluateSafeRun(task);
  const secretRiskCodes = Array.from(new Set(detectInString(task).map((f) => f.code)));
  const trust = classifySource({ origin: "user prompt" });
  const instr = scanInstructionRisk(task, { sourceClass: "user_supplied" });
  // Map safe-run category onto a boundary decision label.
  const secretBoundaryDecision =
    safeRun.decision === "block" ? "block" : safeRun.decision === "require_approval" ? "require_approval" : secretRiskCodes.length ? "redact" : "allow";
  return {
    secretBoundaryDecision,
    secretRiskCodes,
    safeRunDecision: safeRun.decision,
    sourceTrustRisk: trust.trustLevel,
    instructionRisk: instr.codes,
  };
}

function isAmbiguous(task: string): boolean {
  const t = task.trim();
  return t.length === 0 || t.split(/\s+/).length < 2;
}

/**
 * Enrich a task into a routed WorkContract. Deterministic; consumes the Secret Boundary; never overrides it.
 */
/**
 * Redacted, display/session-safe version of a task string. Secret substrings become [REDACTED:<CODE>].
 * Use this anywhere the task is printed, persisted, or passed into session/model context.
 */
export function sanitizeTask(task: string): string {
  return redactString(task ?? "", "instruction", "task").redacted;
}

export function routeWorkContract(input: RouteInput): EnrichedWorkContract {
  const task = input.task ?? "";
  // Classification/detection run on the RAW task in-memory only; the raw task is NEVER stored on the
  // contract. The contract's objective is the redacted label so a credential pasted into the task text
  // cannot leak through serialization, receipts, or session context.
  const base = parseTaskToContract(task, input.dir);
  base.objective = sanitizeTask(task);
  const taskType = classifyTask(task);
  const paths = extractPaths(task);
  const safety = safetySummary(task);

  let riskClass: RiskClass = "low";
  let route: Route = "deterministic_only";
  let proofTier: ProofTier = "local";
  let approvalPolicy: ApprovalPolicy = "none";
  const nonGoals: string[] = [];

  const text = `${task} ${paths.join(" ")}`;
  const touchesSensitive = SENSITIVE.test(text);
  const touchesAuthBilling = AUTH_BILLING_SECURITY.test(text);
  const isRemediation = safety.safeRunDecision === "allow" && /\b(fix|remediate|remove|scrub|clean up)\b/i.test(task) && /\b(leak|leaked|exposed|secret|token|key|credential)\b/i.test(task);

  // 1) Secret exfiltration / Secret Boundary BLOCK — fail closed, highest precedence. Nothing overrides this.
  if (safety.safeRunDecision === "block") {
    return assemble(base, {
      riskClass: "critical", route: "blocked", proofTier: "none", approvalPolicy: "blocked",
      nonGoals: ["Never print, dump, or exfiltrate secret values"], safety, paths,
    });
  }

  // 2) Secret remediation — safe edit, but proof + (manual review if sensitive).
  if (isRemediation) {
    riskClass = touchesSensitive ? "critical" : "high";
    route = "targeted_code_edit";
    proofTier = maxProof("tests", touchesAuthBilling ? "tests" : "local");
    approvalPolicy = touchesSensitive ? "require_manual_review" : "require_confirmation";
    nonGoals.push("Do not expose the raw secret value; reference it safely");
    return assemble(base, { riskClass, route, proofTier, approvalPolicy, nonGoals, safety, paths });
  }

  // 3) Ambiguous / missing objective, or broad scope -> needs_decision.
  if (isAmbiguous(task) || BROAD_SCOPE.test(task)) {
    riskClass = "medium";
    route = "needs_decision";
    proofTier = "tests";
    approvalPolicy = "require_confirmation";
    nonGoals.push("Do not begin broad changes before scope is confirmed");
    return assemble(base, { riskClass, route, proofTier, approvalPolicy, nonGoals, safety, paths });
  }

  // 4) Deploy / production -> high/critical, needs decision + manual review.
  if (DEPLOY.test(text) || taskType === "deployment") {
    riskClass = "critical";
    route = "needs_decision";
    proofTier = "production";
    approvalPolicy = "require_manual_review";
    nonGoals.push("No autonomous production deployment");
    return assemble(base, { riskClass, route, proofTier, approvalPolicy, nonGoals, safety, paths });
  }

  // 5) Browser / production claim -> browser proof required (never local-only).
  if (BROWSER_PROD_CLAIM.test(text)) {
    riskClass = "high";
    route = "browser_proof_required";
    proofTier = "browser";
    approvalPolicy = "require_confirmation";
    return assemble(base, { riskClass, route, proofTier, approvalPolicy, nonGoals, safety, paths });
  }

  // 6) Auth/billing/security-sensitive files -> raise risk + proof tier.
  if (touchesAuthBilling || taskType === "security") {
    riskClass = "high";
    route = "targeted_code_edit";
    proofTier = "tests";
    approvalPolicy = "require_manual_review";
    return assemble(base, { riskClass, route, proofTier, approvalPolicy, nonGoals, safety, paths });
  }

  // 7) Normal docs/test/build tasks -> low/medium, deterministic/targeted.
  if (taskType === "testing" || taskType === "docs" || /\b(run )?(tests?|build|lint|typecheck)\b/i.test(task)) {
    riskClass = "low";
    route = taskType === "docs" ? "targeted_code_edit" : "deterministic_only";
    proofTier = taskType === "testing" || /\btests?\b/i.test(task) ? "tests" : "local";
    approvalPolicy = "none";
    return assemble(base, { riskClass, route, proofTier, approvalPolicy, nonGoals, safety, paths });
  }

  // 8) Default: a normal, scoped code task.
  riskClass = touchesSensitive ? "high" : "medium";
  route = "targeted_code_edit";
  proofTier = touchesSensitive ? "tests" : "local";
  approvalPolicy = touchesSensitive ? "require_confirmation" : "none";
  return assemble(base, { riskClass, route, proofTier, approvalPolicy, nonGoals, safety, paths });
}

function assemble(
  base: ReturnType<typeof parseTaskToContract>,
  p: { riskClass: RiskClass; route: Route; proofTier: ProofTier; approvalPolicy: ApprovalPolicy; nonGoals: string[]; safety: SafetyBoundarySummary; paths: string[] },
): EnrichedWorkContract {
  // INVARIANT: routing can never override the Safety Boundary. If the boundary blocks, force blocked/none/blocked.
  let route = p.route;
  let proofTier = p.proofTier;
  let approvalPolicy = p.approvalPolicy;
  let riskClass = p.riskClass;
  if (p.safety.safeRunDecision === "block") {
    route = "blocked"; proofTier = "none"; approvalPolicy = "blocked"; riskClass = "critical";
  } else if (p.safety.safeRunDecision === "require_approval" && approvalPolicy === "none") {
    approvalPolicy = "require_manual_review";
  }
  // A raw credential pasted into the task text (even without exfil wording) is sensitive: escalate to at
  // least manual review + high risk so the raw task is never auto-run / printed, and force proof >= tests.
  if (route !== "blocked" && p.safety.secretRiskCodes.length > 0) {
    if (approvalPolicy === "none" || approvalPolicy === "require_confirmation") approvalPolicy = "require_manual_review";
    if (riskClass === "low" || riskClass === "medium") riskClass = "high";
    proofTier = maxProof(proofTier, "tests");
  }
  return {
    ...base,
    nonGoals: p.nonGoals,
    disallowedPaths: deriveDisallowed(p.paths),
    riskClass,
    route,
    proofTier,
    approvalPolicy,
    safetyBoundary: p.safety,
    costPolicy: COST_POLICY,
  };
}

// Sensitive paths are disallowed-by-default unless the task explicitly named them.
function deriveDisallowed(namedPaths: string[]): string[] {
  const base = [".env", ".env.*", "**/.ssh/**", "**/*.pem", "**/id_rsa"];
  return base.filter((d) => !namedPaths.some((p) => p.includes(d.replace(/\*+/g, ""))));
}

export type RoutingDecision = {
  contract: EnrichedWorkContract;
  gate: "allow" | "require_approval" | "blocked";
  summary: string;
  displayTask: string; // redacted task label — safe for stdout, persistence, and session/model context
};

/** Convenience: route + a compact gate decision for the CLI/session boundary. */
export function decideRouting(input: RouteInput): RoutingDecision {
  const contract = routeWorkContract(input);
  const gate = contract.route === "blocked" ? "blocked" : contract.approvalPolicy === "blocked" ? "blocked" : contract.approvalPolicy === "require_manual_review" || contract.approvalPolicy === "require_confirmation" ? "require_approval" : "allow";
  const summary = `risk=${contract.riskClass} route=${contract.route} proof=${contract.proofTier} approval=${contract.approvalPolicy}`;
  // contract.objective is already the redacted/sanitized task label.
  return { contract, gate, summary, displayTask: contract.objective };
}
