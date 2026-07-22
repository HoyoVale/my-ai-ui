import crypto from "node:crypto";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summary(value) {
  if (typeof value === "string") return value.slice(0, 2000);
  if (!value || typeof value !== "object") return "";
  return String(value.summary ?? value.message ?? value.code ?? "").slice(0, 2000);
}

export class PlatformJobScheduler {
  constructor({
    platformKernel,
    maxConcurrency = 2,
    autoStart = true,
    now = () => Date.now(),
    createId = () => crypto.randomUUID(),
    onPause = () => {},
    onResume = () => {},
    onCancel = () => {}
  } = {}) {
    if (!platformKernel) {
      throw new TypeError("PlatformJobScheduler requires PlatformKernel.");
    }
    this.platformKernel = platformKernel;
    this.maxConcurrency = Math.max(1, Math.min(4, Number(maxConcurrency) || 2));
    this.started = autoStart !== false;
    this.now = now;
    this.createId = createId;
    this.onPause = onPause;
    this.onResume = onResume;
    this.onCancel = onCancel;
    this.handlers = new Map();
    this.controllers = new Map();
    this.active = new Map();
    this.pumpScheduled = false;
  }

  register(type, handler) {
    const key = String(type ?? "").trim();
    if (!key || typeof handler !== "function") {
      throw new TypeError("A job type and handler are required.");
    }
    this.handlers.set(key, handler);
    this.schedulePump();
    return () => this.handlers.delete(key);
  }

  enqueue(platformRunId, descriptor = {}) {
    const result = this.platformKernel.enqueueJob(platformRunId, descriptor);
    if (result.ok) this.schedulePump();
    return result;
  }

