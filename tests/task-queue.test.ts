import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  enqueueTask, dequeueNext, completeTask, failTask, cancelTask,
  timeoutExpiredTasks, getTaskQueueState, getQueueDepth, getRunningCount,
  resetTaskQueue, configureTaskQueue,
} from "../src/avorelo/kernel/tool-adapters/task-queue.ts";

describe("Task Queue v1", () => {

  beforeEach(() => resetTaskQueue());

  it("enqueues and dequeues a task", () => {
    const task = enqueueTask("claude-code", "run tests");
    assert.ok(task);
    assert.equal(task.status, "queued");
    assert.equal(task.containsRawPrompt, false);
    const dequeued = dequeueNext();
    assert.ok(dequeued);
    assert.equal(dequeued.status, "running");
    assert.equal(dequeued.taskId, task.taskId);
  });

  it("respects priority ordering", () => {
    enqueueTask("claude-code", "low task", { priority: "low" });
    enqueueTask("codex", "critical task", { priority: "critical" });
    enqueueTask("gemini-cli", "normal task", { priority: "normal" });
    const first = dequeueNext()!;
    assert.equal(first.priority, "critical");
    const second = dequeueNext()!;
    assert.equal(second.priority, "normal");
    const third = dequeueNext()!;
    assert.equal(third.priority, "low");
  });

  it("respects max concurrent limit", () => {
    configureTaskQueue({ maxConcurrent: 2 });
    enqueueTask("claude-code", "t1");
    enqueueTask("codex", "t2");
    enqueueTask("gemini-cli", "t3");
    assert.ok(dequeueNext());
    assert.ok(dequeueNext());
    assert.equal(dequeueNext(), null);
  });

  it("completes a task", () => {
    const task = enqueueTask("claude-code", "run lint")!;
    dequeueNext();
    const done = completeTask(task.taskId)!;
    assert.equal(done.status, "completed");
    assert.ok(done.durationMs !== null);
    const state = getTaskQueueState();
    assert.equal(state.totalProcessed, 1);
  });

  it("fails a task with retry", () => {
    const task = enqueueTask("claude-code", "flaky task", { maxRetries: 1 })!;
    dequeueNext();
    const retried = failTask(task.taskId, "timeout")!;
    assert.equal(retried.status, "queued");
    assert.equal(retried.retryCount, 1);
    assert.equal(getQueueDepth(), 1);
  });

  it("fails permanently after max retries", () => {
    const task = enqueueTask("claude-code", "broken task", { maxRetries: 0 })!;
    dequeueNext();
    const dead = failTask(task.taskId, "fatal error")!;
    assert.equal(dead.status, "failed");
    const state = getTaskQueueState();
    assert.equal(state.totalFailed, 1);
  });

  it("cancels queued task", () => {
    const task = enqueueTask("claude-code", "cancel me")!;
    const cancelled = cancelTask(task.taskId)!;
    assert.equal(cancelled.status, "cancelled");
    assert.equal(getQueueDepth(), 0);
  });

  it("cancels running task", () => {
    const task = enqueueTask("claude-code", "cancel running")!;
    dequeueNext();
    const cancelled = cancelTask(task.taskId)!;
    assert.equal(cancelled.status, "cancelled");
    assert.equal(getRunningCount(), 0);
  });

  it("times out expired tasks", () => {
    configureTaskQueue({ defaultTimeoutMs: 100 });
    const task = enqueueTask("claude-code", "slow task")!;
    dequeueNext();
    const now = Date.now() + 200;
    const timedOut = timeoutExpiredTasks(now);
    assert.equal(timedOut.length, 1);
    assert.equal(timedOut[0].status, "timed_out");
    const state = getTaskQueueState();
    assert.equal(state.totalTimedOut, 1);
  });

  it("respects max queue size", () => {
    configureTaskQueue({ maxQueueSize: 2 });
    assert.ok(enqueueTask("claude-code", "t1"));
    assert.ok(enqueueTask("codex", "t2"));
    assert.equal(enqueueTask("gemini-cli", "t3"), null);
  });

  it("sanitizes error summaries", () => {
    const task = enqueueTask("claude-code", "task", { maxRetries: 0 })!;
    dequeueNext();
    const done = failTask(task.taskId, "error with sk-abc123 and ghp_SecretToken")!;
    assert.ok(!done.errorSummary!.includes("sk-abc123"));
    assert.ok(!done.errorSummary!.includes("ghp_SecretToken"));
  });

  it("state has correct contract and ownership", () => {
    const state = getTaskQueueState();
    assert.equal(state.contract, "avorelo.taskQueue.v1");
    assert.equal(state.modelMayDecide, false);
    assert.equal(state.scannerMayDecide, false);
    assert.equal(state.finalDecisionOwner, "kernel/stop-continue-gate");
    assert.equal(state.containsRawPrompt, false);
    assert.equal(state.containsRawSecret, false);
  });

  it("no raw persistence in queued tasks", () => {
    const task = enqueueTask("claude-code", "safe task")!;
    assert.equal(task.containsRawPrompt, false);
    assert.equal(task.containsRawSource, false);
    assert.equal(task.containsRawSecret, false);
    assert.equal(task.containsRawOutput, false);
  });

  it("FIFO within same priority", () => {
    enqueueTask("claude-code", "first", { priority: "normal" });
    enqueueTask("codex", "second", { priority: "normal" });
    const first = dequeueNext()!;
    assert.equal(first.sanitizedDescription, "first");
    const second = dequeueNext()!;
    assert.equal(second.sanitizedDescription, "second");
  });
});
