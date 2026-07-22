import crypto from "node:crypto";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const WAITING = new Set([
  "waiting_input",
  "waiting_approval",
  "waiting_external",
  "scheduled",
  "retry_scheduled",
  "paused"
]);
const PAUSABLE = new Set([
  "queued",
  "scheduled",
  "running",
  "waiting_input",
  "waiting_approval",
  "waiting_external",
  "retry_scheduled"
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summary(value) {
  if (typeof value === "string") return value.slice(0, 2000);
  if (!value || typeof value !== "object") return "";
  return String(value.summary ?? value.message ?? value.code ?? "").slice(0, 2000);
}

function errorCode(error) {
  return String(error?.code ?? error?.result?.code ?? "platform-job-failed").slice(0, 160);
}

function retryDelay(job) {
  const policy = job.retryPolicy ?? {};
  const exponent = Math.max(0, Number(job.attempt) - 1);
  const base = Math.max(250, Number(policy.baseDelayMs) || 2_000);
  const raw = policy.strategy === "fixed" ? base : base * (2 ** exponent);
  const capped = Math.min(Math.max(base, Number(policy.maxDelayMs) || 300_000), raw);
  const jitterRatio = Math.max(0, Math.min(0.5, Number(policy.jitterRatio) || 0));
  if (jitterRatio === 0) return Math.round(capped);
  const seed = [...String(job.id)].reduce((value, character) => value + character.charCodeAt(0), job.attempt);
  const signed = ((seed % 2001) / 1000) - 1;
  return Math.max(250, Math.round(capped * (1 + signed * jitterRatio)));
}

function canAutoRetry(job, code, classification) {
  if (!job || job.attempt >= job.maxAttempts) return false;
  const policy = job.retryPolicy ?? {};
  if (policy.enabled === false) return false;
  if (policy.nonRetryableCodes?.includes(code)) return false;
  if (policy.retryableCodes?.length > 0) return policy.retryableCodes.includes(code);
  if (classification?.requiresUserInput === true) return false;
  if (classification?.retryable === false) return false;
  return !new Set([
    "platform-job-budget-exceeded",
    "platform-job-cancelled",
    "user-rejected-approval",
    "platform-job-attempt-limit"
  ]).has(code);
}

export class PlatformJobScheduler {
  constructor({
    platformKernel,
    maxConcurrency = 2,
    autoStart = true,
    now = () => Date.now(),
    createId = () => crypto.randomUUID(),
    instanceId = `scheduler:${process.pid}:${crypto.randomUUID()}`,
    runLeaseTtlMs = 90_000,
    runLeaseHeartbeatMs = 20_000,
    onPause = () => {},
    onResume = () => {},
    onCancel = () => {},
    onFailure = () => null,
    onNotification = () => {}
  } = {}) {
    if (!platformKernel) {
      throw new TypeError("PlatformJobScheduler requires PlatformKernel.");
    }
    this.platformKernel = platformKernel;
    this.maxConcurrency = Math.max(1, Math.min(4, Number(maxConcurrency) || 2));
    this.started = autoStart !== false;
    this.suspended = false;
    this.networkOnline = true;
    this.now = now;
    this.createId = createId;
    this.instanceId = String(instanceId);
    this.runLeaseTtlMs = Math.max(5_000, Number(runLeaseTtlMs) || 90_000);
    this.runLeaseHeartbeatMs = Math.max(
      1_000,
      Math.min(Math.floor(this.runLeaseTtlMs / 2), Number(runLeaseHeartbeatMs) || 20_000)
    );
    this.onPause = onPause;
    this.onResume = onResume;
    this.onCancel = onCancel;
    this.onFailure = typeof onFailure === "function" ? onFailure : () => null;
    this.onNotification = typeof onNotification === "function" ? onNotification : () => {};
    this.handlers = new Map();
    this.controllers = new Map();
    this.active = new Map();
    this.outcomes = new Map();
    this.pumpScheduled = false;
    this.wakeTimer = null;
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
    if (result.ok) {
      this.notify(result.job, "queued", "后台任务已加入队列", result.job.title, "info");
      this.schedulePump();
    }
    return result;
  }

  notify(job, kind, title, body, level = "info", action = null) {
    const created = this.platformKernel.createNotification({
      platformRunId: job?.platformRunId,
      jobId: job?.id,
      kind,
      level,
      title,
      body,
      action
    });
    if (created.ok) {
      try {
        this.onNotification(created.notification);
      } catch {
        // Native delivery is best-effort; the durable in-app notification remains authoritative.
      }
    }
    return created;
  }

  schedulePump() {
    if (!this.started || this.suspended) return;
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      void this.pump();
    });
  }

  armWakeTimer() {
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
    if (!this.started || this.suspended) return;
    const next = this.platformKernel.listJobs({ statuses: ["scheduled", "retry_scheduled"] })
      .map((job) => Number(job.wake?.at) || 0)
      .filter((at) => at > this.now())
      .sort((a, b) => a - b)[0];
    if (!next) return;
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      this.schedulePump();
    }, Math.min(2_147_000_000, Math.max(1, next - this.now())));
    this.wakeTimer.unref?.();
  }

  async pump() {
    if (!this.started || this.suspended) return;
    this.platformKernel.promoteDueJobs({ now: this.now(), online: this.networkOnline });
    const capacity = Math.max(0, this.maxConcurrency - this.active.size);
    if (capacity === 0) {
      this.armWakeTimer();
      return;
    }
    const queued = this.platformKernel.listJobs({ statuses: ["queued"] })
      .filter((job) => this.handlers.has(job.type))
      .slice(0, capacity);
    for (const job of queued) {
      if (job.requirements?.network && !this.networkOnline) {
        this.platformKernel.waitForJob(job.id, "network", {
          reason: "等待网络恢复后继续。"
        });
        this.notify(job, "waiting-network", "任务正在等待网络", job.title, "warning");
        continue;
      }
      void this.execute(job.id);
    }
    this.armWakeTimer();
  }

  async execute(jobId) {
    if (this.active.has(jobId)) return this.active.get(jobId);
    const job = this.platformKernel.getJob(jobId);
    const handler = job ? this.handlers.get(job.type) : null;
    if (!job || job.status !== "queued" || !handler || this.suspended) {
      return { ok: false, code: "platform-job-not-runnable" };
    }
    const approval = job.approvalRequestId
      ? this.platformKernel.listApprovals().find((item) => item.id === job.approvalRequestId) ?? null
      : null;
    if (job.payload?.approvalRequired === true && approval?.status !== "approved") {
      const requested = this.platformKernel.requestJobApproval(job.id, {
        action: job.payload?.approval?.action ?? "high-impact-action",
        risk: job.payload?.approval?.risk ?? "high",
        title: job.payload?.approval?.title ?? `批准后台任务：${job.title}`,
        summary: job.payload?.approval?.summary ?? "该任务包含高影响或不可逆操作，批准后才会继续。",
        details: job.payload?.approval?.details ?? null
      });
      if (requested.ok) {
        this.notify(job, "waiting-approval", "任务需要你的批准", requested.approval.summary || requested.approval.title, "action", {
          type: "approval",
          approvalId: requested.approval.id
        });
        return { ok: false, waiting: true, code: "platform-job-waiting_approval", job: requested.job };
      }
      return requested;
    }
    const execution = this.runJob(job, handler)
      .then((result) => {
        this.outcomes.set(job.id, result);
        while (this.outcomes.size > 100) {
          this.outcomes.delete(this.outcomes.keys().next().value);
        }
        return result;
      })
      .finally(() => {
        this.active.delete(job.id);
        this.controllers.delete(job.id);
        this.schedulePump();
      });
    this.active.set(job.id, execution);
    return execution;
  }

  acquireRunLease(job) {
    return this.platformKernel.acquireLease({
      platformRunId: job.platformRunId,
      agentRunId: this.instanceId,
      resourceKey: `long-running-job:${job.id}`,
      mode: "exclusive",
      ttlMs: this.runLeaseTtlMs
    });
  }

  startRunLeaseHeartbeat(lease, controller) {
    const timer = setInterval(() => {
      const renewed = this.platformKernel.renewLease(lease.id, this.runLeaseTtlMs);
      if (!renewed.ok) controller.abort("long-running-job-lease-lost");
    }, this.runLeaseHeartbeatMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  async runJob(job, handler) {
    const runLease = this.acquireRunLease(job);
    if (!runLease.ok) {
      return { ok: false, code: runLease.code ?? "platform-job-run-lease-conflict" };
    }
    const startedAt = this.now();
    const started = this.platformKernel.setJobStatus(job.id, "running", {
      reason: "scheduler-started",
      waitingReason: ""
    });
    if (!started.ok) {
      this.platformKernel.releaseLease(runLease.lease.id, "job-start-failed");
      return started;
    }
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    const stopHeartbeat = this.startRunLeaseHeartbeat(runLease.lease, controller);
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
    let elapsedRecorded = false;
    const recordElapsed = () => {
      if (elapsedRecorded) return;
      elapsedRecorded = true;
      this.platformKernel.recordJobUsage(job.id, {
        elapsedMs: this.now() - startedAt
      });
    };
    try {
      const approval = job.approvalRequestId
        ? this.platformKernel.listApprovals().find((item) => item.id === job.approvalRequestId) ?? null
        : null;
      result = await handler({
        job: this.platformKernel.getJob(job.id),
        approval,
        signal: controller.signal,
        log: (message, options = {}) => this.platformKernel.appendRunLog(
          job.platformRunId,
          { jobId: job.id, message, ...options }
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
        }),
        waitForInput: (request = {}) => this.platformKernel.waitForJob(job.id, "input", request),
        waitForExternal: (request = {}) => this.platformKernel.waitForJob(job.id, "external", request),
        requestApproval: (request = {}) => this.platformKernel.requestJobApproval(job.id, request),
        scheduleAt: (wakeAt, options = {}) => this.platformKernel.scheduleJob(job.id, wakeAt, options),
        checkpoint: (value = {}) => this.platformKernel.recordJobCheckpoint(job.id, value),
        recordReceipt: (value = {}) => this.platformKernel.recordJobReceipt(job.id, value),
        hasReceipt: (key) => this.platformKernel.getJob(job.id)?.receipts?.some((item) => item.key === String(key)) === true
      });
      recordElapsed();
      const latest = this.platformKernel.getJob(job.id);
      if (["paused", "cancelled"].includes(latest?.status)) {
        return { ok: false, code: `platform-job-${latest.status}` };
      }
      if (WAITING.has(latest?.status)) {
        const level = latest.status === "waiting_approval" ? "action" : "warning";
        this.notify(
          latest,
          latest.status,
          latest.status === "waiting_approval" ? "任务需要你的批准" : "任务已进入等待状态",
          latest.waitingReason || latest.title,
          level,
          latest.status === "waiting_approval" ? { type: "approval", approvalId: latest.approvalRequestId } : null
        );
        return { ok: false, waiting: true, code: `platform-job-${latest.status}`, job: latest, result };
      }
      const usage = this.platformKernel.getJob(job.id)?.budget;
      const budgetExceeded = (
        (usage?.tokenLimit > 0 && usage.tokensUsed > usage.tokenLimit) ||
        (usage?.stepLimit > 0 && usage.stepsUsed > usage.stepLimit) ||
        (usage?.timeLimitMs > 0 && usage.elapsedMs > usage.timeLimitMs)
      );
      if (budgetExceeded || String(controller.signal.reason ?? "").startsWith("budget-exceeded:")) {
        throw Object.assign(new Error("platform-job-budget-exceeded"), {
          code: "platform-job-budget-exceeded"
        });
      }
      if (controller.signal.aborted) {
        const reason = String(controller.signal.reason ?? "platform-job-aborted");
        throw Object.assign(new Error(reason), {
          code: reason.startsWith("long-running-job-lease-lost")
            ? "platform-job-run-lease-lost"
            : "platform-job-aborted"
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
        resultSummary: summary(result),
        waitingReason: ""
      });
      this.platformKernel.appendRunLog(job.platformRunId, {
        jobId: job.id,
        source: "scheduler",
        message: `已完成：${job.title}`
      });
      this.notify(job, "completed", "后台任务已完成", job.title, "success");
      return { ok: true, job: this.platformKernel.getJob(job.id), result };
    } catch (error) {
      recordElapsed();
      const latest = this.platformKernel.getJob(job.id);
      if (["paused", "cancelled"].includes(latest?.status)) {
        return { ok: false, code: `platform-job-${latest.status}` };
      }
      if (WAITING.has(latest?.status)) {
        return {
          ok: false,
          waiting: true,
          code: `platform-job-${latest.status}`,
          job: latest
        };
      }
      const message = String(error?.message ?? error).slice(0, 2000);
      const code = errorCode(error);
      this.platformKernel.appendRunLog(job.platformRunId, {
        jobId: job.id,
        level: "error",
        source: "scheduler",
        message
      });
      let replan = null;
      try {
        replan = await this.onFailure({
          job: this.platformKernel.getJob(job.id),
          error,
          result: error?.result ?? null
        });
      } catch (replanError) {
        this.platformKernel.appendRunLog(job.platformRunId, {
          jobId: job.id,
          level: "error",
          source: "replanner",
          message: String(replanError?.message ?? replanError).slice(0, 2000)
        });
      }
      const classification = replan?.classification ?? null;
      if (classification?.requiresUserInput === true) {
        this.platformKernel.waitForJob(job.id, "input", {
          prompt: classification.summary || "任务需要补充信息后继续。"
        });
        this.notify(job, "waiting-input", "任务需要补充信息", classification.summary || job.title, "action");
        return { ok: false, waiting: true, code: "platform-job-waiting_input", error: message, replan };
      }
      const current = this.platformKernel.getJob(job.id);
      if (canAutoRetry(current, code, classification)) {
        const delayMs = retryDelay(current);
        const wakeAt = this.now() + delayMs;
        this.platformKernel.setJobStatus(job.id, "retry_scheduled", {
          reason: code,
          error: message,
          waitingReason: `${Math.ceil(delayMs / 1000)} 秒后自动重试。`
        });
        this.platformKernel.updateJobWake(
          job.id,
          { policy: "at", at: wakeAt },
          {
            waitingReason: `${Math.ceil(delayMs / 1000)} 秒后自动重试。`,
            retryPolicy: {
              ...current.retryPolicy,
              lastDelayMs: delayMs,
              scheduledAt: wakeAt,
              lastErrorCode: code
            }
          }
        );
        this.notify(job, "retry-scheduled", "任务将自动重试", `${job.title} · ${Math.ceil(delayMs / 1000)} 秒后`, "warning");
        return {
          ok: false,
          retryScheduled: true,
          code,
          error: message,
          retryAt: wakeAt,
          replan
        };
      }
      this.platformKernel.setJobStatus(job.id, "failed", {
        reason: code,
        error: message,
        waitingReason: ""
      });
      this.notify(job, "failed", "后台任务失败", `${job.title} · ${message}`, "error");
      return {
        ok: false,
        code,
        error: message,
        result: error?.result ?? null,
        replan
      };
    } finally {
      recordElapsed();
      if (timeout) clearTimeout(timeout);
      stopHeartbeat();
      this.platformKernel.releaseLease(runLease.lease.id, "long-running-job-finished-segment");
    }
  }

  pause(jobId) {
    const job = this.platformKernel.getJob(jobId);
    if (!job || !PAUSABLE.has(job.status)) {
      return { ok: false, code: "platform-job-not-pausable" };
    }
    const changed = this.platformKernel.setJobStatus(job.id, "paused", {
      reason: "user-paused",
      waitingReason: job.waitingReason
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
    let next = "queued";
    if (job.wake?.policy === "at" && job.wake.at > this.now()) {
      next = job.retryPolicy?.scheduledAt ? "retry_scheduled" : "scheduled";
    } else if (job.wake?.policy === "approval") next = "waiting_approval";
    else if (job.wake?.policy === "input") next = "waiting_input";
    else if (["external", "network_online"].includes(job.wake?.policy)) next = "waiting_external";
    const changed = this.platformKernel.setJobStatus(job.id, next, {
      reason: "user-resumed",
      waitingReason: next === "queued" ? "" : job.waitingReason
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
      reason: "user-cancelled",
      waitingReason: ""
    });
    this.controllers.get(job.id)?.abort("user-cancelled");
    this.onCancel(job);
    this.notify(job, "cancelled", "后台任务已取消", job.title, "info");
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
      reason: "user-retry",
      waitingReason: ""
    });
    this.platformKernel.updateJobWake(job.id, { policy: "immediate", at: null }, { waitingReason: "" });
    this.schedulePump();
    return changed;
  }

  resolveApproval(approvalId, decision, options = {}) {
    const result = this.platformKernel.resolveJobApproval(approvalId, decision, options);
    if (result.ok && decision === "approved") this.schedulePump();
    if (result.ok) {
      this.notify(
        result.job,
        "approval-resolved",
        decision === "approved" ? "已批准，任务将继续" : "已拒绝，任务已停止",
        result.job?.title ?? "后台任务",
        decision === "approved" ? "success" : "warning"
      );
    }
    return result;
  }

  provideInput(jobId, value) {
    const result = this.platformKernel.provideJobInput(jobId, value);
    if (result.ok) this.schedulePump();
    return result;
  }

  signalExternal(jobId, signal = {}) {
    const result = this.platformKernel.signalExternal(jobId, signal);
    if (result.ok) this.schedulePump();
    return result;
  }

  setNetworkOnline(online) {
    const value = online !== false;
    if (this.networkOnline === value) return { ok: true, changed: false };
    this.networkOnline = value;
    this.platformKernel.setLifecycleState({ online: value });
    if (!value) {
      for (const [jobId, controller] of this.controllers) {
        const job = this.platformKernel.getJob(jobId);
        if (job?.requirements?.network) {
          this.platformKernel.waitForJob(job.id, "network", {
            reason: "网络中断，等待恢复后继续。"
          });
          controller.abort("network-offline");
        }
      }
    } else {
      this.platformKernel.promoteDueJobs({ now: this.now(), online: true });
      this.schedulePump();
    }
    return { ok: true, changed: true, online: value };
  }

  suspend() {
    if (this.suspended) return { ok: true, changed: false };
    this.suspended = true;
    this.platformKernel.setLifecycleState({ suspended: true });
    for (const [jobId, controller] of this.controllers) {
      const job = this.platformKernel.getJob(jobId);
      if (job?.status === "running") {
        this.platformKernel.setJobStatus(job.id, "retry_scheduled", {
          reason: "system-suspend",
          waitingReason: "系统恢复后继续。"
        });
        this.platformKernel.updateJobWake(job.id, { policy: "app_resume", at: null }, { waitingReason: "系统恢复后继续。" });
      }
      controller.abort("system-suspend");
    }
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
    return { ok: true, changed: true };
  }

  resumeFromSystem({ online = this.networkOnline, onBattery = undefined } = {}) {
    this.suspended = false;
    this.networkOnline = online !== false;
    this.platformKernel.setLifecycleState({ suspended: false, online: this.networkOnline, onBattery });
    for (const job of this.platformKernel.listJobs({ statuses: ["retry_scheduled", "waiting_external"] })) {
      if (job.wake?.policy === "app_resume") {
        this.platformKernel.setJobStatus(job.id, "queued", { reason: "system-resumed", waitingReason: "" });
        this.platformKernel.updateJobWake(job.id, { policy: "immediate", at: null }, { waitingReason: "" });
      }
    }
    this.platformKernel.promoteDueJobs({ now: this.now(), online: this.networkOnline });
    this.schedulePump();
    return { ok: true, online: this.networkOnline };
  }

  stop() {
    this.started = false;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
    for (const controller of this.controllers.values()) controller.abort("scheduler-stopped");
  }

  async wait(jobId, { timeoutMs = 0, returnOnWaiting = true } = {}) {
    const startedAt = this.now();
    while (true) {
      const job = this.platformKernel.getJob(jobId);
      if (!job) return { ok: false, code: "platform-job-not-found" };
      if (TERMINAL.has(job.status)) {
        const active = this.active.get(job.id);
        if (active) return active;
        const outcome = this.outcomes.get(job.id);
        if (outcome) return outcome;
        return { ok: job.status === "completed", job };
      }
      if (returnOnWaiting && WAITING.has(job.status)) {
        const active = this.active.get(job.id);
        if (active) return active;
        return { ok: false, waiting: true, code: `platform-job-${job.status}`, job };
      }
      if (timeoutMs > 0 && this.now() - startedAt >= timeoutMs) {
        return { ok: false, code: "platform-job-wait-timeout", job };
      }
      await sleep(20);
    }
  }

  recover() {
    const result = this.platformKernel.recoverInterruptedJobs();
    this.platformKernel.promoteDueJobs({ now: this.now(), online: this.networkOnline });
    this.started = true;
    this.schedulePump();
    return result;
  }
}
