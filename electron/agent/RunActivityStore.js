import {
  normalizeRunStopReason,
  runStatusFromStopReason
} from "./runStopReasons.js";

function clone(value) {
  return structuredClone(value);
}

function nowValue(value) {
  const numeric = Number(value);

  return Number.isFinite(numeric)
    ? Math.max(0, Math.round(numeric))
    : Date.now();
}

function canonicalToolStatus(status) {
  if (status === "queued") {
    return "queued";
  }

  if (["running", "in_progress", "retrying"].includes(status)) {
    return status === "retrying"
      ? "retrying"
      : "running";
  }

  if (["cancelled", "aborted"].includes(status)) {
    return "cancelled";
  }

  if (["failed", "error"].includes(status)) {
    return "failed";
  }

  return "completed";
}

function planEventStatus(items) {
  if (
    items.some((item) =>
      ["blocked", "failed", "error"].includes(item?.status)
    )
  ) {
    return "failed";
  }

  if (
    items.length > 0 &&
    items.every((item) =>
      [
        "completed",
        "complete",
        "skipped",
        "cancelled",
        "superseded"
      ].includes(item?.status)
    )
  ) {
    return "completed";
  }

  return "running";
}

function commentaryPhase(value) {
  if (["before_tools", "between_tools", "after_tools"].includes(value)) {
    return value;
  }

  return "between_tools";
}

export class RunActivityStore {
  constructor({
    taskId,
    runId,
    startedAt = Date.now()
  } = {}) {
    this.taskId = String(taskId ?? runId ?? "");
    this.runId = String(runId ?? "");
    this.startedAt = nowValue(startedAt);
    this.endedAt = null;
    this.status = "running";
    this.outcome = "running";
    this.resumable = false;
    this.stopReason = "";
    this.events = [];
    this.sequence = 0;
    this.planRevision = 0;
    this.commentaryRevision = 0;
    this.batchRevision = 0;
    this.progressRevision = 0;
    this.lastPlanSignature = "";
    this.activeBatchId = "";
    this.checkpoint = null;

    this.upsertEvent({
      id: `run:${this.runId || this.taskId}`,
      type: "status",
      status: "running",
      title: "开始处理任务",
      category: "runtime",
      activityVisibility: "developer",
      createdAt: this.startedAt,
      updatedAt: this.startedAt
    });
  }

  upsertEvent(event) {
    const index = this.events.findIndex(
      (item) => item.id === event.id
    );
    const timestamp = nowValue(
      event.updatedAt ?? event.createdAt
    );

    if (index >= 0) {
      const existing = this.events[index];
      this.events[index] = {
        ...existing,
        ...clone(event),
        sequence: existing.sequence,
        createdAt: existing.createdAt,
        updatedAt: timestamp
      };

      return clone(this.events[index]);
    }

    const next = {
      ...clone(event),
      sequence: this.sequence,
      createdAt: nowValue(event.createdAt ?? timestamp),
      updatedAt: timestamp
    };

    this.sequence += 1;
    this.events.push(next);

    return clone(next);
  }

  getActiveBatch() {
    if (!this.activeBatchId) {
      return null;
    }

    const event = this.events.find(
      (item) =>
        item.type === "batch" &&
        item.batch?.id === this.activeBatchId
    );

    return event?.batch
      ? clone(event.batch)
      : null;
  }

  beginBatch(objective, timestamp = Date.now()) {
    const normalized = String(objective ?? "").trim() || "继续处理当前任务";

    if (this.activeBatchId) {
      this.closeBatch("completed", timestamp);
    }

    this.batchRevision += 1;
    const id = `batch:${this.runId}:${this.batchRevision}`;
    this.activeBatchId = id;

    this.upsertEvent({
      id,
      type: "batch",
      status: "running",
      title: normalized,
      createdAt: timestamp,
      updatedAt: timestamp,
      batch: {
        id,
        objective: normalized,
        status: "running",
        startedAt: nowValue(timestamp),
        endedAt: null
      }
    });

    return this.getActiveBatch();
  }

