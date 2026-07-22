import * as internals from "../PlatformKernelInternals.js";

export const PlatformLongRunningService = {
  enqueueJob(platformRunId, {
    type,
    title,
    payload = {},
    priority = 0,
    maxAttempts = 2,
    budget = {},
    scheduleAt = null,
    wake = {},
    retryPolicy = {},
    requirements = {},
    idempotencyKey = ""
  } = {}) {
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
    const normalizedType = internals.text(type, 120);
    if (!normalizedType) return { ok: false, code: "platform-job-type-invalid" };
    const normalizedIdempotencyKey = internals.text(idempotencyKey, 240);
    if (normalizedIdempotencyKey) {
      const existing = Object.values(this.ensureLoaded().jobs).find((item) =>
        item.platformRunId === run.id && item.idempotencyKey === normalizedIdempotencyKey
      );
      if (existing) return { ok: true, created: false, job: internals.clone(existing) };
    }
    const timestamp = this.now();
    const job = {
      version: 2,
      id: this.createId(),
      platformRunId: run.id,
      type: normalizedType,
      title: internals.text(title, 500) || normalizedType,
      payload: payload && typeof payload === "object" ? internals.clone(payload) : {},
      status: internals.nonNegative(scheduleAt, 0) > timestamp ? "scheduled" : "queued",
      statusReason: "",
      waitingReason: "",
      priority: Math.max(-100, Math.min(100, Math.round(Number(priority) || 0))),
      attempt: 0,
      maxAttempts: Math.max(1, Math.min(10, Math.round(Number(maxAttempts) || 2))),
      budget: internals.normalizeBudget(budget),
      retryPolicy: internals.normalizeRetryPolicy(retryPolicy),
      wake: internals.normalizeWake({
        ...wake,
        policy: internals.nonNegative(scheduleAt, 0) > timestamp ? "at" : wake.policy,
        at: internals.nonNegative(scheduleAt, 0) > timestamp ? internals.nonNegative(scheduleAt, 0) : wake.at
      }),
      requirements: internals.normalizeJobRequirements(requirements),
      idempotencyKey: normalizedIdempotencyKey,
      approvalRequestId: null,
      inputRequest: null,
      externalSignal: null,
      checkpoint: null,
      receipts: [],
      resultSummary: "",
      error: "",
      logs: [],
      createdAt: timestamp,
      startedAt: null,
      endedAt: null,
      updatedAt: timestamp
    };
    this.commit("JOB_ENQUEUED", { job });
    this.appendRunLog(run.id, {
      jobId: job.id,
      source: "queue",
      message: `已加入后台队列：${job.title}`
    });
    return { ok: true, job: internals.clone(job) };
  },

  setJobStatus(jobId, status, {
    reason = "",
    resultSummary = "",
    error = "",
    waitingReason = ""
  } = {}) {
    const job = this.ensureLoaded().jobs[internals.text(jobId, 120)];
    if (!job) return { ok: false, code: "platform-job-not-found" };
    if (!internals.JOB_STATUSES.has(status)) {
      return { ok: false, code: "platform-job-status-invalid" };
    }
    if (job.status === status) {
      return { ok: true, changed: false, job: internals.clone(job) };
    }
    if (!internals.JOB_TRANSITIONS[job.status]?.has(status)) {
      return {
        ok: false,
        code: "platform-job-transition-invalid",
        from: job.status,
        to: status
      };
    }
    this.commit("JOB_STATUS_CHANGED", {
      jobId: job.id,
      status,
      reason,
      resultSummary,
      error,
      waitingReason
    });
    return { ok: true, changed: true, job: internals.clone(this.state.jobs[job.id]) };
  },

  recordJobUsage(jobId, usage = {}) {
    const job = this.ensureLoaded().jobs[internals.text(jobId, 120)];
    if (!job) return { ok: false, code: "platform-job-not-found" };
    this.commit("JOB_BUDGET_USED", {
      jobId: job.id,
      tokens: internals.nonNegative(usage.tokens),
      steps: internals.nonNegative(usage.steps),
      elapsedMs: internals.nonNegative(usage.elapsedMs)
    });
    const current = this.state.jobs[job.id];
    const exceeded = [];
    if (current.budget.tokenLimit > 0 && current.budget.tokensUsed > current.budget.tokenLimit) {
      exceeded.push("tokens");
    }
    if (current.budget.stepLimit > 0 && current.budget.stepsUsed > current.budget.stepLimit) {
      exceeded.push("steps");
    }
    if (current.budget.timeLimitMs > 0 && current.budget.elapsedMs > current.budget.timeLimitMs) {
      exceeded.push("time");
    }
    return { ok: exceeded.length === 0, exceeded, job: internals.clone(current) };
  },

  recordJobCheckpoint(jobId, checkpoint = {}) {
    const job = this.getJob(jobId);
    if (!job) return { ok: false, code: "platform-job-not-found" };
    const normalized = {
      version: 1,
      cursor: internals.text(checkpoint.cursor, 240),
      summary: internals.text(checkpoint.summary, 2000),
      data: checkpoint.data && typeof checkpoint.data === "object" ? internals.clone(checkpoint.data) : null,
      attempt: job.attempt,
      recordedAt: this.now()
    };
    normalized.fingerprint = internals.sha256({
      jobId: job.id,
      cursor: normalized.cursor,
      summary: normalized.summary,
      data: normalized.data,
      attempt: normalized.attempt
    });
    this.commit("JOB_CHECKPOINT_RECORDED", { jobId: job.id, checkpoint: normalized });
    return { ok: true, checkpoint: internals.clone(normalized) };
  },

  recordJobReceipt(jobId, receipt = {}) {
    const job = this.getJob(jobId);
    if (!job) return { ok: false, code: "platform-job-not-found" };
    const key = internals.text(receipt.key, 240);
    if (!key) return { ok: false, code: "platform-job-receipt-key-invalid" };
    const existing = job.receipts?.find((item) => item.key === key);
    if (existing) return { ok: true, created: false, receipt: internals.clone(existing) };
    const normalized = {
      version: 1,
      id: this.createId(),
      key,
      kind: internals.text(receipt.kind, 80) || "side-effect",
      outcome: internals.text(receipt.outcome, 80) || "completed",
      digest: internals.text(receipt.digest, 160) || internals.sha256(receipt.data ?? receipt.summary ?? key),
      summary: internals.text(receipt.summary, 1000),
      data: receipt.data && typeof receipt.data === "object" ? internals.clone(receipt.data) : null,
      attempt: job.attempt,
      recordedAt: this.now()
    };
    this.commit("JOB_RECEIPT_RECORDED", { jobId: job.id, receipt: normalized });
    return { ok: true, created: true, receipt: internals.clone(normalized) };
  },

  updateJobWake(jobId, wake = {}, { waitingReason = "", retryPolicy = null } = {}) {
    const job = this.ensureLoaded().jobs[internals.text(jobId, 120)];
    if (!job) return { ok: false, code: "platform-job-not-found" };
    this.commit("JOB_WAKE_UPDATED", {
      jobId: job.id,
      wake: internals.normalizeWake({ ...job.wake, ...wake }),
      retryPolicy: retryPolicy ? internals.normalizeRetryPolicy({ ...job.retryPolicy, ...retryPolicy }) : job.retryPolicy,
      waitingReason
    });
    return { ok: true, job: internals.clone(this.state.jobs[job.id]) };
  },

  scheduleJob(jobId, wakeAt, { reason = "scheduled" } = {}) {
    const job = this.getJob(jobId);
    if (!job) return { ok: false, code: "platform-job-not-found" };
    const at = Math.max(this.now(), internals.nonNegative(wakeAt, this.now()));
    const changed = this.setJobStatus(job.id, job.status === "failed" ? "retry_scheduled" : "scheduled", {
      reason,
      waitingReason: `等待至 ${new Date(at).toISOString()}`
    });
    if (!changed.ok) return changed;
    return this.updateJobWake(job.id, { policy: "at", at }, { waitingReason: changed.job.waitingReason });
  },

  waitForJob(jobId, kind, details = {}) {
    const job = this.getJob(jobId);
    if (!job) return { ok: false, code: "platform-job-not-found" };
    const statuses = {
      input: "waiting_input",
      approval: "waiting_approval",
      external: "waiting_external",
      network: "waiting_external"
    };
    const status = statuses[kind];
    if (!status) return { ok: false, code: "platform-job-wait-kind-invalid" };
    const reason = internals.text(details.reason ?? details.summary ?? details.prompt ?? kind, 1000);
    const changed = this.setJobStatus(job.id, status, {
      reason: `waiting-${kind}`,
      waitingReason: reason
    });
    if (!changed.ok) return changed;
    const wake = kind === "network"
      ? { policy: "network_online", conditionKey: "network" }
      : { policy: kind === "approval" ? "approval" : kind === "input" ? "input" : "external", conditionKey: details.conditionKey };
    this.updateJobWake(job.id, wake, { waitingReason: reason });
    if (kind === "input") {
      const inputRequest = {
        id: this.createId(),
        prompt: internals.text(details.prompt ?? reason, 2000),
        schema: details.schema && typeof details.schema === "object" ? internals.clone(details.schema) : null,
        status: "pending",
        requestedAt: this.now()
      };
      this.commit("JOB_INPUT_REQUESTED", { jobId: job.id, inputRequest });
    }
    return { ok: true, job: this.getJob(job.id) };
  },

  requestJobApproval(jobId, request = {}) {
    const job = this.getJob(jobId);
    if (!job) return { ok: false, code: "platform-job-not-found" };
    const existing = Object.values(this.ensureLoaded().approvals).find((item) =>
      item.jobId === job.id && item.status === "pending"
    );
    if (existing) {
      return { ok: true, created: false, approval: internals.clone(existing), job: internals.clone(job) };
    }
    if (!internals.JOB_TRANSITIONS[job.status]?.has("waiting_approval")) {
      return {
        ok: false,
        code: "platform-job-approval-transition-invalid",
        from: job.status
      };
    }
    const approval = {
      version: 1,
      id: this.createId(),
      jobId: job.id,
      platformRunId: job.platformRunId,
      action: internals.text(request.action, 160) || "high-impact-action",
      risk: new Set(["low", "medium", "high", "critical"]).has(request.risk) ? request.risk : "high",
      title: internals.text(request.title, 500) || `需要批准：${job.title}`,
      summary: internals.text(request.summary, 2000),
      details: request.details && typeof request.details === "object" ? internals.clone(request.details) : null,
      status: "pending",
      decision: null,
      note: "",
      requestedAt: this.now(),
      resolvedAt: null
    };
    this.commit("APPROVAL_REQUESTED", { approval });
    this.waitForJob(job.id, "approval", { reason: approval.summary || approval.title });
    return { ok: true, created: true, approval: internals.clone(approval), job: this.getJob(job.id) };
  },

  resolveJobApproval(approvalId, decision, { note = "" } = {}) {
    const approval = this.ensureLoaded().approvals[internals.text(approvalId, 120)];
    if (!approval) return { ok: false, code: "platform-approval-not-found" };
    if (approval.status !== "pending") return { ok: false, code: "platform-approval-already-resolved" };
    const normalized = decision === "approved" ? "approved" : decision === "rejected" ? "rejected" : "";
    if (!normalized) return { ok: false, code: "platform-approval-decision-invalid" };
    this.commit("APPROVAL_RESOLVED", { approvalId: approval.id, decision: normalized, note });
    const job = this.getJob(approval.jobId);
    if (job?.status === "waiting_approval") {
      this.setJobStatus(job.id, normalized === "approved" ? "queued" : "failed", {
        reason: normalized === "approved" ? "approval-granted" : "approval-rejected",
        error: normalized === "rejected" ? "user-rejected-approval" : "",
        waitingReason: ""
      });
      if (normalized === "approved") this.updateJobWake(job.id, { policy: "immediate", at: null }, { waitingReason: "" });
    }
    return { ok: true, approval: internals.clone(this.state.approvals[approval.id]), job: this.getJob(approval.jobId) };
  },

  provideJobInput(jobId, value) {
    const job = this.getJob(jobId);
    if (!job || job.status !== "waiting_input") return { ok: false, code: "platform-job-not-waiting-input" };
    this.commit("JOB_INPUT_PROVIDED", { jobId: job.id, value: value && typeof value === "object" ? internals.clone(value) : String(value ?? "") });
    this.setJobStatus(job.id, "queued", { reason: "input-provided", waitingReason: "" });
    this.updateJobWake(job.id, { policy: "immediate", at: null }, { waitingReason: "" });
    return { ok: true, job: this.getJob(job.id) };
  },

  signalExternal(jobId, signal = {}) {
    const job = this.getJob(jobId);
    if (!job || job.status !== "waiting_external") return { ok: false, code: "platform-job-not-waiting-external" };
    const normalized = {
      key: internals.text(signal.key, 240) || job.wake?.conditionKey || "external",
      payload: signal.payload && typeof signal.payload === "object" ? internals.clone(signal.payload) : null,
      receivedAt: this.now()
    };
    this.commit("JOB_EXTERNAL_SIGNALLED", { jobId: job.id, signal: normalized });
    this.setJobStatus(job.id, "queued", { reason: "external-signal", waitingReason: "" });
    this.updateJobWake(job.id, { policy: "immediate", at: null }, { waitingReason: "" });
    return { ok: true, job: this.getJob(job.id) };
  },

  promoteDueJobs({ now = this.now(), online = this.ensureLoaded().lifecycle.online } = {}) {
    const promotedJobIds = [];
    for (const job of this.listJobs()) {
      if (["scheduled", "retry_scheduled"].includes(job.status) && (!job.wake?.at || job.wake.at <= now)) {
        this.setJobStatus(job.id, "queued", { reason: "wake-time-reached", waitingReason: "" });
        this.updateJobWake(job.id, { policy: "immediate", at: null, lastWakeAt: now, wakeCount: (job.wake?.wakeCount ?? 0) + 1 }, { waitingReason: "" });
        promotedJobIds.push(job.id);
      } else if (job.status === "waiting_external" && job.wake?.policy === "network_online" && online) {
        this.setJobStatus(job.id, "queued", { reason: "network-restored", waitingReason: "" });
        this.updateJobWake(job.id, { policy: "immediate", at: null, lastWakeAt: now, wakeCount: (job.wake?.wakeCount ?? 0) + 1 }, { waitingReason: "" });
        promotedJobIds.push(job.id);
      }
    }
    return { ok: true, promotedJobIds };
  },

  createNotification(notification = {}) {
    const item = {
      version: 1,
      id: this.createId(),
      platformRunId: internals.text(notification.platformRunId, 120) || null,
      jobId: internals.text(notification.jobId, 120) || null,
      kind: internals.text(notification.kind, 80) || "info",
      level: new Set(["info", "success", "warning", "error", "action"]).has(notification.level) ? notification.level : "info",
      title: internals.text(notification.title, 500) || "Agent 通知",
      body: internals.text(notification.body, 2000),
      action: notification.action && typeof notification.action === "object" ? internals.clone(notification.action) : null,
      createdAt: this.now(),
      readAt: null,
      clearedAt: null
    };
    this.commit("NOTIFICATION_CREATED", { notification: item });
    return { ok: true, notification: internals.clone(item) };
  },

  markNotificationRead(notificationId) {
    const item = this.ensureLoaded().notifications[internals.text(notificationId, 120)];
    if (!item) return { ok: false, code: "platform-notification-not-found" };
    this.commit("NOTIFICATION_READ", { notificationId: item.id });
    return { ok: true, notification: internals.clone(this.state.notifications[item.id]) };
  },

  clearNotification(notificationId) {
    const item = this.ensureLoaded().notifications[internals.text(notificationId, 120)];
    if (!item) return { ok: false, code: "platform-notification-not-found" };
    this.commit("NOTIFICATION_CLEARED", { notificationId: item.id });
    return { ok: true };
  },

  listApprovals({ platformRunId = "", status = "" } = {}) {
    const runId = internals.text(platformRunId, 120);
    return Object.values(this.ensureLoaded().approvals)
      .filter((item) => !runId || item.platformRunId === runId)
      .filter((item) => !status || item.status === status)
      .sort((a, b) => b.requestedAt - a.requestedAt)
      .map(internals.clone);
  },

  listNotifications({ platformRunId = "", unreadOnly = false } = {}) {
    const runId = internals.text(platformRunId, 120);
    return Object.values(this.ensureLoaded().notifications)
      .filter((item) => !item.clearedAt)
      .filter((item) => !runId || item.platformRunId === runId)
      .filter((item) => !unreadOnly || !item.readAt)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 200)
      .map(internals.clone);
  },

  setLifecycleState(update = {}) {
    const current = this.ensureLoaded().lifecycle;
    const lifecycle = {
      online: update.online === undefined ? current.online : update.online !== false,
      suspended: update.suspended === undefined ? current.suspended : update.suspended === true,
      onBattery: update.onBattery === undefined ? current.onBattery : update.onBattery === true
    };
    this.commit("LIFECYCLE_CHANGED", { lifecycle });
    return { ok: true, lifecycle: internals.clone(this.state.lifecycle) };
  },

  getLifecycleState() {
    return internals.clone(this.ensureLoaded().lifecycle);
  },

  pruneLongRunningState({ completedBefore = 0, notificationsBefore = 0 } = {}) {
    const state = this.ensureLoaded();
    const removableJobs = Object.values(state.jobs).filter((job) =>
      ["completed", "failed", "cancelled"].includes(job.status) &&
      completedBefore > 0 &&
      (job.endedAt ?? job.updatedAt) < completedBefore
    );
    const removableJobIds = new Set(removableJobs.map((item) => item.id));
    const removableApprovals = Object.values(state.approvals).filter((item) =>
      removableJobIds.has(item.jobId) && item.status !== "pending"
    );
    const removableNotifications = Object.values(state.notifications).filter((item) =>
      notificationsBefore > 0 &&
      item.createdAt < notificationsBefore &&
      (item.readAt || item.clearedAt)
    );
    const payload = {
      jobIds: [...removableJobIds],
      approvalIds: removableApprovals.map((item) => item.id),
      notificationIds: removableNotifications.map((item) => item.id)
    };
    if (payload.jobIds.length || payload.approvalIds.length || payload.notificationIds.length) {
      this.commit("LONG_RUNNING_STATE_PRUNED", payload);
    }
    return {
      ok: true,
      removedJobIds: payload.jobIds,
      removedApprovalIds: payload.approvalIds,
      removedNotificationIds: payload.notificationIds
    };
  },

  getJob(jobId) {
    const job = this.ensureLoaded().jobs[internals.text(jobId, 120)];
    return job ? internals.clone(job) : null;
  },

  listJobs({ platformRunId = "", statuses = [] } = {}) {
    const runId = internals.text(platformRunId, 120);
    const allowedStatuses = new Set(
      (Array.isArray(statuses) ? statuses : []).filter((status) => internals.JOB_STATUSES.has(status))
    );
    return Object.values(this.ensureLoaded().jobs)
      .filter((job) => !runId || job.platformRunId === runId)
      .filter((job) => allowedStatuses.size === 0 || allowedStatuses.has(job.status))
      .sort((left, right) =>
        right.priority - left.priority || left.createdAt - right.createdAt
      )
      .map(internals.clone);
  },

  recoverInterruptedJobs() {
    const recoveredJobIds = [];
    for (const job of this.listJobs()) {
      if (job.status !== "running") continue;
      const nextStatus = job.attempt < job.maxAttempts ? "retry_scheduled" : "failed";
      this.setJobStatus(job.id, nextStatus, {
        reason: "application-restart",
        error: nextStatus === "failed" ? "application-restart-attempt-limit" : "",
        waitingReason: nextStatus === "retry_scheduled" ? "应用重启后等待安全续跑。" : ""
      });
      if (nextStatus === "retry_scheduled") {
        this.updateJobWake(job.id, { policy: "at", at: this.now() }, {
          waitingReason: "应用重启后等待安全续跑。",
          retryPolicy: { ...job.retryPolicy, scheduledAt: this.now(), lastErrorCode: "application-restart" }
        });
      }
      recoveredJobIds.push(job.id);
      this.appendRunLog(job.platformRunId, {
        jobId: job.id,
        level: "warn",
        source: "recovery",
        message: nextStatus === "retry_scheduled"
          ? "应用重启后已将中断任务放入安全续跑队列。"
          : "应用重启时任务已达到最大尝试次数。"
      });
    }
    this.promoteDueJobs();
    return { ok: true, recoveredJobIds };
  }
};
