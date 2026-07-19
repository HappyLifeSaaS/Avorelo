// Avorelo Loop Orchestrator (V1). Drives single_run and bounded_loop iterations.
// Calls kernel modules (drift-guard, stop-continue-gate, receipts, state-ledger, evidence).
// Never creates its own policy engine, evidence model, receipt writer, or state store.

import { randomUUID } from "node:crypto";
import { StateLedger } from "../../kernel/state-ledger/index.ts";
import { decide } from "../../kernel/stop-continue-gate/index.ts";
import { writeReceipt, persistReceipt } from "../../kernel/receipts/index.ts";
import { gradeAll } from "../../kernel/evidence/index.ts";
import { detectScopeDrift, detectMethodDrift } from "../../kernel/drift-guard/index.ts";
import { detectIterationDrift } from "./iteration-drift.ts";
import { runAllChecks } from "./checks-runner.ts";
import { getChangedFiles, getCurrentHead } from "./git-observer.ts";
import { buildLoopMetadata, persistLoopMetadata, writeActiveLoop, clearActiveLoop } from "./loop-metadata.ts";
import type { LoopAdapter, IterationInput } from "../../adapters/loop-adapter.ts";
import type {
  LoopPolicy, LoopIterationSummary, LoopStopReason, LoopStopCategory,
  LoopDriftFinding, LoopCheckResult, GateDecision, LoopMetadata,
  EvidenceArtifact, LoopCheckResultStatus,
} from "../../shared/schemas/index.ts";

export type OrchestratorInput = {
  task: string;
  contractId: string;
  policy: LoopPolicy;
  adapter: LoopAdapter;
  cwd: string;
  allowedPaths: string[];
  disallowedPaths: string[];
  onIterationComplete?: (summary: LoopIterationSummary) => void;
  abortSignal?: AbortSignal;
};

export type OrchestratorResult = {
  loopId: string;
  metadata: LoopMetadata;
  metadataPath: string;
  receiptPath: string;
  stopped: boolean;
  stopReason: LoopStopReason;
  stopCategory: LoopStopCategory;
  iterationsRun: number;
  finalGateDecision: GateDecision;
};

function categoryForReason(reason: LoopStopReason): LoopStopCategory {
  if (reason.startsWith("success_")) return "success";
  if (reason.startsWith("failure_")) return "failure";
  if (reason.startsWith("safety_")) return "safety";
  if (reason.startsWith("budget_")) return "budget";
  if (reason === "escalation_rule_triggered") return "escalation";
  return "user";
}

function buildEvidenceFromChecks(checks: LoopCheckResult[]): EvidenceArtifact[] {
  const artifacts: EvidenceArtifact[] = [];
  for (const c of checks) {
    if (c.lastResult === "passed") {
      artifacts.push({
        artifactId: `ev_${c.checkId}`,
        kind: "test_passed",
        ref: `check:${c.label}`,
      });
    }
  }
  return artifacts;
}

function checkRepeatedFailures(iterations: LoopIterationSummary[]): string[] {
  if (iterations.length < 2) return [];
  const last = iterations[iterations.length - 1];
  const prev = iterations[iterations.length - 2];
  const lastFailed = Object.entries(last.checkResults).filter(([, v]) => v === "failed").map(([k]) => k);
  const prevFailed = Object.entries(prev.checkResults).filter(([, v]) => v === "failed").map(([k]) => k);
  return lastFailed.filter((c) => prevFailed.includes(c));
}

