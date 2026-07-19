// Selective multi-agent review engine. Not default — triggered by risk, uncertainty, or explicit request.
// Model consensus is signal, not proof. Verifier failure overrides model consensus.
// Chairman/synthesizer cannot override verifier. No self-approval. Finite max rounds.

import type {
  ToolAdapterId, ToolExecutionPlan, MultiAgentReviewPlan, MultiAgentReviewResult,
  ReviewRound, ReviewVerdict, MultiAgentStopCondition,
} from "./types.ts";
import type { ExecutionContext, AdapterExecutionResult } from "./executor.ts";
import { executeAdapter } from "./executor.ts";
import { sanitizeOutput } from "./executor.ts";
import { createToolProofReceipt } from "./receipt.ts";
import { classifyTaskSafety } from "./sandbox.ts";
import type { TaskClass } from "./policies.ts";

const MAX_REVIEW_ROUNDS = 3;

export function shouldTriggerMultiAgentReview(
  taskClass: TaskClass,
  riskClass: string,
  plan: ToolExecutionPlan,
): { trigger: boolean; reasonCodes: string[] } {
  if (taskClass === "deterministic_check") {
    return { trigger: false, reasonCodes: ["MULTI_AGENT_REVIEW_NOT_NEEDED:deterministic"] };
  }

  if (riskClass === "high" && (taskClass === "security_review" || taskClass === "production_deploy")) {
    return { trigger: true, reasonCodes: ["MULTI_AGENT_REVIEW_REQUIRED_BY_RISK:high_security_or_deploy"] };
  }

  if (taskClass === "code_review" && riskClass === "high") {
    return { trigger: true, reasonCodes: ["MULTI_AGENT_REVIEW_REQUIRED_BY_RISK:high_risk_code_review"] };
  }

  if (plan.proofRequired && riskClass !== "low") {
    return { trigger: true, reasonCodes: ["MULTI_AGENT_REVIEW_REQUIRED_BY_RISK:proof_required_non_low"] };
  }

  return { trigger: false, reasonCodes: ["MULTI_AGENT_REVIEW_NOT_NEEDED"] };
}

export function planMultiAgentReview(
  plan: ToolExecutionPlan,
  trigger: { trigger: boolean; reasonCodes: string[] },
): MultiAgentReviewPlan {
  if (!trigger.trigger) {
    return {
      enabled: false,
      executorAdapter: plan.selectedAdapter,
      reviewerAdapter: null,
      maxRounds: 0,
      requireVerifier: false,
      triggerReasonCodes: trigger.reasonCodes,
      modelMayDecide: false,
      scannerMayDecide: false,
      finalDecisionOwner: "kernel/stop-continue-gate",
    };
  }

  const executorAdapter = plan.selectedAdapter;
  const reviewerAdapter = resolveReviewerAdapter(executorAdapter);

  return {
    enabled: true,
    executorAdapter,
    reviewerAdapter,
    maxRounds: MAX_REVIEW_ROUNDS,
    requireVerifier: true,
    triggerReasonCodes: trigger.reasonCodes,
    modelMayDecide: false,
    scannerMayDecide: false,
    finalDecisionOwner: "kernel/stop-continue-gate",
  };
}

function resolveReviewerAdapter(executorAdapter: ToolAdapterId): ToolAdapterId {
  if (executorAdapter === "claude-code") return "codex";
  if (executorAdapter === "codex") return "claude-code";
  if (executorAdapter === "gemini-cli") return "claude-code";
  if (executorAdapter === "aider") return "codex";
  if (executorAdapter === "cursor") return "claude-code";
  return "codex";
}

export function executeMultiAgentReview(
  reviewPlan: MultiAgentReviewPlan,
  executorResult: AdapterExecutionResult,
  plan: ToolExecutionPlan,
  ctx: ExecutionContext,
): MultiAgentReviewResult {
  if (!reviewPlan.enabled || !reviewPlan.reviewerAdapter) {
    return notAttemptedResult(reviewPlan.triggerReasonCodes);
  }

  if (executorResult.status !== "executed") {
    return notAttemptedResult([...reviewPlan.triggerReasonCodes, "EXECUTOR_DID_NOT_EXECUTE"]);
  }

  const rounds: ReviewRound[] = [];
  let stopCondition: MultiAgentStopCondition | null = null;
  const start = Date.now();

  for (let round = 1; round <= reviewPlan.maxRounds; round++) {
    const roundStart = Date.now();

    const reviewResult = executeReviewRound(
      round,
      reviewPlan.executorAdapter,
      reviewPlan.reviewerAdapter,
      executorResult,
      plan,
      ctx,
    );

    rounds.push(reviewResult);

    if (reviewResult.verdict === "approved") {
      if (reviewPlan.requireVerifier) {
        const verifierPassed = runDeterministicVerifier(executorResult, ctx);
        reviewResult.verifierPassed = verifierPassed;
        if (!verifierPassed) {
          stopCondition = "VERIFIER_OVERRIDE";
          break;
        }
      }
      stopCondition = "REVIEWER_APPROVED";
      break;
    }

    if (reviewResult.verdict === "rejected" && round >= 2) {
      stopCondition = "REVIEWER_DISAGREEMENT";
      break;
    }

    if (round === reviewPlan.maxRounds) {
      stopCondition = "MAX_REVIEW_ROUNDS_REACHED";
      break;
    }
  }

  const finalVerdict = determineFinalVerdict(rounds, stopCondition);
  const routedToManualGate = stopCondition === "REVIEWER_DISAGREEMENT"
    || stopCondition === "MAX_REVIEW_ROUNDS_REACHED"
    || stopCondition === "VERIFIER_OVERRIDE";
  const modelConsensusOnly = finalVerdict === "approved"
    && rounds.every((r) => r.verifierPassed === null);

  const reasonCodes = [
    ...reviewPlan.triggerReasonCodes,
    `REVIEW_ROUNDS:${rounds.length}`,
    stopCondition ? `STOP:${stopCondition}` : "REVIEW_COMPLETED",
    modelConsensusOnly ? "MODEL_CONSENSUS_ONLY" : "EXTERNAL_PROOF_AVAILABLE",
    routedToManualGate ? "MANUAL_GATE_AFTER_DISAGREEMENT" : "NO_MANUAL_GATE",
  ];

  return {
    attempted: true,
    roundsCompleted: rounds.length,
    maxRoundsReached: stopCondition === "MAX_REVIEW_ROUNDS_REACHED",
    finalVerdict,
    rounds,
    totalDurationMs: Date.now() - start,
    reasonCodes,
    modelConsensusOnly,
    externalProofRequired: modelConsensusOnly,
    routedToManualGate,
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
    containsRawModelOutput: false,
  };
}

