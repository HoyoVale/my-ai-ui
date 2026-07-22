import {
  compactPlanState
} from "./planState.js";

import {
  isExplicitContinuationMessage,
  isExplicitNewTask
} from "./checkpointResume.js";

const THREAD_STATUSES = new Set([
  "active",
  "waiting",
  "completed",
  "failed",
  "cancelled"
]);

function text(value, maxLength = 1200) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function timestamp(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

function cloneObject(value) {
  return value && typeof value === "object" ? structuredClone(value) : null;
}

export function sanitizeExecutionThread(source) {
  if (!source || typeof source !== "object") return null;
  const id = text(source.id, 120);
  const taskId = text(source.taskId, 120);
  if (!id || !taskId) return null;
  const planState = compactPlanState(source.planState ?? source.plan ?? [], {
    maxRootItems: 40,
    maxSubplans: 24,
    maxSubplanItems: 40
  });
  return {
    version: 1,
    id,
    taskId,
    goalId: text(source.goalId, 120),
    platformRunId: text(source.platformRunId, 120),
    objective: text(source.objective, 2000),
    status: THREAD_STATUSES.has(source.status) ? source.status : "active",
    mode: source.mode === "coding" ? "coding" : "chat",
    workspaceId: text(source.workspaceId, 120),
    rootPlanId: text(source.rootPlanId ?? planState.rootPlanId, 160),
    planState,
    workingState: cloneObject(source.workingState),
    checkpoint: cloneObject(source.checkpoint),
    lastRunId: text(source.lastRunId, 120),
    lastAssistantMessageId: text(source.lastAssistantMessageId, 120),
    continuationCount: Math.max(0, Math.round(Number(source.continuationCount) || 0)),
    stopReason: text(source.stopReason, 100),
    resumable: source.resumable === true,
    createdAt: timestamp(source.createdAt, Date.now()),
    updatedAt: timestamp(source.updatedAt, Date.now()),
    completedAt: source.completedAt == null ? null : timestamp(source.completedAt, 0)
  };
}

export function shouldReuseExecutionThread({
  thread,
  message,
  explicit = false
} = {}) {
  const normalized = sanitizeExecutionThread(thread);
  if (!normalized || isExplicitNewTask(message)) return false;
  if (explicit || isExplicitContinuationMessage(message)) return true;
  return ["active", "waiting"].includes(normalized.status);
}

export function createExecutionThread({
  id,
  taskId,
  goalId = "",
  platformRunId = "",
  objective = "",
  mode = "chat",
  workspaceId = "",
  planState = [],
  workingState = null,
  runId = "",
  now = Date.now()
} = {}) {
  return sanitizeExecutionThread({
    id,
    taskId,
    goalId,
    platformRunId,
    objective,
    status: "active",
    mode,
    workspaceId,
    planState,
    workingState,
    lastRunId: runId,
    continuationCount: 0,
    resumable: true,
    createdAt: now,
    updatedAt: now
  });
}

export function beginExecutionThreadRun(threadSource, {
  runId,
  goalId = "",
  platformRunId = "",
  objective = "",
  planState = null,
  workingState = null,
  now = Date.now()
} = {}) {
  const thread = sanitizeExecutionThread(threadSource);
  if (!thread) return null;
  return sanitizeExecutionThread({
    ...thread,
    goalId: goalId || thread.goalId,
    platformRunId: platformRunId || thread.platformRunId,
    objective: objective || thread.objective,
    status: "active",
    planState: planState ?? thread.planState,
    workingState: workingState ?? thread.workingState,
    lastRunId: runId || thread.lastRunId,
    continuationCount: thread.lastRunId && runId && thread.lastRunId !== runId
      ? thread.continuationCount + 1
      : thread.continuationCount,
    stopReason: "",
    resumable: true,
    completedAt: null,
    updatedAt: now
  });
}

export function recordExecutionThreadCheckpoint(threadSource, {
  checkpoint,
  planState = null,
  workingState = null,
  runId = "",
  now = Date.now()
} = {}) {
  const thread = sanitizeExecutionThread(threadSource);
  if (!thread) return null;
  return sanitizeExecutionThread({
    ...thread,
    checkpoint: checkpoint ?? thread.checkpoint,
    planState: planState ?? checkpoint?.planState ?? thread.planState,
    workingState: workingState ?? checkpoint?.workingState ?? thread.workingState,
    lastRunId: runId || checkpoint?.runId || thread.lastRunId,
    rootPlanId: checkpoint?.planState?.rootPlanId || thread.rootPlanId,
    updatedAt: now
  });
}

export function finishExecutionThreadRun(threadSource, {
  outcome = "",
  stopReason = "",
  checkpoint = null,
  planState = null,
  workingState = null,
  lastAssistantMessageId = "",
  resumable = false,
  now = Date.now()
} = {}) {
  const thread = sanitizeExecutionThread(threadSource);
  if (!thread) return null;
  const status = outcome === "completed"
    ? "completed"
    : outcome === "cancelled"
      ? "cancelled"
      : resumable || outcome === "continuable"
        ? "waiting"
        : "failed";
  return sanitizeExecutionThread({
    ...thread,
    status,
    stopReason,
    checkpoint: checkpoint ?? thread.checkpoint,
    planState: planState ?? checkpoint?.planState ?? thread.planState,
    workingState: workingState ?? checkpoint?.workingState ?? thread.workingState,
    lastAssistantMessageId: lastAssistantMessageId || thread.lastAssistantMessageId,
    resumable: status === "waiting",
    completedAt: status === "completed" ? now : null,
    updatedAt: now
  });
}

export function recoverInterruptedExecutionThread(threadSource, {
  now = Date.now()
} = {}) {
  const thread = sanitizeExecutionThread(threadSource);
  if (!thread || thread.status !== "active") {
    return { changed: false, thread };
  }
  return {
    changed: true,
    thread: sanitizeExecutionThread({
      ...thread,
      status: "waiting",
      stopReason: "interrupted",
      resumable: true,
      updatedAt: now
    })
  };
}

export function resolveExecutionThreadContinuation({
  conversation,
  message,
  explicit = false
} = {}) {
  const thread = sanitizeExecutionThread(conversation?.executionThread);
  if (!shouldReuseExecutionThread({ thread, message, explicit })) return null;
  return {
    messageId: thread.lastAssistantMessageId,
    source: "execution_thread",
    activity: {
      status: "checkpoint_ready",
      resumable: true
    },
    checkpoint: {
      version: 6,
      executionThreadId: thread.id,
      goalId: thread.goalId,
      taskId: thread.taskId,
      runId: thread.lastRunId,
      messageId: thread.lastAssistantMessageId,
      objective: thread.objective,
      mode: thread.mode,
      workspaceId: thread.workspaceId,
      planState: thread.planState,
      plan: thread.planState.rootItems,
      continuationCount: thread.continuationCount,
      resumable: true,
      stopReason: thread.stopReason || "execution-thread-continuation",
      workingState: thread.workingState,
      threadStatus: thread.status
    }
  };
}
