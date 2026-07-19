import type { ToolAdapterId, ExecutionMode, RiskCeiling } from "./types.ts";

export type TaskPriority = "critical" | "high" | "normal" | "low" | "background";

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "timed_out";

export type QueuedTask = {
  taskId: string;
  adapterId: ToolAdapterId;
  executionMode: ExecutionMode;
  priority: TaskPriority;
  status: TaskStatus;
  sanitizedDescription: string;
  riskCeiling: RiskCeiling;
  timeoutMs: number;
  maxRetries: number;
  retryCount: number;
  queuedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  errorSummary: string | null;
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawSecret: false;
  containsRawOutput: false;
};

export type TaskQueueConfig = {
  maxConcurrent: number;
  maxQueueSize: number;
  defaultTimeoutMs: number;
  defaultMaxRetries: number;
  priorityOrder: TaskPriority[];
};

export type TaskQueueState = {
  contract: "avorelo.taskQueue.v1";
  queued: QueuedTask[];
  running: QueuedTask[];
  completed: QueuedTask[];
  failed: QueuedTask[];
  config: TaskQueueConfig;
  totalProcessed: number;
  totalFailed: number;
  totalTimedOut: number;
  containsRawPrompt: false;
  containsRawSource: false;
  containsRawSecret: false;
  containsRawOutput: false;
  modelMayDecide: false;
  scannerMayDecide: false;
  finalDecisionOwner: "kernel/stop-continue-gate";
};

const PRIORITY_ORDER: TaskPriority[] = ["critical", "high", "normal", "low", "background"];

const DEFAULT_CONFIG: TaskQueueConfig = {
  maxConcurrent: 3,
  maxQueueSize: 100,
  defaultTimeoutMs: 300000,
  defaultMaxRetries: 2,
  priorityOrder: PRIORITY_ORDER,
};

let queue: QueuedTask[] = [];
let running: QueuedTask[] = [];
let completed: QueuedTask[] = [];
let failed: QueuedTask[] = [];
let totalProcessed = 0;
let totalFailed = 0;
let totalTimedOut = 0;
let config = { ...DEFAULT_CONFIG };
let nextId = 1;

export function resetTaskQueue(): void {
  queue = [];
  running = [];
  completed = [];
  failed = [];
  totalProcessed = 0;
  totalFailed = 0;
  totalTimedOut = 0;
  config = { ...DEFAULT_CONFIG };
  nextId = 1;
}

export function configureTaskQueue(partial: Partial<TaskQueueConfig>): void {
  config = { ...config, ...partial };
}

export function enqueueTask(
  adapterId: ToolAdapterId,
  sanitizedDescription: string,
  opts?: {
    executionMode?: ExecutionMode;
    priority?: TaskPriority;
    riskCeiling?: RiskCeiling;
    timeoutMs?: number;
    maxRetries?: number;
  },
): QueuedTask | null {
  if (queue.length >= config.maxQueueSize) return null;

  const task: QueuedTask = {
    taskId: `task-${nextId++}`,
    adapterId,
    executionMode: opts?.executionMode ?? "real",
    priority: opts?.priority ?? "normal",
    status: "queued",
    sanitizedDescription,
    riskCeiling: opts?.riskCeiling ?? "medium",
    timeoutMs: opts?.timeoutMs ?? config.defaultTimeoutMs,
    maxRetries: opts?.maxRetries ?? config.defaultMaxRetries,
    retryCount: 0,
    queuedAt: Date.now(),
    startedAt: null,
    completedAt: null,
    durationMs: null,
    errorSummary: null,
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
    containsRawOutput: false,
  };

  queue.push(task);
  sortQueue();
  return task;
}

function sortQueue(): void {
  queue.sort((a, b) => {
    const aIdx = PRIORITY_ORDER.indexOf(a.priority);
    const bIdx = PRIORITY_ORDER.indexOf(b.priority);
    if (aIdx !== bIdx) return aIdx - bIdx;
    return a.queuedAt - b.queuedAt;
  });
}

