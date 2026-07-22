import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { LongRunningAgentService } from "../../electron/platform/LongRunningAgentService.js";
import { PlatformJobScheduler } from "../../electron/platform/PlatformJobScheduler.js";
import { PlatformKernel } from "../../electron/platform/PlatformKernel.js";

function harness({ storage = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-long-running-")), now = () => Date.now() } = {}) {
  const kernel = new PlatformKernel({
    getStorageDirectory: () => storage,
    durableJournal: false,
    now
  });
  const run = kernel.ensureRun({
    conversationId: "conversation-long",
    goalId: "goal-long",
    objective: "long-running work",
    mode: "coding"
  }).run;
  return { storage, kernel, run };
}

describe("Long-running Agent 1.0", () => {
  it("persists scheduled jobs, idempotency, checkpoints, receipts, approvals and notifications", () => {
    let time = 10_000;
    const first = harness({ now: () => time });
    const scheduled = first.kernel.enqueueJob(first.run.id, {
      type: "scheduled-test",
      title: "Scheduled",
      scheduleAt: time + 5_000,
      idempotencyKey: "goal-long:scheduled-test"
    });
    const duplicate = first.kernel.enqueueJob(first.run.id, {
      type: "scheduled-test",
      title: "Duplicate",
      idempotencyKey: "goal-long:scheduled-test"
    });
    assert.equal(scheduled.job.status, "scheduled");
    assert.equal(scheduled.job.wake.at, time + 5_000);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.job.id, scheduled.job.id);

    const queued = first.kernel.enqueueJob(first.run.id, {
      type: "approval-test",
      title: "Approval"
    }).job;
    const checkpoint = first.kernel.recordJobCheckpoint(queued.id, {
      cursor: "phase-1",
      summary: "safe restart point",
      data: { files: 2 }
    });
    const receipt = first.kernel.recordJobReceipt(queued.id, {
      key: "publish:commit-1",
      summary: "publication completed"
    });
    const duplicateReceipt = first.kernel.recordJobReceipt(queued.id, {
      key: "publish:commit-1",
      summary: "must not duplicate"
    });
    assert.equal(checkpoint.ok, true);
    assert.equal(receipt.created, true);
    assert.equal(duplicateReceipt.created, false);

    const requested = first.kernel.requestJobApproval(queued.id, {
      action: "publish",
      risk: "high",
      title: "Publish changes",
      summary: "Publishing changes cannot be silently repeated."
    });
    assert.equal(requested.job.status, "waiting_approval");
    const notification = first.kernel.createNotification({
      platformRunId: first.run.id,
      jobId: queued.id,
      title: "Approval required",
      body: "Review the requested publication.",
      level: "action"
    }).notification;
    first.kernel.markNotificationRead(notification.id);

    const second = harness({ storage: first.storage, now: () => time });
    const restored = second.kernel.getJob(queued.id);
    assert.equal(restored.checkpoint.cursor, "phase-1");
    assert.equal(restored.receipts.length, 1);
    assert.equal(second.kernel.listApprovals({ status: "pending" }).length, 1);
    assert.equal(second.kernel.listNotifications()[0].readAt, time);
    const approved = second.kernel.resolveJobApproval(requested.approval.id, "approved");
    assert.equal(approved.job.status, "queued");
  });


  it("rejects unsafe approval transitions and prunes through the authoritative Journal", () => {
    let time = 1_000;
    const first = harness({ now: () => time });
    const scheduled = first.kernel.enqueueJob(first.run.id, {
      type: "future",
      title: "Future approval",
      scheduleAt: 20_000
    }).job;
    const invalid = first.kernel.requestJobApproval(scheduled.id, {
      action: "publish",
      risk: "high"
    });
    assert.equal(invalid.ok, false);
    assert.equal(first.kernel.listApprovals().length, 0);

    const job = first.kernel.enqueueJob(first.run.id, {
      type: "cleanup",
      title: "Cleanup"
    }).job;
    const approval = first.kernel.requestJobApproval(job.id, {
      action: "publish",
      risk: "high"
    }).approval;
    first.kernel.resolveJobApproval(approval.id, "approved");
    first.kernel.setJobStatus(job.id, "running", { reason: "cleanup-test" });
    first.kernel.setJobStatus(job.id, "completed", { reason: "cleanup-test" });
    const notification = first.kernel.createNotification({
      platformRunId: first.run.id,
      jobId: job.id,
      title: "Old notification"
    }).notification;
    first.kernel.markNotificationRead(notification.id);

    time = 100_000;
    const pruned = first.kernel.pruneLongRunningState({
      completedBefore: 50_000,
      notificationsBefore: 50_000
    });
    assert.deepEqual(pruned.removedJobIds, [job.id]);
    assert.deepEqual(pruned.removedApprovalIds, [approval.id]);
    assert.deepEqual(pruned.removedNotificationIds, [notification.id]);

    const replayed = harness({ storage: first.storage, now: () => time });
    assert.equal(replayed.kernel.getJob(job.id), null);
    assert.equal(replayed.kernel.listApprovals().length, 0);
    assert.equal(replayed.kernel.listNotifications().length, 0);
  });

  it("accounts elapsed time when a handler throws before returning a result", async () => {
    let time = 5_000;
    const { kernel, run } = harness({ now: () => time });
    const scheduler = new PlatformJobScheduler({
      platformKernel: kernel,
      autoStart: false,
      now: () => time
    });
    scheduler.register("throws", async () => {
      time += 750;
      throw Object.assign(new Error("boom"), { code: "deterministic-failure" });
    });
    const job = scheduler.enqueue(run.id, {
      type: "throws",
      title: "Throwing task",
      retryPolicy: { enabled: false }
    }).job;
    const result = await scheduler.execute(job.id);
    assert.equal(result.ok, false);
    assert.equal(kernel.getJob(job.id).budget.elapsedMs, 750);
  });

  it("uses bounded exponential backoff and later resumes from the durable retry queue", async () => {
    let time = 1_000;
    const { kernel, run } = harness({ now: () => time });
    const scheduler = new PlatformJobScheduler({
      platformKernel: kernel,
      autoStart: false,
      now: () => time
    });
    let attempts = 0;
    scheduler.register("flaky-long", async ({ checkpoint }) => {
      attempts += 1;
      if (attempts === 1) {
        checkpoint({ cursor: "before-retry", summary: "first attempt failed safely" });
        return { ok: false, code: "temporary-network-timeout" };
      }
      return { ok: true, summary: "recovered" };
    });
    const job = scheduler.enqueue(run.id, {
      type: "flaky-long",
      title: "Retry with backoff",
      maxAttempts: 3,
      retryPolicy: {
        enabled: true,
        strategy: "exponential",
        baseDelayMs: 250,
        maxDelayMs: 2_000,
        jitterRatio: 0
      }
    }).job;

    const first = await scheduler.execute(job.id);
    assert.equal(first.retryScheduled, true);
    assert.equal(kernel.getJob(job.id).status, "retry_scheduled");
    assert.equal(kernel.getJob(job.id).wake.at, 1_250);
    assert.equal(kernel.getJob(job.id).checkpoint.cursor, "before-retry");

    time = 1_249;
    assert.deepEqual(kernel.promoteDueJobs({ now: time }).promotedJobIds, []);
    time = 1_250;
    assert.deepEqual(kernel.promoteDueJobs({ now: time }).promotedJobIds, [job.id]);
    const second = await scheduler.execute(job.id);
    assert.equal(second.ok, true);
    assert.equal(kernel.getJob(job.id).status, "completed");
    assert.equal(kernel.getJob(job.id).attempt, 2);
  });

  it("does not enter the model handler while a high-impact action awaits approval", async () => {
    const { kernel, run } = harness();
    const scheduler = new PlatformJobScheduler({ platformKernel: kernel, autoStart: false });
    let handlerCalls = 0;
    scheduler.register("publish", async ({ approval, recordReceipt, hasReceipt }) => {
      handlerCalls += 1;
      assert.equal(approval.status, "approved");
      if (!hasReceipt("publish:one")) {
        recordReceipt({ key: "publish:one", summary: "published once" });
      }
      return { ok: true, summary: "published" };
    });
    const job = scheduler.enqueue(run.id, {
      type: "publish",
      title: "Publish",
      maxAttempts: 1,
      payload: {
        approvalRequired: true,
        approval: {
          action: "publish",
          risk: "critical",
          summary: "Publish to the external target."
        }
      }
    }).job;

    const waiting = await scheduler.execute(job.id);
    assert.equal(waiting.waiting, true);
    assert.equal(handlerCalls, 0);
    assert.equal(kernel.getJob(job.id).attempt, 0);
    const approval = kernel.listApprovals({ status: "pending" })[0];
    assert.equal(scheduler.resolveApproval(approval.id, "approved").ok, true);
    const completed = await scheduler.execute(job.id);
    assert.equal(completed.ok, true);
    assert.equal(handlerCalls, 1);
    assert.equal(kernel.getJob(job.id).receipts.length, 1);
  });

  it("leaves the model loop while waiting for input and resumes with the provided value", async () => {
    const { kernel, run } = harness();
    const scheduler = new PlatformJobScheduler({ platformKernel: kernel, autoStart: false });
    scheduler.register("input", async ({ job, waitForInput }) => {
      if (job.inputRequest?.status !== "provided") {
        waitForInput({ prompt: "Choose the deployment target." });
        return { ok: false, waiting: true };
      }
      return { ok: true, summary: String(job.inputRequest.value) };
    });
    const job = scheduler.enqueue(run.id, { type: "input", title: "Need input" }).job;
    const waiting = await scheduler.execute(job.id);
    assert.equal(waiting.waiting, true);
    assert.equal(kernel.getJob(job.id).status, "waiting_input");
    assert.equal(scheduler.provideInput(job.id, "staging").ok, true);
    const completed = await scheduler.execute(job.id);
    assert.equal(completed.ok, true);
    assert.equal(kernel.getJob(job.id).resultSummary, "staging");
  });

  it("recovers network and system lifecycle waits without duplicating a running instance", async () => {
    const { kernel, run } = harness();
    const scheduler = new PlatformJobScheduler({ platformKernel: kernel, autoStart: false });
    let calls = 0;
    scheduler.register("network", async () => {
      calls += 1;
      return { ok: true, summary: "online" };
    });
    const job = scheduler.enqueue(run.id, {
      type: "network",
      title: "Needs network",
      requirements: { network: true }
    }).job;
    scheduler.setNetworkOnline(false);
    scheduler.started = true;
    await scheduler.pump();
    assert.equal(kernel.getJob(job.id).status, "waiting_external");
    assert.equal(calls, 0);
    scheduler.setNetworkOnline(true);
    await scheduler.execute(job.id);
    assert.equal(kernel.getJob(job.id).status, "completed");
    assert.equal(calls, 1);

    const adapterEvents = {};
    const adapter = {
      getState: () => ({ online: true, suspended: false, onBattery: false }),
      subscribe: (events) => {
        Object.assign(adapterEvents, events);
        return () => {};
      }
    };
    const serviceScheduler = new PlatformJobScheduler({ platformKernel: kernel, autoStart: false });
    const service = new LongRunningAgentService({
      platformKernel: kernel,
      scheduler: serviceScheduler,
      lifecycleAdapter: adapter
    });
    assert.equal(service.start().ok, true);
    adapterEvents.onSuspend();
    assert.equal(kernel.getLifecycleState().suspended, true);
    adapterEvents.onResume({ online: true, onBattery: true });
    assert.equal(kernel.getLifecycleState().suspended, false);
    assert.equal(kernel.getLifecycleState().onBattery, true);
    service.stop();
  });
});