  closeBatch(status = "completed", timestamp = Date.now()) {
    const active = this.getActiveBatch();

    if (!active) {
      return null;
    }

    const normalizedStatus = ["failed", "cancelled"].includes(status)
      ? status
      : "completed";

    const updated = this.upsertEvent({
      id: active.id,
      type: "batch",
      status: normalizedStatus,
      title: active.objective,
      updatedAt: timestamp,
      batch: {
        ...active,
        status: normalizedStatus,
        endedAt: nowValue(timestamp)
      }
    });

    this.activeBatchId = "";
    return updated.batch;
  }

  recordCommentary({
    content,
    phase = "between_tools",
    objective = ""
  } = {}, timestamp = Date.now()) {
    const normalized = String(content ?? "").trim();

    if (!normalized) {
      return null;
    }

    const duplicate =
      [...this.events]
        .reverse()
        .find(
          (event) =>
            event.type === "commentary"
        );

    if (
      duplicate?.content ===
        normalized
    ) {
      return duplicate;
    }

    const normalizedPhase = commentaryPhase(phase);
    let batch = this.getActiveBatch();

    if (normalizedPhase === "before_tools") {
      batch = this.beginBatch(objective || normalized, timestamp);
    } else if (!batch && normalizedPhase !== "after_tools") {
      batch = this.beginBatch(objective || normalized, timestamp);
    }

    this.commentaryRevision += 1;
    const event = this.upsertEvent({
      id: `commentary:${this.runId}:${this.commentaryRevision}`,
      type: "commentary",
      status: "completed",
      title: objective || batch?.objective || "进度更新",
      content: normalized,
      phase: normalizedPhase,
      batchId: batch?.id ?? "",
      createdAt: timestamp,
      updatedAt: timestamp
    });

    if (normalizedPhase === "after_tools") {
      this.closeBatch("completed", timestamp);
    }

    return event;
  }

  upsertTool(record) {
    const timestamp = nowValue(
      record.endedAt ?? record.startedAt ?? Date.now()
    );
    let batch = record.batch ?? this.getActiveBatch();

    if (!batch) {
      batch = this.beginBatch(
        record.planStep?.title ?? record.title ?? record.name,
        record.queuedAt ?? record.startedAt ?? timestamp
      );
    }

    return this.upsertEvent({
      id: `tool:${record.id}`,
      type: "tool",
      status: canonicalToolStatus(record.status),
      title: record.title ?? record.name ?? "工具调用",
      batchId: batch?.id ?? "",
      createdAt: record.queuedAt ?? record.startedAt ?? timestamp,
      updatedAt: timestamp,
      tool: {
        id: record.id,
        name: record.name,
        title: record.title,
        source: record.source,
        riskLevel: record.riskLevel,
        sideEffect: record.sideEffect,
        countsTowardLimit:
          record.countsTowardLimit !== false,
        countsTowardRepeatLimit:
          record.countsTowardRepeatLimit !== false,
        activityVisibility:
          record.activityVisibility ?? "normal",
        gracefulBoundary:
          record.gracefulBoundary === true,
        status: canonicalToolStatus(record.status),
        batchId: batch?.id ?? "",
        batchObjective: batch?.objective ?? "",
        input: clone(record.input),
        output:
          record.output === undefined
            ? undefined
            : clone(record.output),
        result:
          record.result === undefined
            ? undefined
            : clone(record.result),
        meta:
          record.meta === undefined
            ? undefined
            : clone(record.meta),
        planStep:
          record.planStep === undefined
            ? undefined
            : clone(record.planStep),
        queuedAt: record.queuedAt,
        startedAt: record.startedAt,
        endedAt: record.endedAt,
        durationMs: record.durationMs ?? 0,
        attempt: record.attempt ?? 0,
        maxAttempts: record.maxAttempts ?? 0,
        lastError:
          record.lastError === undefined
            ? undefined
            : clone(record.lastError)
      }
    });
  }

