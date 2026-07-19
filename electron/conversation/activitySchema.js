import {
  normalizeRunStopReason,
  runStatusFromStopReason
} from "../agent/runStopReasons.js";

function stringValue(
  value,
  fallback = "",
  maxLength = 200000
) {
  return typeof value === "string"
    ? value.slice(0, maxLength)
    : fallback;
}

function timestampValue(value, fallback = 0) {
  const numeric = Number(value);

  return Number.isFinite(numeric)
    ? Math.max(0, Math.round(numeric))
    : fallback;
}

function jsonValue(value, maxLength = 50000) {
  if (value === undefined) {
    return undefined;
  }

  try {
    const text = JSON.stringify(value);

    if (text.length <= maxLength) {
      return JSON.parse(text);
    }

    return {
      truncated: true,
      preview: text.slice(0, maxLength)
    };
  } catch {
    return String(value).slice(0, maxLength);
  }
}

function normalizeToolStatus(value) {
  if (value === "queued") {
    return "queued";
  }

  if (["running", "in_progress", "retrying"].includes(value)) {
    return value === "retrying"
      ? "retrying"
      : "running";
  }

  if (["cancelled", "aborted"].includes(value)) {
    return "cancelled";
  }

  if (["failed", "error"].includes(value)) {
    return "failed";
  }

  return "completed";
}

function sanitizePlanItem(source, index) {
  if (!source || typeof source !== "object") {
    return null;
  }

  const title = stringValue(
    source.title,
    "",
    200
  ).trim();

  if (!title) {
    return null;
  }

  const allowed = new Set([
    "pending",
    "in_progress",
    "completed",
    "blocked",
    "needs_input",
    "skipped",
    "cancelled",
    "superseded"
  ]);

  return {
    id:
      stringValue(
        source.id,
        `step-${index + 1}`,
        80
      ) || `step-${index + 1}`,
    title,
    status: allowed.has(source.status)
      ? source.status
      : "pending",
    reason: stringValue(
      source.reason,
      "",
      300
    ).trim()
  };
}

function sanitizeToolResult(source) {
  if (!source || typeof source !== "object") {
    return null;
  }

  const status = [
    "success",
    "error",
    "cancelled"
  ].includes(source.status)
    ? source.status
    : source.error
      ? "error"
      : "success";

  const result = {
    status,
    summary: stringValue(
      source.summary,
      "",
      400
    ),
    preview: stringValue(
      source.preview,
      "",
      2400
    ),
    truncated: Boolean(source.truncated),
    originalBytes: timestampValue(
      source.originalBytes,
      0
    ),
    storedBytes: timestampValue(
      source.storedBytes,
      0
    ),
    clipped: Boolean(source.clipped)
  };

  const data = jsonValue(source.data, 32000);
  const error = jsonValue(source.error, 8000);
  const reference = jsonValue(
    source.reference,
    1000
  );

  if (data !== undefined) {
    result.data = data;
  }

  if (error !== undefined) {
    result.error = error;
  }

  if (reference !== undefined) {
    result.reference = reference;
  }

  return result;
}

export function sanitizeActivityTool(
  source,
  index = 0
) {
  if (!source || typeof source !== "object") {
    return null;
  }

  const name = stringValue(
    source.name,
    "",
    120
  ).trim();

  if (!name) {
    return null;
  }

  const tool = {
    id:
      stringValue(
        source.id,
        `tool-${index + 1}`,
        120
      ) || `tool-${index + 1}`,
    name,
    title: stringValue(
      source.title,
      "",
      200
    ),
    status: normalizeToolStatus(
      source.status
    ),
    queuedAt: timestampValue(
      source.queuedAt,
      0
    ),
    startedAt: timestampValue(
      source.startedAt,
      0
    ),
    endedAt: timestampValue(
      source.endedAt,
      0
    ),
    durationMs: timestampValue(
      source.durationMs,
      0
    ),
    batchId: stringValue(
      source.batchId,
      "",
      160
    ),
    batchObjective: stringValue(
      source.batchObjective,
      "",
      240
    ),
    source: stringValue(
      source.source,
      "",
      120
    ),
    riskLevel: stringValue(
      source.riskLevel,
      "none",
      40
    ),
    sideEffect: stringValue(
      source.sideEffect,
      "none",
      40
    ),
    countsTowardLimit:
      source.countsTowardLimit !== false,
    countsTowardRepeatLimit:
      source.countsTowardRepeatLimit !== false,
    activityVisibility:
      source.activityVisibility === "developer"
        ? "developer"
        : "normal",
    gracefulBoundary:
      source.gracefulBoundary === true,
    attempt: timestampValue(
      source.attempt,
      0
    ),
    maxAttempts: timestampValue(
      source.maxAttempts,
      0
    )
  };

  const input = jsonValue(source.input, 24000);
  const output = jsonValue(source.output, 24000);
  const meta = jsonValue(source.meta, 8000);
  const result = sanitizeToolResult(
    source.result
  );
  const lastError = jsonValue(
    source.lastError,
    8000
  );
  const planStep =
    source.planStep &&
    typeof source.planStep === "object"
      ? {
          id: stringValue(
            source.planStep.id,
            "",
            80
          ),
          title: stringValue(
            source.planStep.title,
            "",
            200
          )
        }
      : null;

  if (input !== undefined) {
    tool.input = input;
  }

  if (output !== undefined) {
    tool.output = output;
  }

  if (meta !== undefined) {
    tool.meta = meta;
  }

  if (result) {
    tool.result = result;
  }

  if (lastError !== undefined) {
    tool.lastError = lastError;
  }

  if (
    planStep?.id ||
    planStep?.title
  ) {
    tool.planStep = planStep;
  }

  return tool;
}