export async function runLoop(input: OrchestratorInput): Promise<OrchestratorResult> {
  const { task, contractId, policy, adapter, cwd } = input;
  const loopId = `loop_${randomUUID().slice(0, 8)}`;
  const ledger = new StateLedger();
  const startTime = Date.now();
  const iterations: LoopIterationSummary[] = [];
  const allDrift: LoopDriftFinding[] = [];
  const allFilesChanged = new Set<string>();
  let stopReason: LoopStopReason = "budget_max_iterations";
  let finalGateDecision: GateDecision = "CONTINUE";
  let latestChecks = policy.requiredChecks;

  writeActiveLoop(cwd, loopId, "running");

  ledger.append({
    type: "loop.started",
    contractId,
    payload: { loopId, mode: policy.mode, maxIterations: policy.maxIterations, task: task.slice(0, 100) },
  });

  for (let i = 1; i <= policy.maxIterations; i++) {
    if (input.abortSignal?.aborted) {
      stopReason = "user_stopped";
      break;
    }

    const elapsedMs = Date.now() - startTime;
    if (elapsedMs > policy.maxRuntimeMinutes * 60 * 1000) {
      stopReason = "budget_max_runtime";
      break;
    }

    const headBefore = getCurrentHead(cwd) ?? "HEAD";
    const previousFailures = i > 1
      ? Object.entries(iterations[iterations.length - 1].checkResults)
          .filter(([, v]) => v === "failed").map(([k]) => k)
      : [];
    const previousDrift = allDrift.filter((d) => d.severity === "warning" || d.severity === "block").map((d) => d.description);

    const iterInput: IterationInput = {
      task,
      cwd,
      iteration: i,
      maxIterations: policy.maxIterations,
      allowedPaths: input.allowedPaths,
      disallowedPaths: input.disallowedPaths,
      allowedCommands: policy.allowedCommands,
      blockedCommands: policy.blockedCommands,
      previousFailures,
      previousDrift,
    };

    const iterStart = Date.now();
    const iterOutput = await adapter.executeIteration(iterInput);

    const filesThisIteration = iterOutput.filesChanged.length > 0
      ? iterOutput.filesChanged
      : getChangedFiles(cwd, headBefore);
    for (const f of filesThisIteration) allFilesChanged.add(f);

    // Kernel drift detection (scope + method)
    const scopeDrift = detectScopeDrift({
      changedFiles: filesThisIteration,
      allowedPaths: input.allowedPaths,
      disallowedPaths: input.disallowedPaths,
    });
    const methodDrift = detectMethodDrift({
      commandsRun: iterOutput.commandsRun,
      blockedCommands: policy.blockedCommands,
    });

    // Capability-layer iteration drift
    const prevFiles = i > 1 ? iterations[iterations.length - 1].filesChanged : [];
    const iterDrift = detectIterationDrift({
      iterations,
      currentFilesChanged: filesThisIteration,
      previousFilesChanged: prevFiles,
    });

    const iterationDrifts = [...scopeDrift, ...methodDrift, ...iterDrift];
    allDrift.push(...iterationDrifts);

    // Run checks
    latestChecks = runAllChecks(latestChecks, cwd);
    const checkResults: Record<string, LoopCheckResultStatus> = {};
    for (const c of latestChecks) checkResults[c.checkId] = c.lastResult;

    const iterSummary: LoopIterationSummary = {
      iteration: i,
      startedAt: new Date(iterStart).toISOString(),
      durationMs: Date.now() - iterStart,
      filesChanged: filesThisIteration,
      checksRun: latestChecks.map((c) => c.checkId),
      checkResults,
      driftDetected: iterationDrifts.length > 0,
      gateDecision: "CONTINUE",
      reasonCodes: [],
    };

    // Safety stops
    const hasBlockDrift = iterationDrifts.some((d) => d.severity === "block");
    if (hasBlockDrift) {
      const scopeBlock = scopeDrift.some((d) => d.severity === "block");
      const methodBlock = methodDrift.some((d) => d.severity === "block");
      if (scopeBlock) stopReason = "safety_blocked_path";
      else if (methodBlock) stopReason = "safety_destructive_command";
      else stopReason = "escalation_rule_triggered";
      iterSummary.gateDecision = "STOP_BLOCKED";
      iterSummary.reasonCodes = ["DRIFT_BLOCK"];
      iterations.push(iterSummary);
      input.onIterationComplete?.(iterSummary);
      break;
    }

    // Agent error
    if (iterOutput.agentError && iterOutput.exitCode !== 0) {
      stopReason = "failure_agent_error";
      iterSummary.gateDecision = "STOP_BLOCKED";
      iterSummary.reasonCodes = ["AGENT_ERROR"];
      iterations.push(iterSummary);
      input.onIterationComplete?.(iterSummary);
      break;
    }

    // Repeated failures
    iterations.push(iterSummary);
    const repeated = checkRepeatedFailures(iterations);
    if (repeated.length > 0) {
      stopReason = "failure_repeated_failure";
      iterSummary.gateDecision = "STOP_BLOCKED";
      iterSummary.reasonCodes = ["REPEATED_FAILURE"];
      input.onIterationComplete?.(iterSummary);
      break;
    }

    // All checks passed?
    const allPassed = latestChecks.filter((c) => c.required).every((c) => c.lastResult === "passed");
    if (allPassed) {
      stopReason = "success_all_checks_passed";
      iterSummary.gateDecision = "STOP_DONE";
      iterSummary.reasonCodes = ["ALL_CHECKS_PASSED"];
      input.onIterationComplete?.(iterSummary);
      break;
    }

    // No progress
    if (filesThisIteration.length === 0 && iterOutput.exitCode === 0) {
      stopReason = "failure_no_progress";
      iterSummary.gateDecision = "STOP_BLOCKED";
      iterSummary.reasonCodes = ["NO_PROGRESS"];
      input.onIterationComplete?.(iterSummary);
      break;
    }

    iterSummary.gateDecision = "CONTINUE";
    iterSummary.reasonCodes = ["CONTINUE"];
    input.onIterationComplete?.(iterSummary);

    ledger.append({
      type: "loop.iteration_completed",
      contractId,
      payload: { loopId, iteration: i, filesChanged: filesThisIteration.length, checksAllPassed: allPassed },
    });
  }

  // Build evidence from final check state and call kernel gate
  const evidence = buildEvidenceFromChecks(latestChecks);
  const graded = gradeAll(evidence);
  const allPassed = latestChecks.filter((c) => c.required).every((c) => c.lastResult === "passed");
  const gateResult = decide({
    contract: {
      contractId,
      objective: task.slice(0, 200),
      allowedPaths: input.allowedPaths,
      requestedOutputs: [],
      successCriteria: [],
      stopConditions: [],
      evidenceRefs: [],
      reviewReasons: [],
      planTier: "Free",
    },
    graded,
    policyVerdict: allDrift.some((d) => d.severity === "block") ? "block" : "allow",
    stopConditionMet: stopReason !== "budget_max_iterations" || iterations.length >= policy.maxIterations,
  });
  finalGateDecision = gateResult.decision;

  // Kernel receipt
  const receipt = writeReceipt(ledger, {
    contractId,
    decision: finalGateDecision,
    graded,
    safeNextActions: gateResult.safeNextActions,
    decisionBasis: {
      evidenceLevels: graded.filter((g) => g.level).map((g) => g.level!),
      reasonCodes: gateResult.reasonCodes,
      policyVerdict: allDrift.some((d) => d.severity === "block") ? "block" : "allow",
      reviewerVerdicts: [],
    },
    sampleSize: evidence.length,
  });
  const receiptPath = persistReceipt(cwd, receipt);

  ledger.append({
    type: "loop.completed",
    contractId,
    payload: { loopId, stopReason, iterationsRun: iterations.length, receiptId: receipt.receiptId },
  });

  // Loop metadata (capability-layer)
  const stopCategory = categoryForReason(stopReason);
  const metadata = buildLoopMetadata({
    loopId,
    contractId,
    kernelReceiptRef: receipt.receiptId,
    mode: policy.mode,
    iterationsRun: iterations.length,
    maxIterations: policy.maxIterations,
    totalRuntimeMs: Date.now() - startTime,
    stopReason,
    stopCategory,
    filesChanged: [...allFilesChanged],
    allowedPaths: input.allowedPaths,
    disallowedPaths: input.disallowedPaths,
    checksRun: latestChecks.map((c) => ({ checkId: c.checkId, label: c.label, result: c.lastResult })),
    driftSummary: allDrift,
    iterations,
    safeNextActions: gateResult.safeNextActions,
    openIssues: [],
  });
  const metadataPath = persistLoopMetadata(cwd, metadata);
  clearActiveLoop(cwd);

  return {
    loopId,
    metadata,
    metadataPath,
    receiptPath,
    stopped: true,
    stopReason,
    stopCategory,
    iterationsRun: iterations.length,
    finalGateDecision,
  };
}
