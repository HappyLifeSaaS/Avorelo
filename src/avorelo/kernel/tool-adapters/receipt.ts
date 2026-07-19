// Tool proof receipt. Records execution decisions with no raw content.
// Pattern: execution traces (Vercel AI Gateway), local receipts (Nadir-like).

import { createHash } from "node:crypto";
import type { ToolProofReceipt, ToolAdapterId, ExecutionMode, ToolExecutionResult } from "./types.ts";

export function createToolProofReceipt(
  adapterId: ToolAdapterId,
  executionMode: ExecutionMode,
  status: string,
  reasonCodes: string[],
  now: number,
): ToolProofReceipt {
  const receiptId = "tpr_" + createHash("sha256")
    .update(`${adapterId}:${executionMode}:${status}:${now}`)
    .digest("hex").slice(0, 12);

  return {
    contract: "avorelo.toolProofReceipt.v1",
    receiptId,
    adapterId,
    executionMode,
    status,
    reasonCodes,
    forbiddenActions: [
      "persist_raw_prompt", "persist_raw_source", "persist_raw_secret", "persist_raw_output",
      "model_owns_READY", "model_owns_entitlement", "model_owns_production_readiness",
    ],
    proofCollected: executionMode !== "dry_run" && status === "executed",
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
    containsRawOutput: false,
    modelMayDecide: false,
    scannerMayDecide: false,
    finalDecisionOwner: "kernel/stop-continue-gate",
    createdAt: now,
  };
}

export function createToolExecutionResult(
  adapterId: ToolAdapterId,
  executionMode: ExecutionMode,
  status: "planned" | "executed" | "blocked" | "failed" | "approval_required",
  reasonCodes: string[],
  now: number,
): ToolExecutionResult {
  const receipt = createToolProofReceipt(adapterId, executionMode, status, reasonCodes, now);
  return {
    adapterId,
    executionMode,
    status,
    durationMs: null,
    proofCollected: receipt.proofCollected,
    receiptId: receipt.receiptId,
    reasonCodes,
    failureClass: null,
  };
}
