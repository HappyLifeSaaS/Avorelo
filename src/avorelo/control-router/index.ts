// Avorelo Unified Control Router. Composes primitive/model/skill/scanner/capability routing
// into a single machine-readable decision. Deterministic-first. Kernel owns final truth.

import { routeCanonical, routePrimitive, type CanonicalRoutingResult, type ModelRoutingProjection, type RoutingTaskFrame, type PrimitiveRouteDecision } from "../kernel/model-routing/index.ts";
import { buildCapabilityRouteDecision, detectProposalHints, evaluateActionWorthiness } from "../kernel/work-controls/index.ts";
import { planToolExecution, type ToolAdapterId } from "../kernel/tool-adapters/index.ts";
import { routeSkills, type TaskFrame as SkillFrame } from "../validation/skill-operating-system/router.ts";
import { runAllScanners } from "../validation/scanners/index.ts";
import type { ActionWorthinessDecision, CapabilityRouteDecision } from "../shared/schemas/index.ts";

export type UnifiedTaskFrame = RoutingTaskFrame & {
  changedFiles: string[];
  userIntent: string;
  localOnly: boolean;
  userPlan: string;
  founderCockpitTouched: boolean;
  aiTeamTouched: boolean;
  feedbackLoopTouched: boolean;
  oldRepoReferenceUsed: boolean;
  installedTools: string[];
  contextBudgetRemaining: number;
  tokenBudgetRemaining: number;
};

export type ToolAdapterRouting = {
  selectedAdapter: ToolAdapterId;
  executionMode: string;
  fallbackAdapters: ToolAdapterId[];
  approvalRequired: boolean;
  proofRequired: boolean;
  toolMayExecute: boolean;
  reasonCodes: string[];
};

