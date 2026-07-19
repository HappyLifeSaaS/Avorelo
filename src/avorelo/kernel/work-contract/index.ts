// Avorelo Work Contract (Slice 1). The bounded unit of intent. Validates + creates; owns no policy/proof.

import { validateWorkContract } from "../../shared/schemas/index.ts";
import type { WorkContract, PlanTier } from "../../shared/schemas/index.ts";

export function createWorkContract(input: {
  contractId: string;
  objective: string;
  allowedPaths?: string[];
  requestedOutputs?: string[];
  successCriteria?: string[];
  stopConditions?: string[];
  evidenceRefs?: string[];
  reviewReasons?: string[];
  planTier?: PlanTier;
}): WorkContract {
  const contract: WorkContract = {
    contractId: input.contractId,
    objective: input.objective,
    allowedPaths: input.allowedPaths ?? [],
    requestedOutputs: input.requestedOutputs ?? [],
    successCriteria: input.successCriteria ?? [],
    stopConditions: input.stopConditions ?? [],
    evidenceRefs: input.evidenceRefs ?? [],
    reviewReasons: input.reviewReasons ?? [],
    planTier: input.planTier ?? "Free",
  };
  return validateWorkContract(contract);
}

export type { WorkContract };
