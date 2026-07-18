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

  if (["running", "in_progress"].includes(status)) {
    return "running";
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
      ["completed", "complete", "skipped"].includes(item?.status)
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
    this.stopReason = "";
    this.events = [];
    this.sequence = 0;
    this.planRevision = 0;
    this.commentaryRevision = 0;
    this.batchRevision = 0;
    this.questionRevision = 0;
    this.lastPlanSignature = "";
    this.activeBatchId = "";

    this.upsertEvent({
      id: `run:${this.runId || this.taskId}`,
      type: "status",
      status: "running",
      title: "开始处理任务",
      createdAt: this.startedAt,
      updatedAt: this.startedAt
    });
  }

  static resumeFromSnapshot(
    snapshot,
    {
      answeredQuestion = null,
      resumedAt = Date.now(),
      runId = "",
      taskId = ""
    } = {}
  ) {
    const source =
      snapshot &&
      typeof snapshot === "object"
        ? snapshot
        : {};

    const store = new RunActivityStore({
      taskId:
        source.taskId ?? taskId,
      runId:
        source.runId ?? runId,
      startedAt:
        source.startedAt ??
        resumedAt
    });

    store.events = Array.isArray(
      source.events
    )
      ? clone(source.events)
      : [];
    store.sequence =
      store.events.reduce(
        (maximum, event) =>
          Math.max(
            maximum,
            Number(event.sequence) || 0
          ),
        -1
      ) + 1;
    store.planRevision =
      store.events.filter(
        (event) =>
          event.type === "plan"
      ).length;
    store.commentaryRevision =
      store.events.filter(
        (event) =>
          event.type === "commentary"
      ).length;
    store.batchRevision =
      store.events.filter(
        (event) =>
          event.type === "batch"
      ).length;
    store.questionRevision =
      store.events.filter(
        (event) =>
          event.type === "question"
      ).length;
    const latestPlan =
      [...store.events]
        .reverse()
        .find(
          (event) =>
            event.type === "plan"
        )?.plan ?? [];
    store.lastPlanSignature =
      JSON.stringify(latestPlan);
    store.activeBatchId = "";
    store.status = "running";
    store.stopReason = "";
    store.endedAt = null;

    if (answeredQuestion) {
      store.markQuestionAnswered(
        answeredQuestion,
        resumedAt
      );
    }

    store.upsertEvent({
      id: `run:${store.runId || store.taskId}`,
      type: "status",
      status: "running",
      title: "继续处理任务",
      stopReason: "",
      updatedAt: resumedAt
    });

    return store;
  }

  markQuestionAnswered(
    answer,
    timestamp = Date.now()
  ) {
    const event = [...this.events]
      .reverse()
      .find(
        (item) =>
          item.type === "question" &&
          item.status ===
            "waiting_for_user"
      );

    if (!event) {
      return null;
    }

    return this.upsertEvent({
      ...event,
      status: "answered",
      updatedAt: timestamp,
      question: {
        ...clone(event.question),
        ...clone(answer),
        status: "answered",
        answeredAt: nowValue(timestamp)
      }
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
    if (record?.name === "report_progress") {
      return null;
    }

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
        durationMs: record.durationMs ?? 0
      }
    });
  }

  recordPlan(items, timestamp = Date.now()) {
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
      plan
    });
  }

  recordQuestion(request, timestamp = Date.now()) {
    if (!request?.question) {
      return null;
    }

    this.questionRevision += 1;

    return this.upsertEvent({
      id: `question:${this.runId}:${this.questionRevision}`,
      type: "question",
      status: "waiting_for_user",
      title: "等待你的回答",
      batchId: this.activeBatchId,
      createdAt: timestamp,
      updatedAt: timestamp,
      question: clone(request)
    });
  }

  recordSummary(content, timestamp = Date.now()) {
    const normalized = String(content ?? "").trim();

    if (!normalized) {
      return null;
    }

    return this.upsertEvent({
      id: `summary:${this.runId}`,
      type: "summary",
      status: "completed",
      title: "模型推理文本",
      content: normalized,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  finalize(stopReason, endedAt = Date.now()) {
    this.stopReason = normalizeRunStopReason(stopReason);
    this.status = runStatusFromStopReason(this.stopReason);
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
      status: this.status,
      title: this.status,
      stopReason: this.stopReason,
      updatedAt: this.endedAt
    });

    return this.snapshot();
  }

  snapshot() {
    const endedAt = this.endedAt;
    const currentEnd = endedAt ?? Date.now();

    return {
      version: 2,
      taskId: this.taskId,
      runId: this.runId,
      status: this.status,
      startedAt: this.startedAt,
      endedAt,
      durationMs: Math.max(0, currentEnd - this.startedAt),
      stopReason: this.stopReason,
      events: clone(this.events)
    };
  }
}
