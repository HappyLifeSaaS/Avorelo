// Tool Adapter Orchestration kernel module.
// Extends model/primitive routing into actual executor decisions.
// Local-first, deterministic-first, proof-backed.

export type {
  ToolAdapterId, WellKnownAdapterId, ExecutionMode, AvailabilityStatus, DataPolicy, RiskCeiling,
  AdapterCapabilityDescriptor, ToolAvailability, AdapterHealthState,
  AdapterPolicyConstraints, AdapterSafeCommandPreview, ToolExecutionPlan,
  ToolExecutionResult, ToolProofReceipt, ToolFailureClassification,
  ToolRoutingProjection, IrreversibleActionPolicy, FailureClass,
  DelegatedAdapterConfig, ProofExecutionMetadata, ProofAdapterClass,
  AgentRole, ReviewVerdict, ReviewRound, MultiAgentReviewPlan,
  MultiAgentReviewResult, MultiAgentStopCondition,
} from "./types.ts";

export {
  getAdapterDescriptors, getDescriptor, getAdapterHealth,
  markAdapterUnhealthy, resetAllAdapterHealth, isAdapterHealthy,
} from "./registry.ts";

export { detectAllTools, detectTool, getEffectiveAvailability } from "./detect.ts";

export {
  planToolExecution, buildToolRoutingProjection, type PlanInput,
} from "./planner.ts";

export {
  defaultPolicyConstraints, isAdapterAllowed, isFallbackSafe,
  classifyTask, getTaskClassPolicy, type TaskClass,
} from "./policies.ts";

export { createToolProofReceipt, createToolExecutionResult } from "./receipt.ts";

export {
  executeAdapter, runToolExecution, sanitizeOutput,
  getDelegatedAdapterConfig, registerDelegatedAdapterConfig,
  validateCommandSafety,
  type ExecutionContext, type AdapterExecutionResult,
} from "./executor.ts";

export {
  classifyTaskSafety, createSandboxDir, collectSandboxResults, cleanupSandbox,
  type TaskSafetyClass, type SandboxResult, type DelegatedTaskResult,
} from "./sandbox.ts";

export {
  shouldTriggerMultiAgentReview, planMultiAgentReview, executeMultiAgentReview,
} from "./multi-agent-review.ts";

export {
  persistHealthState, loadLatestHealthStates, restoreHealthFromDisk,
  buildHealthSummary, writeHealthSnapshot,
  type PersistedHealthEntry, type HealthSummary,
} from "./health-persistence.ts";

export {
  getAdapterCostProfile, getAllCostProfiles, createBenchmarkEntry,
  buildCostBenchmarkSummary, estimateTaskCost, rankAdaptersByCostEfficiency,
  type AdapterCostTier, type AdapterCostProfile, type CostBenchmarkEntry, type CostBenchmarkSummary,
} from "./cost-benchmarking.ts";

export {
  createDefaultTeamPolicy, createStrictTeamPolicy, evaluateTeamPolicy,
  applyTeamPolicyToConstraints, validateTeamPolicy,
  type TeamPolicyRule, type TeamPolicy, type TeamPolicyEvaluation,
} from "./team-policy.ts";

export {
  enqueueTask, dequeueNext, completeTask, failTask, cancelTask,
  timeoutExpiredTasks, getTaskQueueState, getQueueDepth, getRunningCount,
  resetTaskQueue, configureTaskQueue,
  type TaskPriority, type TaskStatus, type QueuedTask, type TaskQueueConfig, type TaskQueueState,
} from "./task-queue.ts";