export type UnifiedRouteDecision = PrimitiveRouteDecision & {
  selectedCapabilities: string[];
  selectedAdapters: string[];
  selectedSurfaces: string[];
  skippedCapabilities: string[];
  requiredApprovals: string[];
  expectedEvidence: string[];
  skippedScanners: string[];
  surfaceProjectionAllowed: boolean;
  modelMayAssist: boolean;
  modelMayDecide: boolean;
  scannerMayDecide: boolean;
  finalDecisionOwner: string;
  nextAction: string;
  skillRouteSelected: number;
  skillRouteSkipped: number;
  scannerResults: { ran: number; findings: number; stubs: number };
  capabilityRoute: CapabilityRouteDecision;
  actionWorthiness: ActionWorthinessDecision;
  canonicalRouting?: CanonicalRoutingResult;
  modelRoutingProjection?: ModelRoutingProjection;
  toolAdapterRouting?: ToolAdapterRouting;
};

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function unifiedRoute(frame: UnifiedTaskFrame): UnifiedRouteDecision {
  // 1. Primitive routing (computed once, shared with canonical kernel)
  const primitiveRoute = routePrimitive(frame);

  // 1b. Canonical model routing (reuses primitiveRoute — no duplicate primitive computation)
  let canonical: CanonicalRoutingResult | undefined;
  try {
    canonical = routeCanonical({ frame, approvalPolicy: "none", precomputedPrimitive: primitiveRoute });
  } catch { /* non-fatal: canonical routing is additive */ }

  // 2. Skill routing (translate frame)
  const skillFrame: SkillFrame = {
    taskType: frame.taskType,
    changedFiles: frame.changedFiles,
    touchedLayers: frame.touchedLayers,
    riskClass: frame.riskClass,
    browserAvailable: frame.browserAvailable,
    deepMode: frame.deepMode,
    paymentTouched: frame.paymentTouched,
    dashboardTouched: frame.dashboardTouched,
    publicCopyTouched: frame.publicCopyTouched,
    mcpTouched: frame.mcpTouched,
    skillConfigTouched: frame.externalToolsAllowed,
  };
  const skillRoute = routeSkills(skillFrame);

  const proposalHints = detectProposalHints(frame.userIntent, frame.changedFiles);
  const capabilityRoute = buildCapabilityRouteDecision({
    taskType: frame.taskType,
    riskClass: frame.riskClass,
    proofTier: frame.proofRequired ? "tests" : "local",
    approvalPolicy: primitiveRoute.approvalRequired ? "require_manual_review" : "none",
    proposalHints,
    touchedLayers: frame.touchedLayers,
    paymentTouched: frame.paymentTouched,
    authTouched: frame.authTouched,
    dashboardTouched: frame.dashboardTouched,
    publicCopyTouched: frame.publicCopyTouched,
    mcpTouched: frame.mcpTouched,
    deepMode: frame.deepMode,
    browserAvailable: frame.browserAvailable,
    founderCockpitTouched: frame.founderCockpitTouched,
    aiTeamTouched: frame.aiTeamTouched,
    oldRepoReferenceUsed: frame.oldRepoReferenceUsed,
    contextBudgetRemaining: frame.contextBudgetRemaining,
    tokenBudgetRemaining: frame.tokenBudgetRemaining,
  });
  const actionWorthiness = evaluateActionWorthiness({
    objective: frame.userIntent,
    riskClass: frame.riskClass,
    approvalPolicy: primitiveRoute.approvalRequired ? "require_manual_review" : "none",
    proposalHints,
    changedFiles: frame.changedFiles,
  });

  // 3. Scanner routing (run built-in if selected by primitive)
  let scannerResults = { ran: 0, findings: 0, stubs: 0 };
  if (primitiveRoute.selectedScanners.length > 0 || frame.riskClass === "high" || frame.deepMode) {
    const sr = runAllScanners();
    scannerResults = { ran: sr.summary.ran, findings: sr.summary.findings, stubs: sr.summary.total - sr.summary.ran };
  }

  // 4. Adapter selection
  const adapters: string[] = [];
  if (frame.browserAvailable && frame.dashboardTouched) adapters.push("browser");
  if (frame.mcpTouched) adapters.push("mcp");

  // 5. Surface projection
  const surfaces: string[] = ["cli"];
  if (frame.dashboardTouched) surfaces.push("local-dashboard");
  if (frame.founderCockpitTouched) surfaces.push("founder-cockpit");

  // 6. Compose hard rules
  const modelMayAssist = primitiveRoute.selectedModelProfile !== "none";
  const modelMayDecide = false;
  const scannerMayDecide = false;
  const finalDecisionOwner = "kernel/stop-continue-gate";

  // 7. Old repo block
  if (frame.oldRepoReferenceUsed) {
    primitiveRoute.reasonCodes.push("OLD_REPO_REFERENCE_USED_NOT_READINESS_PROOF");
    primitiveRoute.forbiddenActions.push("old_repo_as_readiness_proof");
  }

  // 8. Founder/AI Team truth block
  if (frame.founderCockpitTouched) {
    primitiveRoute.forbiddenActions.push("founder_cockpit_creates_truth");
  }
  if (frame.aiTeamTouched) {
    primitiveRoute.forbiddenActions.push("ai_team_declares_READY");
  }

  // 9. Tool adapter routing — selects safest sufficient executor
  let toolAdapterRouting: ToolAdapterRouting | undefined;
  try {
    const isDeployOrRelease = /deploy|production|release|tag|npm publish/i.test(frame.userIntent);
    const isBillingOrPayment = frame.paymentTouched || /payment|billing|invoice|webhook/i.test(frame.userIntent);
    const isAuthOrSecurity = /auth|login|session|security|credential/i.test(frame.userIntent);
    const toolPlan = planToolExecution({
      taskType: isDeployOrRelease ? "deploy" : frame.taskType,
      riskClass: frame.riskClass,
      paymentTouched: isBillingOrPayment,
      authTouched: isAuthOrSecurity,
      productionImpactPossible: isDeployOrRelease || frame.riskClass === "critical" || frame.proofRequired,
      deterministicEvidenceAvailable: !frame.deepMode && frame.riskClass === "low",
      deepMode: frame.deepMode,
      secretsPossible: isAuthOrSecurity || isBillingOrPayment,
      browserProofRequested: /browser|playwright|e2e|end-to-end|journey|ui proof|visual/i.test(frame.userIntent),
      ciVerificationRequested: /github actions|ci|workflow|checks|artifact|pipeline|run status/i.test(frame.userIntent),
      dir: ".",
      now: Date.now(),
    });
    toolAdapterRouting = {
      selectedAdapter: toolPlan.selectedAdapter,
      executionMode: toolPlan.executionMode,
      fallbackAdapters: toolPlan.fallbackAdapters,
      approvalRequired: toolPlan.approvalRequired || actionWorthiness.verdict === "require_approval" || actionWorthiness.verdict === "suggest_safer_action",
      proofRequired: toolPlan.proofRequired,
      toolMayExecute: toolPlan.toolMayExecute && actionWorthiness.verdict !== "block" && actionWorthiness.verdict !== "require_approval" && actionWorthiness.verdict !== "suggest_safer_action",
      reasonCodes: unique([...toolPlan.reasonCodes, ...actionWorthiness.reasonCodes]),
    };
  } catch { /* non-fatal: tool routing is additive */ }

  const combinedReasonCodes = unique([
    ...primitiveRoute.reasonCodes,
    ...capabilityRoute.reasonCodes,
    ...actionWorthiness.reasonCodes,
  ]);
  const combinedRequiredEvidence = unique([
    ...primitiveRoute.requiredEvidence,
    ...capabilityRoute.expectedEvidence,
    ...actionWorthiness.expectedEvidence,
  ]);
  const approvalRequired =
    primitiveRoute.approvalRequired ||
    capabilityRoute.requiredApprovals.length > 0 ||
    actionWorthiness.verdict === "require_approval" ||
    actionWorthiness.verdict === "suggest_safer_action";

  // 10. Next action
  const nextAction = primitiveRoute.selectedPrimitive === "stop_blocked" || actionWorthiness.verdict === "block"
    ? "resolve_production_confidence_or_approval"
    : approvalRequired
    ? "await_approval"
    : "proceed_with_evidence";

  return {
    ...primitiveRoute,
    reasonCodes: combinedReasonCodes,
    requiredEvidence: combinedRequiredEvidence,
    approvalRequired,
    selectedCapabilities: capabilityRoute.selectedCapabilities,
    selectedAdapters: adapters,
    selectedSurfaces: surfaces,
    skippedCapabilities: capabilityRoute.suppressedCapabilities.map((item) => item.capability),
    requiredApprovals: unique([...capabilityRoute.requiredApprovals, ...actionWorthiness.requiredApprovals]),
    expectedEvidence: combinedRequiredEvidence,
    skippedScanners: primitiveRoute.selectedScanners.length === 0 ? ["all_scanners_skipped"] : [],
    surfaceProjectionAllowed: true,
    modelMayAssist,
    modelMayDecide,
    scannerMayDecide,
    finalDecisionOwner,
    nextAction,
    skillRouteSelected: skillRoute.selected.length,
    skillRouteSkipped: skillRoute.skipped.length,
    scannerResults,
    capabilityRoute,
    actionWorthiness,
    canonicalRouting: canonical,
    modelRoutingProjection: canonical?.projection,
    toolAdapterRouting,
  };
}