function sanitizeActivityEvent(source, index) {
  if (!source || typeof source !== "object") {
    return null;
  }

  const type = [
    "status",
    "tool",
    "plan",
    "commentary",
    "batch"
  ].includes(source.type)
    ? source.type
    : null;

  if (!type) {
    return null;
  }

  const event = {
    id:
      stringValue(
        source.id,
        `event-${index + 1}`,
        160
      ) || `event-${index + 1}`,
    type,
    sequence: timestampValue(
      source.sequence,
      index
    ),
    status: stringValue(
      source.status,
      "completed",
      40
    ),
    title: stringValue(
      source.title,
      "",
      240
    ),
    createdAt: timestampValue(
      source.createdAt,
      0
    ),
    updatedAt: timestampValue(
      source.updatedAt,
      timestampValue(source.createdAt, 0)
    ),
    batchId: stringValue(
      source.batchId,
      "",
      160
    )
  };

  if (type === "tool") {
    const tool = sanitizeActivityTool(
      source.tool,
      index
    );

    if (!tool) {
      return null;
    }

    event.tool = tool;
    event.status = tool.status;
  }

  if (type === "plan") {
    const plan = Array.isArray(source.plan)
      ? source.plan
          .map(sanitizePlanItem)
          .filter(Boolean)
          .slice(0, 20)
      : [];

    event.plan = plan;
    event.reason = stringValue(
      source.reason,
      "",
      500
    ).trim();
    event.revision = timestampValue(
      source.revision,
      0
    );
  }

  if (type === "commentary") {
    event.content = stringValue(
      source.content,
      "",
      4000
    ).trim();
    event.phase = [
      "before_tools",
      "between_tools",
      "after_tools"
    ].includes(source.phase)
      ? source.phase
      : "between_tools";

    if (!event.content) {
      return null;
    }
  }

  if (type === "batch") {
    const batch = source.batch && typeof source.batch === "object"
      ? {
          id: stringValue(source.batch.id, event.id, 160),
          objective: stringValue(source.batch.objective, event.title, 240),
          status: stringValue(source.batch.status, event.status, 40),
          startedAt: timestampValue(source.batch.startedAt, event.createdAt),
          endedAt:
            source.batch.endedAt === null
              ? null
              : timestampValue(source.batch.endedAt, 0)
        }
      : null;

    if (!batch?.id) {
      return null;
    }

    event.batch = batch;
    event.batchId = batch.id;
  }

  if (type === "status") {
    event.stopReason = normalizeRunStopReason(
      source.stopReason,
      "unknown"
    );
  }

  return event;
}