export function dequeueNext(): QueuedTask | null {
  if (running.length >= config.maxConcurrent) return null;
  if (queue.length === 0) return null;

  const task = queue.shift()!;
  task.status = "running";
  task.startedAt = Date.now();
  running.push(task);
  return task;
}

export function completeTask(taskId: string): QueuedTask | null {
  const idx = running.findIndex(t => t.taskId === taskId);
  if (idx === -1) return null;

  const task = running.splice(idx, 1)[0];
  task.status = "completed";
  task.completedAt = Date.now();
  task.durationMs = task.startedAt ? task.completedAt - task.startedAt : 0;
  completed.push(task);
  totalProcessed++;
  return task;
}

export function failTask(taskId: string, errorSummary: string): QueuedTask | null {
  const idx = running.findIndex(t => t.taskId === taskId);
  if (idx === -1) return null;

  const task = running.splice(idx, 1)[0];

  if (task.retryCount < task.maxRetries) {
    task.retryCount++;
    task.status = "queued";
    task.startedAt = null;
    task.errorSummary = sanitizeErrorSummary(errorSummary);
    queue.push(task);
    sortQueue();
    return task;
  }

  task.status = "failed";
  task.completedAt = Date.now();
  task.durationMs = task.startedAt ? task.completedAt - task.startedAt : 0;
  task.errorSummary = sanitizeErrorSummary(errorSummary);
  failed.push(task);
  totalFailed++;
  return task;
}

export function cancelTask(taskId: string): QueuedTask | null {
  let idx = queue.findIndex(t => t.taskId === taskId);
  if (idx !== -1) {
    const task = queue.splice(idx, 1)[0];
    task.status = "cancelled";
    task.completedAt = Date.now();
    failed.push(task);
    return task;
  }

  idx = running.findIndex(t => t.taskId === taskId);
  if (idx !== -1) {
    const task = running.splice(idx, 1)[0];
    task.status = "cancelled";
    task.completedAt = Date.now();
    task.durationMs = task.startedAt ? task.completedAt - task.startedAt : 0;
    failed.push(task);
    return task;
  }

  return null;
}

export function timeoutExpiredTasks(now: number): QueuedTask[] {
  const timedOut: QueuedTask[] = [];
  const stillRunning: QueuedTask[] = [];

  for (const task of running) {
    if (task.startedAt && (now - task.startedAt) > task.timeoutMs) {
      task.status = "timed_out";
      task.completedAt = now;
      task.durationMs = now - task.startedAt;
      task.errorSummary = "task_timed_out";
      failed.push(task);
      totalTimedOut++;
      timedOut.push(task);
    } else {
      stillRunning.push(task);
    }
  }

  running = stillRunning;
  return timedOut;
}

export function getTaskQueueState(): TaskQueueState {
  return {
    contract: "avorelo.taskQueue.v1",
    queued: [...queue],
    running: [...running],
    completed: [...completed],
    failed: [...failed],
    config: { ...config },
    totalProcessed,
    totalFailed,
    totalTimedOut,
    containsRawPrompt: false,
    containsRawSource: false,
    containsRawSecret: false,
    containsRawOutput: false,
    modelMayDecide: false,
    scannerMayDecide: false,
    finalDecisionOwner: "kernel/stop-continue-gate",
  };
}

export function getQueueDepth(): number { return queue.length; }
export function getRunningCount(): number { return running.length; }

function sanitizeErrorSummary(error: string): string {
  return error
    .replace(/sk-[A-Za-z0-9]+/g, "[REDACTED_API_KEY]")
    .replace(/ghp_[A-Za-z0-9]+/g, "[REDACTED_GH_TOKEN]")
    .replace(/Bearer\s+[^\s]+/g, "Bearer [REDACTED]")
    .slice(0, 500);
}
