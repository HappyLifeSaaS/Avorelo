// Avorelo intervention system. Maps drift signals to 4-level intervention actions.
// Level 0: invisible (log only). Level 1: quiet correction (agent-facing).
// Level 2: minimal notice (user-aware). Level 3: approval gate (user must approve).

import type { DriftSignal, InterventionEntry } from "./session-store.ts";

export type InterventionAction = {
  level: 0 | 1 | 2 | 3;
  action: string;
  correctionText?: string;
  noticeText?: string;
  requiresApproval: boolean;
};

export function decideIntervention(signals: DriftSignal[]): InterventionAction[] {
  const actions: InterventionAction[] = [];

  for (const signal of signals) {
    switch (signal.severity) {
      case "info":
        actions.push({
          level: 0,
          action: `logged: ${signal.type}`,
          requiresApproval: false,
        });
        break;

      case "warn":
        if (signal.type === "evidence_stall" || signal.type === "scope_drift" || signal.type === "loop_detected") {
          actions.push({
            level: 1,
            action: `correction: ${signal.type}`,
            correctionText: signal.suggestedCorrection,
            requiresApproval: false,
          });
        } else if (signal.type === "context_bloat" || signal.type === "repeated_failure") {
          actions.push({
            level: 2,
            action: `notice: ${signal.type}`,
            noticeText: signal.detail,
            requiresApproval: false,
          });
        } else {
          actions.push({
            level: 1,
            action: `correction: ${signal.type}`,
            correctionText: signal.suggestedCorrection,
            requiresApproval: false,
          });
        }
        break;

      case "block":
        actions.push({
          level: 3,
          action: `approval_required: ${signal.type}`,
          correctionText: signal.suggestedCorrection,
          noticeText: signal.detail,
          requiresApproval: true,
        });
        break;
    }
  }

  return actions;
}

export function interventionToEntry(action: InterventionAction, driftType?: string): InterventionEntry {
  return {
    level: action.level,
    action: action.action,
    timestamp: Date.now(),
    driftType,
  };
}

export function buildCorrectionGuidance(actions: InterventionAction[]): string | null {
  const corrections = actions
    .filter(a => a.correctionText && a.level <= 2)
    .map(a => a.correctionText!);
  if (corrections.length === 0) return null;
  return corrections.join("\n");
}

export function hasApprovalRequired(actions: InterventionAction[]): boolean {
  return actions.some(a => a.requiresApproval);
}

export function formatUserNotice(actions: InterventionAction[]): string | null {
  const notices = actions
    .filter(a => a.level >= 2 && a.noticeText)
    .map(a => a.noticeText!);
  if (notices.length === 0) return null;
  return notices.join("; ");
}