function sanitizeCheckpoint(source) {
  if (
    !source ||
    typeof source !== "object"
  ) {
    return null;
  }

  const checkpoint = jsonValue(
    source,
    48000
  );

  if (
    !checkpoint ||
    typeof checkpoint !== "object"
  ) {
    return null;
  }

  const sanitizedCheckpoint = {
    ...checkpoint
  };
  delete sanitizedCheckpoint.answeredQuestions;
  delete sanitizedCheckpoint.pendingQuestion;

  return {
    ...sanitizedCheckpoint,
    version: 1,
    taskId: stringValue(
      checkpoint.taskId,
      "",
      120
    ),
    runId: stringValue(
      checkpoint.runId,
      "",
      120
    ),
    messageId: stringValue(
      checkpoint.messageId,
      "",
      120
    ),
    phase: stringValue(
      checkpoint.phase,
      "executing",
      40
    ),
    stopReason: stringValue(
      checkpoint.stopReason,
      "",
      80
    ),
    updatedAt: timestampValue(
      checkpoint.updatedAt,
      0
    )
  };
}

export function sanitizeActivity(source) {
  if (!source || typeof source !== "object") {
    return null;
  }

  const stopReason = normalizeRunStopReason(
    source.stopReason,
    "unknown"
  );
  const status = [
    "running",
    "completed",
    "needs_input",
    "blocked",
    "cancelling",
    "cancelled",
    "interrupted",
    "checkpoint_ready",
    "failed",
    "unknown",
    "resumed"
  ].includes(source.status)
    ? source.status
    : runStatusFromStopReason(stopReason);
  const events = Array.isArray(source.events)
    ? source.events
        .map(sanitizeActivityEvent)
        .filter(Boolean)
        .slice(0, 240)
    : [];

  events.sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt;
    }

    return left.sequence - right.sequence;
  });

  return {
    version: 3,
    taskId: stringValue(
      source.taskId,
      "",
      120
    ),
    runId: stringValue(
      source.runId,
      "",
      120
    ),
    status,
    startedAt: timestampValue(
      source.startedAt,
      0
    ),
    endedAt:
      source.endedAt === null
        ? null
        : timestampValue(
            source.endedAt,
            0
          ),
    durationMs: timestampValue(
      source.durationMs,
      0
    ),
    stopReason,
    resumable:
      source.resumable === true ||
      status === "checkpoint_ready",
    completionState:
      status === "checkpoint_ready"
        ? "partial"
        : "terminal",
    checkpoint:
      sanitizeCheckpoint(
        source.checkpoint
      ),
    events
  };
}

export function createLegacyActivity({
  messageId,
  createdAt,
  durationMs = 0,
  toolCalls = [],
  plan = [],
  stopReason = "completed",
  taskId = ""
} = {}) {
  const normalizedReason = normalizeRunStopReason(
    stopReason,
    "completed"
  );
  const endedAt = timestampValue(
    createdAt,
    Date.now()
  );
  const startedAt = Math.max(
    0,
    endedAt - timestampValue(durationMs, 0)
  );
  const events = [];
  let sequence = 0;

  if (plan.length > 0) {
    events.push({
      id: `legacy-plan:${messageId}`,
      type: "plan",
      sequence: sequence++,
      status: "completed",
      title: `任务计划 · ${plan.length} 步`,
      createdAt: startedAt,
      updatedAt: endedAt,
      plan
    });
  }

  for (const tool of toolCalls) {
    events.push({
      id: `tool:${tool.id}`,
      type: "tool",
      sequence: sequence++,
      status: normalizeToolStatus(tool.status),
      title: tool.title || tool.name,
      createdAt:
        tool.queuedAt ||
        tool.startedAt ||
        startedAt,
      updatedAt:
        tool.endedAt ||
        endedAt,
      tool
    });
  }

  events.push({
    id: `legacy-status:${messageId}`,
    type: "status",
    sequence,
    status: runStatusFromStopReason(
      normalizedReason
    ),
    title: normalizedReason,
    stopReason: normalizedReason,
    createdAt: startedAt,
    updatedAt: endedAt
  });

  return sanitizeActivity({
    version: 1,
    taskId: taskId || messageId,
    runId: messageId,
    status: runStatusFromStopReason(
      normalizedReason
    ),
    startedAt,
    endedAt,
    durationMs: timestampValue(durationMs, 0),
    stopReason: normalizedReason,
    events
  });
}

export function deriveLegacyActivityFields(activity) {
  const normalized = sanitizeActivity(activity);

  if (!normalized) {
    return {
      plan: [],
      toolCalls: []
    };
  }

  const planEvent = [...normalized.events]
    .reverse()
    .find((event) => event.type === "plan");
  const toolCalls = normalized.events
    .filter((event) => event.type === "tool")
    .map((event) => event.tool);


  return {
    plan: planEvent?.plan ?? [],
    toolCalls
  };
}