  recordPlan(
    items,
    timestamp = Date.now(),
    change = null
  ) {
    const plan = Array.isArray(items)
      ? clone(items)
      : [];
    const signature = JSON.stringify(plan);

    if (signature === this.lastPlanSignature) {
      return null;
    }

    this.lastPlanSignature = signature;
    this.planRevision += 1;

    return this.upsertEvent({
      id: `plan:${this.runId}:${this.planRevision}`,
      type: "plan",
      status: planEventStatus(plan),
      title:
        this.planRevision === 1
          ? `制定了一个 ${plan.length} 步计划`
          : "更新了任务计划",
      batchId: this.activeBatchId,
      createdAt: timestamp,
      updatedAt: timestamp,
      reason:
        String(
          change?.reason ?? ""
        ).trim(),
      revision:
        Number(change?.revision) ||
        this.planRevision,
      plan
    });
  }

  recordProgress({
    title,
    status = "running",
    stopReason = "",
    batchId = this.activeBatchId
  } = {}, timestamp = Date.now()) {
    const normalizedTitle = String(title ?? "").trim();

    if (!normalizedTitle) {
      return null;
    }

    this.progressRevision += 1;

    return this.upsertEvent({
      id: `progress:${this.runId}:${this.progressRevision}`,
      type: "status",
      status: String(status || "running"),
      title: normalizedTitle,
      stopReason: String(stopReason || ""),
      batchId: String(batchId || ""),
      category: "runtime",
      activityVisibility: "developer",
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  updateCheckpoint(checkpoint) {
    this.checkpoint =
      checkpoint &&
      typeof checkpoint === "object"
        ? clone(checkpoint)
        : null;

    return this.checkpoint
      ? clone(this.checkpoint)
      : null;
  }

  markStatus(
    status,
    {
      title = "",
      stopReason = "",
      timestamp = Date.now()
    } = {}
  ) {
    this.status = String(status || "running");
    this.stopReason = String(stopReason || "");

    return this.upsertEvent({
      id: `run:${this.runId || this.taskId}`,
      type: "status",
      status: this.status,
      title: title || this.status,
      stopReason: this.stopReason,
      category: "runtime",
      activityVisibility: "developer",
      updatedAt: timestamp
    });
  }

  finalize(
    stopReason,
    endedAt = Date.now(),
    {
      status = "",
      outcome = "",
      resumable = false
    } = {}
  ) {
    this.stopReason = normalizeRunStopReason(stopReason);
    this.status = String(status || runStatusFromStopReason(this.stopReason));
    this.outcome = String(outcome || this.status);
    this.resumable = resumable === true;
    this.endedAt = nowValue(endedAt);

    if (this.activeBatchId) {
      this.closeBatch(
        this.status === "failed"
          ? "failed"
          : this.status === "cancelled"
            ? "cancelled"
            : "completed",
        this.endedAt
      );
    }

    this.upsertEvent({
      id: `run:${this.runId || this.taskId}`,
      type: "status",
      status:
        this.status === "checkpoint_ready"
          ? "completed"
          : this.status,
      title:
        this.status === "checkpoint_ready"
          ? "当前进展已整理"
          : this.status,
      stopReason: this.stopReason,
      category: "runtime",
      activityVisibility: "developer",
      updatedAt: this.endedAt
    });

    return this.snapshot();
  }

  snapshot() {
    const endedAt = this.endedAt;
    const currentEnd = endedAt ?? Date.now();
    const resumable =
      this.resumable &&
      Boolean(this.checkpoint);

    return {
      version: 3,
      taskId: this.taskId,
      runId: this.runId,
      status: this.status,
      outcome: this.outcome,
      startedAt: this.startedAt,
      endedAt,
      durationMs: Math.max(0, currentEnd - this.startedAt),
      stopReason: this.stopReason,
      resumable,
      completionState:
        resumable ? "partial" : "terminal",
      checkpoint:
        this.checkpoint
          ? clone(this.checkpoint)
          : null,
      events: clone(this.events)
    };
  }
}
