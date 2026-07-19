// Avorelo session orchestrator. The central control loop for AI work sessions.
// Understand → Watch → Compare → Correct → Prove → Remember.
// Owns session lifecycle; delegates policy/evidence/receipt to Kernel.

import { createSession, loadLatestSession, updateSession, closeSession, interruptSession } from "./session-store.ts";
import type { SessionState, DriftSignal, RoutingSnapshot } from "./session-store.ts";
import { detectDrift, detectSensitiveFiles } from "./drift-detector.ts";
import { decideIntervention, buildCorrectionGuidance, hasApprovalRequired, interventionToEntry, formatUserNotice } from "./intervention.ts";
import type { InterventionAction } from "./intervention.ts";
import { createResumePacket, writeResumePacket, loadLatestResumePacket } from "./resume-packet.ts";
import type { ResumePacket } from "./resume-packet.ts";
import { detectAllAdapters, installAll, getBestAdapter, getAdapterById } from "../../adapters/registry.ts";
import { parseTaskToContract } from "../../kernel/work-contract/task-parser.ts";
import { createWorkContract } from "../../kernel/work-contract/index.ts";
import { runSlice1 } from "../../kernel/run.ts";
import { persistReceipt } from "../../kernel/receipts/index.ts";
import { unifiedRoute, type UnifiedTaskFrame } from "../../control-router/index.ts";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { EvidenceArtifact, WorkContract } from "../../shared/schemas/index.ts";

export type StartResult = {
  ok: boolean;
  session: SessionState;
  adaptersInstalled: string[];
  controlTier: string;
  controlTierLabel: string;
  message: string;
  warnings: string[];
};

export type HookEventResult = {
  verdict: "allow" | "block" | "needs_approval" | "recorded";
  corrections?: string;
  notice?: string;
  driftSignals: DriftSignal[];
  interventions: InterventionAction[];
};

export type SessionSummary = {
  sessionId: string;
  objective: string;
  status: string;
  controlTier: string;
  controlTierLabel: string;
  toolCalls: number;
  evidenceCount: number;
  driftSignals: number;
  corrections: number;
  filesChanged: number;
  activeSkills: string[];
  message: string;
};

function buildRouting(objective: string, changedFiles: string[], riskClass: string): RoutingSnapshot {
  try {
    const frame: UnifiedTaskFrame = {
      taskType: "implementation",
      riskClass: riskClass as any,
      touchedLayers: [],
      paymentTouched: changedFiles.some(f => /billing|payment|checkout|subscription/i.test(f)),
      authTouched: changedFiles.some(f => /auth|login|session|credential/i.test(f)),
      secretsPossible: changedFiles.some(f => /\.env|secret|credential|\.pem/i.test(f)),
      proofRequired: true,
      deepMode: false,
      browserAvailable: false,
      externalToolsAllowed: false,
      changedFiles,
      userIntent: objective,
      localOnly: true,
      userPlan: "",
      founderCockpitTouched: false,
      aiTeamTouched: false,
      feedbackLoopTouched: false,
      oldRepoReferenceUsed: false,
      installedTools: [],
      contextBudgetRemaining: 100,
      tokenBudgetRemaining: 100000,
      dashboardTouched: false,
      publicCopyTouched: false,
      mcpTouched: false,
    };
    const route = unifiedRoute(frame);
    return {
      selectedSkills: route.selectedCapabilities,
      skippedSkills: route.skippedCapabilities,
      selectedCapabilities: route.selectedCapabilities,
      approvalRequired: route.approvalRequired,
      riskClass: frame.riskClass,
    };
  } catch {
    return { selectedSkills: [], skippedSkills: [], selectedCapabilities: [], approvalRequired: false, riskClass: "low" };
  }
}

function rerouteOnDrift(session: SessionState, driftSignals: DriftSignal[]): RoutingSnapshot | null {
  const hasSensitive = driftSignals.some(s => s.type === "sensitive_file_touched");
  const hasRepeatedFailure = driftSignals.some(s => s.type === "repeated_failure");
  const hasProofSkipped = driftSignals.some(s => s.type === "proof_skipped");

  if (!hasSensitive && !hasRepeatedFailure && !hasProofSkipped) return null;

  const newRisk = hasSensitive ? "high" : "medium";
  const rerouted = buildRouting(session.objective, session.filesChanged, newRisk);
  rerouted.reroutedAt = new Date().toISOString();
  rerouted.rerouteReason = driftSignals.map(s => s.type).join(",");

  if (hasSensitive) {
    if (!rerouted.selectedCapabilities.includes("secret-protection")) rerouted.selectedCapabilities.push("secret-protection");
    rerouted.approvalRequired = true;
  }
  if (hasProofSkipped) {
    if (!rerouted.selectedCapabilities.includes("production-confidence")) rerouted.selectedCapabilities.push("production-confidence");
  }
  return rerouted;
}

