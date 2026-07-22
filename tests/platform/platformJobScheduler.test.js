import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { PlatformJobScheduler } from "../../electron/platform/PlatformJobScheduler.js";
import { PlatformKernel } from "../../electron/platform/PlatformKernel.js";

function harness(storage = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-job-platform-"))) {
  const kernel = new PlatformKernel({
    getStorageDirectory: () => storage,
    durableJournal: false
  });
  const run = kernel.ensureRun({
    conversationId: "conversation",
    goalId: "goal",
    objective: "durable background work",
    mode: "coding"
  }).run;
  return { storage, kernel, run };
}

describe("Platform Job Scheduler", () => {
  it("recovers a running job after restart and completes it from the durable queue", async () => {
    const first = harness();
    const queued = first.kernel.enqueueJob(first.run.id, {
      type: "test",
      title: "Recover me",
      budget: { stepLimit: 4, timeLimitMs: 5000 }
    }).job;
    first.kernel.setJobStatus(queued.id, "running", { reason: "test-crash-window" });

    const second = harness(first.storage);
    const scheduler = new PlatformJobScheduler({ platformKernel: second.kernel });
    scheduler.register("test", async ({ consume, log }) => {
      log("recovered handler ran", { source: "test" });
      consume({ steps: 1 });
      return { ok: true, summary: "recovered" };
    });
    const recovery = scheduler.recover();
    assert.deepEqual(recovery.recoveredJobIds, [queued.id]);
    const result = await scheduler.wait(queued.id, { timeoutMs: 2000 });
    assert.equal(result.ok, true);
    const completed = second.kernel.getJob(queued.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.attempt, 2);
    assert.equal(completed.budget.stepsUsed, 1);
    assert.match(completed.logs.map((item) => item.message).join("\n"), /recovered handler ran/u);
  });

  it("supports pause, resume, cancel and bounded retry", async () => {
    const { kernel, run } = harness();
    const scheduler = new PlatformJobScheduler({ platformKernel: kernel });
    const paused = scheduler.enqueue(run.id, { type: "later", title: "Pause me" }).job;
    assert.equal(scheduler.pause(paused.id).ok, true);
    assert.equal(kernel.getJob(paused.id).status, "paused");
    assert.equal(scheduler.resume(paused.id).ok, true);
    scheduler.register("later", async () => ({ ok: true, summary: "resumed" }));
    assert.equal((await scheduler.wait(paused.id, { timeoutMs: 2000 })).ok, true);

    const cancelled = scheduler.enqueue(run.id, { type: "missing", title: "Cancel me" }).job;
    assert.equal(scheduler.cancel(cancelled.id).ok, true);
    assert.equal(kernel.getJob(cancelled.id).status, "cancelled");

    let attempts = 0;
    scheduler.register("flaky", async () => {
      attempts += 1;
      return attempts === 1
        ? { ok: false, code: "injected-failure" }
        : { ok: true, summary: "retry passed" };
    });
    const flaky = scheduler.enqueue(run.id, {
      type: "flaky",
      title: "Retry me",
      maxAttempts: 2,
      retryPolicy: { enabled: false }
    }).job;
    const failed = await scheduler.wait(flaky.id, { timeoutMs: 2000 });
    assert.equal(failed.ok, false);
    assert.equal(kernel.getJob(flaky.id).status, "failed");
    assert.equal(scheduler.retry(flaky.id).ok, true);
    assert.equal((await scheduler.wait(flaky.id, { timeoutMs: 2000 })).ok, true);
    assert.equal(kernel.getJob(flaky.id).attempt, 2);
    assert.equal(scheduler.retry(flaky.id).ok, false);
  });

  it("enforces token, step and time budgets and shares leases for ports and test processes", async () => {
    const { kernel, run } = harness();
    const scheduler = new PlatformJobScheduler({ platformKernel: kernel });
    scheduler.register("budget", async ({ consume }) => {
      const result = consume({ tokens: 101, steps: 2, elapsedMs: 10 });
      return result.ok ? { ok: true } : { ok: false, code: "budget-exceeded" };
    });
    const job = scheduler.enqueue(run.id, {
      type: "budget",
      title: "Budgeted",
      budget: { tokenLimit: 100, stepLimit: 2, timeLimitMs: 1000 }
    }).job;
    const result = await scheduler.wait(job.id, { timeoutMs: 2000 });
    assert.equal(result.ok, false);
    assert.equal(kernel.getJob(job.id).status, "failed");

    const port = kernel.acquireLease({
      platformRunId: run.id,
      agentRunId: "tester-a",
      resourceKey: "port:4173"
    });
    const portConflict = kernel.acquireLease({
      platformRunId: run.id,
      agentRunId: "tester-b",
      resourceKey: "port:4173"
    });
    const processLease = kernel.acquireLease({
      platformRunId: run.id,
      agentRunId: "tester-b",
      resourceKey: "test-process:electron-e2e"
    });
    assert.equal(port.ok, true);
    assert.equal(portConflict.code, "resource-lease-conflict");
    assert.equal(processLease.ok, true);
  });
});