function executeReviewRound(
  round: number,
  executorAdapter: ToolAdapterId,
  reviewerAdapter: ToolAdapterId,
  executorResult: AdapterExecutionResult,
  plan: ToolExecutionPlan,
  ctx: ExecutionContext,
): ReviewRound {
  const roundStart = Date.now();

  if (ctx.useFakeAdapters) {
    return fakeReviewRound(round, executorAdapter, reviewerAdapter, roundStart);
  }

  const reviewTask = buildReviewPrompt(executorResult, ctx.task);
  const reviewPlan: ToolExecutionPlan = {
    ...plan,
    selectedAdapter: reviewerAdapter,
    executionMode: "real",
    approvalRequired: false,
  };
  const reviewCtx: ExecutionContext = {
    ...ctx,
    task: reviewTask,
  };

  const result = executeAdapter(reviewPlan, reviewCtx);
  const verdict = classifyReviewVerdict(result);

  return {
    round,
    executorAdapter,
    reviewerAdapter,
    verdict,
    reasonCodes: [
      `REVIEW_ROUND_${round}`,
      `REVIEWER:${reviewerAdapter}`,
      `VERDICT:${verdict}`,
      ...result.reasonCodes.slice(0, 5),
    ],
    durationMs: Date.now() - roundStart,
    verifierPassed: null,
    containsRawModelOutput: false,
  };
}

function fakeReviewRound(
  round: number,
  executorAdapter: ToolAdapterId,
  reviewerAdapter: ToolAdapterId,
  roundStart: number,
): ReviewRound {
  const verdict: ReviewVerdict = round === 1 ? "approved" : "needs_changes";
  return {
    round,
    executorAdapter,
    reviewerAdapter,
    verdict,
    reasonCodes: [`FAKE_REVIEW_ROUND_${round}`, `REVIEWER:${reviewerAdapter}`, `VERDICT:${verdict}`, "CI_FAKE_ADAPTER"],
    durationMs: Date.now() - roundStart,
    verifierPassed: null,
    containsRawModelOutput: false,
  };
}

function buildReviewPrompt(executorResult: AdapterExecutionResult, originalTask: string): string {
  const sanitizedOutput = executorResult.output ? sanitizeOutput(executorResult.output).slice(0, 500) : "(no output)";
  return `Review the following execution result for correctness and safety. Original task: ${sanitizeOutput(originalTask).slice(0, 100)}. Executor output summary: ${sanitizedOutput}. Respond with: APPROVED, REJECTED, or NEEDS_CHANGES.`;
}

function classifyReviewVerdict(result: AdapterExecutionResult): ReviewVerdict {
  if (result.status !== "executed") return "inconclusive";
  const output = (result.output ?? "").toLowerCase();
  if (output.includes("approved") || output.includes("lgtm") || output.includes("looks good")) return "approved";
  if (output.includes("rejected") || output.includes("unsafe") || output.includes("blocked")) return "rejected";
  if (output.includes("needs_changes") || output.includes("needs changes") || output.includes("revise")) return "needs_changes";
  return "inconclusive";
}

function runDeterministicVerifier(executorResult: AdapterExecutionResult, ctx: ExecutionContext): boolean {
  if (!executorResult.proofCollected) return false;
  if (executorResult.proofMetadata?.fake) return true;
  const output = executorResult.output ?? "";
  if (/unsafe|injection|vulnerability|exploit/i.test(output)) return false;
  if (executorResult.failureClass) return false;
  return true;
}

function determineFinalVerdict(
  rounds: ReviewRound[],
  stopCondition: MultiAgentStopCondition | null,
): ReviewVerdict {
  if (stopCondition === "VERIFIER_OVERRIDE") return "rejected";
  if (stopCondition === "REVIEWER_DISAGREEMENT") return "rejected";
  if (stopCondition === "MAX_REVIEW_ROUNDS_REACHED") return "inconclusive";
  if (rounds.length === 0) return null as unknown as ReviewVerdict;
  return rounds[rounds.length - 1].verdict;
}

function notAttemptedResult(reasonCodes: string[]): MultiAgentReviewResult {
  return {
    attempted: false,
    roundsCompleted: 0,
    maxRoundsReached: false,
    finalVerdict: null,
    rounds: [],
    totalDurationMs: 0,
    reasonCodes,
    modelConsensusOnly: false,
    externalProofRequired: false,
    routedToManualGate: false,
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
    containsRawModelOutput: false,
  };
}