function writeSessionCorrection(dir: string, sessionId: string, correctionText: string): void {
  const corrDir = join(dir, ".avorelo", "sessions");
  mkdirSync(corrDir, { recursive: true });
  writeFileSync(join(corrDir, `${sessionId}-correction.txt`), correctionText);
}

function applyCorrection(dir: string, session: SessionState, correctionText: string): void {
  writeSessionCorrection(dir, session.sessionId, correctionText);

  // For lifecycle-hooks adapters, the correction is returned in hook response (ephemeral).
  // For instruction-only adapters, update the adapter's instruction surface with session guidance.
  for (const adapterId of session.adapterIds) {
    const adapter = getAdapterById(adapterId);
    if (adapter && adapter.canInjectCorrection && adapter.controlTier === "instruction-only") {
      const surface = adapter.getInstructionSurface(dir);
      if (surface) {
        try {
          const { updateManagedBlock } = require("../../capabilities/instruction-management/managed-blocks.ts");
          updateManagedBlock(surface, "session-correction", `Session guidance (auto-updated):\n${correctionText}`);
        } catch {}
      }
    }
  }
}

export function startSession(dir: string, opts?: {
  objective?: string;
  task?: string;
  installHooks?: boolean;
  approveHooks?: boolean;
}): StartResult {
  const warnings: string[] = [];
  const objective = opts?.objective ?? opts?.task ?? "General AI coding session";

  let contract: WorkContract;
  if (opts?.task) {
    contract = parseTaskToContract(opts.task, dir);
  } else {
    contract = createWorkContract({
      contractId: `ses_${Date.now().toString(36)}`,
      objective,
      planTier: "Free",
    });
  }

  const detected = detectAllAdapters(dir);
  const best = detected.length > 0 ? detected[0] : null;
  const controlTier = best?.adapter.controlTier ?? "prompt-only";

  const guidance = [
    `Session objective: ${objective}`,
    contract.allowedPaths.length > 0 ? `Allowed paths: ${contract.allowedPaths.join(", ")}` : "",
    contract.successCriteria.length > 0 ? `Success: ${contract.successCriteria.join("; ")}` : "",
  ].filter(Boolean).join("\n");

  const installResult = installAll(dir, detected, guidance);
  warnings.push(...installResult.warnings);

  // Route skills/tools on session start
  const routing = buildRouting(objective, [], "low");

  const session = createSession(dir, {
    contractId: contract.contractId,
    objective,
    adapterIds: installResult.installed,
    controlTier,
    allowedPaths: contract.allowedPaths,
    routing,
  });

  const toolNames = detected
    .filter(d => d.adapter.id !== "generic")
    .map(d => d.adapter.displayName);
  const toolsMsg = toolNames.length > 0
    ? `Found: ${toolNames.join(", ")}.`
    : "No specific AI tool detected. Using generic guidance.";

  const tierLabel = session.controlTierLabel;
  const tierMsg = tierLabel === "A"
    ? "Full session control active."
    : tierLabel === "C"
      ? "Instruction-based guidance active."
      : "Copy-ready prompt available.";

  return {
    ok: true,
    session,
    adaptersInstalled: installResult.installed,
    controlTier,
    controlTierLabel: tierLabel,
    message: `Avorelo is ready. ${toolsMsg} ${tierMsg}`,
    warnings,
  };
}