  schedulePump() {
    if (!this.started) return;
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      void this.pump();
    });
  }

  async pump() {
    const capacity = Math.max(0, this.maxConcurrency - this.active.size);
    if (capacity === 0) return;
    const queued = this.platformKernel.listJobs({ statuses: ["queued"] })
      .filter((job) => this.handlers.has(job.type))
      .slice(0, capacity);
    for (const job of queued) {
      void this.execute(job.id);
    }
  }

  async execute(jobId) {
    if (this.active.has(jobId)) return this.active.get(jobId);
    const job = this.platformKernel.getJob(jobId);
    const handler = job ? this.handlers.get(job.type) : null;
    if (!job || job.status !== "queued" || !handler) {
      return { ok: false, code: "platform-job-not-runnable" };
    }
    const execution = this.runJob(job, handler)
      .finally(() => {
        this.active.delete(job.id);
        this.controllers.delete(job.id);
        this.schedulePump();
      });
    this.active.set(job.id, execution);
    return execution;
  }

  async runJob(job, handler) {
    const startedAt = this.now();
    const started = this.platformKernel.setJobStatus(job.id, "running", {
      reason: "scheduler-started"
    });
    if (!started.ok) return started;
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    const remainingTime = job.budget.timeLimitMs > 0
      ? Math.max(1, job.budget.timeLimitMs - job.budget.elapsedMs)
      : 0;
    const timeout = remainingTime > 0
      ? setTimeout(() => controller.abort("budget-exceeded:time"), remainingTime)
      : null;
    this.platformKernel.appendRunLog(job.platformRunId, {
      jobId: job.id,
      source: "scheduler",
      message: `开始执行：${job.title}`
    });
    let result;
    try {
      result = await handler({
        job: this.platformKernel.getJob(job.id),
        signal: controller.signal,
        log: (message, options = {}) => this.platformKernel.appendRunLog(
          job.platformRunId,
          {
            jobId: job.id,
            message,
            ...options
          }
        ),
        consume: (usage) => {
          const consumed = this.platformKernel.recordJobUsage(job.id, usage);
          if (!consumed.ok && consumed.exceeded?.length > 0) {
            controller.abort(`budget-exceeded:${consumed.exceeded.join(",")}`);
          }
          return consumed;
        },
        lease: (resourceKey, options = {}) => this.platformKernel.acquireLease({
          platformRunId: job.platformRunId,
          agentRunId: `job:${job.id}`,
          resourceKey,
          mode: options.mode,
          ttlMs: options.ttlMs
        })
      });
      const latest = this.platformKernel.getJob(job.id);
      if (["paused", "cancelled"].includes(latest?.status)) {
        return { ok: false, code: `platform-job-${latest.status}` };
      }
      this.platformKernel.recordJobUsage(job.id, {
        elapsedMs: this.now() - startedAt
      });
      const usage = this.platformKernel.getJob(job.id)?.budget;
      const budgetExceeded = (
        (usage?.tokenLimit > 0 && usage.tokensUsed > usage.tokenLimit) ||
        (usage?.stepLimit > 0 && usage.stepsUsed > usage.stepLimit) ||
        (usage?.timeLimitMs > 0 && usage.elapsedMs > usage.timeLimitMs)
      );
      if (budgetExceeded) {
        throw Object.assign(new Error("platform-job-budget-exceeded"), {
          code: "platform-job-budget-exceeded"
        });
      }
      if (result?.ok === false) {
        throw Object.assign(new Error(summary(result) || "platform-job-failed"), {
          code: result.code ?? "platform-job-failed",
          result
        });
      }
      this.platformKernel.setJobStatus(job.id, "completed", {
        reason: "scheduler-completed",
        resultSummary: summary(result)
      });
      this.platformKernel.appendRunLog(job.platformRunId, {
        jobId: job.id,
        source: "scheduler",
        message: `已完成：${job.title}`
      });
      return { ok: true, job: this.platformKernel.getJob(job.id), result };
    } catch (error) {
      const latest = this.platformKernel.getJob(job.id);
      if (["paused", "cancelled"].includes(latest?.status)) {
        return { ok: false, code: `platform-job-${latest.status}` };
      }
      const message = String(error?.message ?? error).slice(0, 2000);
      this.platformKernel.setJobStatus(job.id, "failed", {
        reason: error?.code ?? "scheduler-failed",
        error: message
      });
      this.platformKernel.appendRunLog(job.platformRunId, {
        jobId: job.id,
        level: "error",
        source: "scheduler",
        message
      });
      return {
        ok: false,
        code: error?.code ?? "platform-job-failed",
        error: message,
        result: error?.result ?? null
      };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  pause(jobId) {
    const job = this.platformKernel.getJob(jobId);
    if (!job || !["queued", "running"].includes(job.status)) {
      return { ok: false, code: "platform-job-not-pausable" };
    }
    const changed = this.platformKernel.setJobStatus(job.id, "paused", {
      reason: "user-paused"
    });
    this.controllers.get(job.id)?.abort("user-paused");
    this.onPause(job);
    return changed;
  }

  resume(jobId) {
    const job = this.platformKernel.getJob(jobId);
    if (!job || job.status !== "paused") {
      return { ok: false, code: "platform-job-not-paused" };
    }
    const changed = this.platformKernel.setJobStatus(job.id, "queued", {
      reason: "user-resumed"
    });
    this.onResume(job);
    this.schedulePump();
    return changed;
  }

  cancel(jobId) {
    const job = this.platformKernel.getJob(jobId);
    if (!job || TERMINAL.has(job.status)) {
      return { ok: false, code: "platform-job-not-cancellable" };
    }
    const changed = this.platformKernel.setJobStatus(job.id, "cancelled", {
      reason: "user-cancelled"
    });
    this.controllers.get(job.id)?.abort("user-cancelled");
    this.onCancel(job);
    return changed;
  }

  retry(jobId) {
    const job = this.platformKernel.getJob(jobId);
    if (!job || job.status !== "failed") {
      return { ok: false, code: "platform-job-not-retryable" };
    }
    if (job.attempt >= job.maxAttempts) {
      return { ok: false, code: "platform-job-attempt-limit" };
    }
    const changed = this.platformKernel.setJobStatus(job.id, "queued", {
      reason: "user-retry"
    });
    this.schedulePump();
    return changed;
  }

  async wait(jobId, { timeoutMs = 0 } = {}) {
    const startedAt = this.now();
    while (true) {
      const job = this.platformKernel.getJob(jobId);
      if (!job) return { ok: false, code: "platform-job-not-found" };
      if (TERMINAL.has(job.status)) {
        const active = this.active.get(job.id);
        if (active) return active;
        return { ok: job.status === "completed", job };
      }
      if (timeoutMs > 0 && this.now() - startedAt >= timeoutMs) {
        return { ok: false, code: "platform-job-wait-timeout", job };
      }
      await sleep(20);
    }
  }

  recover() {
    const result = this.platformKernel.recoverInterruptedJobs();
    this.started = true;
    this.schedulePump();
    return result;
  }
}
