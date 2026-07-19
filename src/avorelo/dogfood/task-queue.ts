// Dogfood: task queue — verifies enqueue, dequeue, priority, concurrency,
// retry, timeout, cancel, and no-raw-persistence contracts.

import {
  enqueueTask, dequeueNext, completeTask, failTask, cancelTask,
  timeoutExpiredTasks, getTaskQueueState, getQueueDepth, getRunningCount,
  resetTaskQueue, configureTaskQueue,
} from "../kernel/tool-adapters/task-queue.ts";

type Gate = { gate: string; pass: boolean; detail: string };
const gates: Gate[] = [];

function check(gate: string, pass: boolean, detail = "") {
  gates.push({ gate, pass, detail });
  if (!pass) console.error(`FAIL: ${gate} — ${detail}`);
}

// G1: basic enqueue/dequeue
resetTaskQueue();
const t1 = enqueueTask("claude-code", "run tests")!;
check("enqueue_creates_task", t1 !== null && t1.status === "queued");
check("enqueue_no_raw", t1.containsRawPrompt === false && t1.containsRawSecret === false);
const d1 = dequeueNext()!;
check("dequeue_starts_task", d1.status === "running" && d1.taskId === t1.taskId);

// G2: priority ordering
resetTaskQueue();
enqueueTask("claude-code", "low", { priority: "low" });
enqueueTask("codex", "critical", { priority: "critical" });
enqueueTask("gemini-cli", "normal", { priority: "normal" });
check("priority_critical_first", dequeueNext()!.priority === "critical");
check("priority_normal_second", dequeueNext()!.priority === "normal");
check("priority_low_third", dequeueNext()!.priority === "low");

// G3: max concurrent
resetTaskQueue();
configureTaskQueue({ maxConcurrent: 2 });
enqueueTask("claude-code", "t1");
enqueueTask("codex", "t2");
enqueueTask("gemini-cli", "t3");
dequeueNext(); dequeueNext();
check("max_concurrent_blocks", dequeueNext() === null);

// G4: complete task
resetTaskQueue();
const ct = enqueueTask("claude-code", "lint")!;
dequeueNext();
const completed = completeTask(ct.taskId)!;
check("complete_status", completed.status === "completed");
check("complete_duration", completed.durationMs !== null);
check("complete_total", getTaskQueueState().totalProcessed === 1);

// G5: retry on fail
resetTaskQueue();
const rt = enqueueTask("claude-code", "flaky", { maxRetries: 1 })!;
dequeueNext();
const retried = failTask(rt.taskId, "timeout")!;
check("retry_requeues", retried.status === "queued" && retried.retryCount === 1);

// G6: permanent failure after max retries
resetTaskQueue();
const ft = enqueueTask("claude-code", "broken", { maxRetries: 0 })!;
dequeueNext();
const dead = failTask(ft.taskId, "fatal")!;
check("fail_permanent", dead.status === "failed");
check("fail_count", getTaskQueueState().totalFailed === 1);

// G7: cancel queued
resetTaskQueue();
const cq = enqueueTask("claude-code", "cancel me")!;
check("cancel_queued", cancelTask(cq.taskId)!.status === "cancelled");
check("cancel_removes", getQueueDepth() === 0);

// G8: cancel running
resetTaskQueue();
const cr = enqueueTask("claude-code", "cancel running")!;
dequeueNext();
check("cancel_running", cancelTask(cr.taskId)!.status === "cancelled");
check("cancel_running_count", getRunningCount() === 0);

// G9: timeout
resetTaskQueue();
configureTaskQueue({ defaultTimeoutMs: 100 });
enqueueTask("claude-code", "slow");
dequeueNext();
const timedOut = timeoutExpiredTasks(Date.now() + 200);
check("timeout_detected", timedOut.length === 1 && timedOut[0].status === "timed_out");
check("timeout_count", getTaskQueueState().totalTimedOut === 1);

// G10: max queue size
resetTaskQueue();
configureTaskQueue({ maxQueueSize: 2 });
check("queue_accepts_2", enqueueTask("claude-code", "t1") !== null && enqueueTask("codex", "t2") !== null);
check("queue_rejects_3", enqueueTask("gemini-cli", "t3") === null);

// G11: error sanitization
resetTaskQueue();
const st = enqueueTask("claude-code", "t", { maxRetries: 0 })!;
dequeueNext();
const sanitized = failTask(st.taskId, "error sk-abc123 and ghp_Secret")!;
check("error_sanitized", !sanitized.errorSummary!.includes("sk-abc123") && !sanitized.errorSummary!.includes("ghp_Secret"));

// G12: state contract and ownership
resetTaskQueue();
const state = getTaskQueueState();
check("state_contract", state.contract === "avorelo.taskQueue.v1");
check("state_ownership_model", state.modelMayDecide === false);
check("state_ownership_scanner", state.scannerMayDecide === false);
check("state_ownership_gate", state.finalDecisionOwner === "kernel/stop-continue-gate");
check("state_no_raw", state.containsRawPrompt === false && state.containsRawSecret === false);

// Cleanup
resetTaskQueue();

// Report
const passed = gates.filter(g => g.pass).length;
const failed = gates.filter(g => !g.pass).length;
console.log(`\nTask Queue dogfood: ${passed}/${gates.length} passed, ${failed} failed`);
if (failed > 0) {
  for (const g of gates.filter(g => !g.pass)) console.error(`  FAIL: ${g.gate} — ${g.detail}`);
  process.exit(1);
}
console.log("All task queue gates passed.");