export function processHookEvent(dir: string, event: string, payload?: {
  toolName?: string;
  filePath?: string;
  content?: string;
  command?: string;
  success?: boolean;
}): HookEventResult {
  const session = loadLatestSession(dir);
  if (!session) {
    return { verdict: "recorded", driftSignals: [], interventions: [] };
  }

  const patch: Partial<SessionState> = {};

  switch (event) {
    case "SessionStart": {
      return { verdict: "recorded", driftSignals: [], interventions: [] };
    }

    case "UserPromptSubmit": {
      patch.toolCallCount = session.toolCallCount + 1;
      break;
    }

    case "PreToolUse": {
      patch.toolCallCount = session.toolCallCount + 1;
      if (payload?.filePath) {
        patch.filesChanged = [...session.filesChanged, payload.filePath];
        const sensitive = detectSensitiveFiles([payload.filePath]);
        if (sensitive.length > 0) {
          patch.sensitiveFilesTouched = [...new Set([...session.sensitiveFilesTouched, ...sensitive])];
        }
      }
      if (payload?.command) {
        patch.commandsRun = [...session.commandsRun, payload.command];
      }
      break;
    }

    case "PostToolUse": {
      if (payload?.success === false && payload?.command) {
        patch.failedCommands = [...session.failedCommands, payload.command];
      }
      break;
    }

    case "Stop": {
      break;
    }

    case "SessionEnd": {
      const updated = updateSession(dir, session.sessionId, patch);
      const finalSession = updated ?? session;

      if (finalSession.evidenceAccumulated.length > 0) {
        const result = runSlice1({
          contract: createWorkContract({
            contractId: finalSession.contractId,
            objective: finalSession.objective,
            allowedPaths: finalSession.allowedPaths,
            planTier: "Free",
          }),
          artifacts: finalSession.evidenceAccumulated,
          receiptId: `rcpt_${finalSession.sessionId}`,
        });
        persistReceipt(dir, result.receipt);
        closeSession(dir, finalSession.sessionId, result.gate.decision);
      } else {
        interruptSession(dir, finalSession.sessionId, "No evidence collected");
        const packet = createResumePacket(finalSession);
        writeResumePacket(dir, packet);
      }

      return { verdict: "recorded", driftSignals: [], interventions: [] };
    }
  }

  // Update session state
  const updated = updateSession(dir, session.sessionId, patch);
  const currentSession = updated ?? { ...session, ...patch } as SessionState;

  // Detect drift using stored allowedPaths
  const driftSignals = detectDrift(currentSession, session.allowedPaths);

  // Decide interventions
  const interventions = decideIntervention(driftSignals);

  // Re-route skills/tools if drift warrants it
  let reroutedRouting: RoutingSnapshot | null = null;
  if (driftSignals.length > 0) {
    reroutedRouting = rerouteOnDrift(currentSession, driftSignals);

    updateSession(dir, session.sessionId, {
      driftSignals: [...session.driftSignals, ...driftSignals],
      interventionLog: [
        ...session.interventionLog,
        ...interventions.map(a => interventionToEntry(a, a.action)),
      ],
      ...(reroutedRouting ? { routing: reroutedRouting } : {}),
    });
  }

  // Apply corrections (the core addendum requirement)
  const corrections = buildCorrectionGuidance(interventions);
  if (corrections) {
    applyCorrection(dir, currentSession, corrections);
    updateSession(dir, session.sessionId, {
      correctionsApplied: [...(session.correctionsApplied ?? []), corrections],
    });
  }

  const notice = formatUserNotice(interventions);
  const needsApproval = hasApprovalRequired(interventions);

  let verdict: "allow" | "block" | "needs_approval" | "recorded" = "recorded";
  if (event === "PreToolUse") {
    verdict = needsApproval ? "needs_approval" : "allow";
  }

  return {
    verdict,
    corrections: corrections ?? undefined,
    notice: notice ?? undefined,
    driftSignals,
    interventions,
  };
}

export function getSessionStatus(dir: string): SessionSummary | null {
  const session = loadLatestSession(dir);
  if (!session) return null;

  const driftCount = session.driftSignals.length;
  const status = session.status === "open"
    ? (driftCount > 0 ? "Active (drift detected)" : "Active")
    : session.status;

  return {
    sessionId: session.sessionId,
    objective: session.objective,
    status,
    controlTier: session.controlTier,
    controlTierLabel: session.controlTierLabel,
    toolCalls: session.toolCallCount,
    evidenceCount: session.evidenceAccumulated.length,
    driftSignals: driftCount,
    corrections: session.interventionLog.length,
    filesChanged: new Set(session.filesChanged).size,
    activeSkills: session.routing?.selectedSkills ?? [],
    message: session.status === "open"
      ? "Avorelo is watching this session."
      : `Session ${session.status}. Run \`avorelo resume\` to continue.`,
  };
}

export function resumeSession(dir: string): StartResult | null {
  const packet = loadLatestResumePacket(dir);
  if (!packet) return null;

  return startSession(dir, {
    objective: packet.objective,
    task: packet.objective,
  });
}

export { createResumePacket, writeResumePacket, loadLatestResumePacket };
export type { ResumePacket };
