import {
  compactPlanState
} from "./planState.js";

import {
  isExplicitContinuationMessage,
  isExplicitNewTask
} from "./checkpointResume.js";

import {
  RUN_RELATIONS,
  RUN_STATES_V2,
  createRunIdentity,
  sanitizeRunIdentity,
  transitionRunIdentity
} from "../execution-model/RunIdentityContract.js";

const THREAD_STATUSES = new Set([
  "created",
  "active",
  "running",
  "waiting",
  "continuable",
  "completed",
  "failed",
  "cancelled",
  "archived"
]);

const MAX_RUNS = 120;

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

function sanitizeProviderContinuation(source) {
  if (!source || typeof source !== "object") return null;
  const providerId = text(source.providerId, 120);
  const modelConfigId = text(source.modelConfigId, 120);
  const responseId = text(source.responseId, 500);
  if (!providerId || !modelConfigId || !responseId) return null;
  return {
    version: 1,
    providerId,
    modelConfigId,
    responseId,
    compatible: source.compatible !== false,
    createdAt: timestamp(source.createdAt, Date.now()),
    updatedAt: timestamp(source.updatedAt, Date.now())
  };
}

function sanitizeRuns(source, threadId) {
  const seen = new Set();
  return (Array.isArray(source) ? source : [])
    .map((run) => sanitizeRunIdentity({ ...run, threadId: run?.threadId || threadId }))
    .filter((run) => {
      if (!run || run.threadId !== threadId || seen.has(run.id)) return false;
      seen.add(run.id);
      return true;
    })
    .sort((left, right) => left.sequence - right.sequence || left.createdAt - right.createdAt)
    .slice(-MAX_RUNS);
}

function runTerminalState(outcome, resumable) {
  if (outcome === "completed") return RUN_STATES_V2.COMPLETED;
  if (outcome === "cancelled") return RUN_STATES_V2.CANCELLED;
  if (resumable || outcome === "continuable") return RUN_STATES_V2.CONTINUABLE;
  return RUN_STATES_V2.FAILED;
}

function updateLastRun(runs, runId, nextState, now) {
  if (!runId) return runs;
  const index = runs.findIndex((run) => run.id === runId);
  if (index < 0) return runs;
  let current = runs[index];
  if (
    nextState === RUN_STATES_V2.COMPLETED &&
    current.state === RUN_STATES_V2.RUNNING
  ) {
    const finalizing = transitionRunIdentity(
      current,
      RUN_STATES_V2.FINALIZING,
      { now }
    );
    if (!finalizing.ok) return runs;
    current = finalizing.run;
  }
  const transitioned = transitionRunIdentity(current, nextState, { now });
  if (!transitioned.ok) return runs;
  const next = [...runs];
  next[index] = transitioned.run;
  return next;
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
  let runs = sanitizeRuns(source.runs, id);
  const legacyLastRunId = text(source.lastRunId, 120);
  if (!runs.length && legacyLastRunId) {
    const legacyState = source.status === "completed"
      ? RUN_STATES_V2.COMPLETED
      : source.status === "cancelled"
        ? RUN_STATES_V2.CANCELLED
        : source.status === "failed"
          ? RUN_STATES_V2.FAILED
          : source.status === "waiting" || source.resumable === true
            ? RUN_STATES_V2.CONTINUABLE
            : RUN_STATES_V2.RUNNING;
    const legacyRun = createRunIdentity({
      id: legacyLastRunId,
      threadId: id,
      sequence: 1,
      state: legacyState,
      relation: RUN_RELATIONS.INITIAL,
      now: timestamp(source.updatedAt, Date.now())
    });
    if (legacyRun) runs = [legacyRun];
  }
  const lastRunId = legacyLastRunId || runs.at(-1)?.id || "";
  return {
    version: 2,
    id,
    taskId,
    revision: Math.max(1, Math.round(Number(source.revision) || 1)),
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
    runs,
    lastRunId,
    lastAssistantMessageId: text(source.lastAssistantMessageId, 120),
    continuationCount: Math.max(0, Math.round(Number(source.continuationCount) || 0)),
    stopReason: text(source.stopReason, 100),
    resumable: source.resumable === true,
    forkedFromThreadId: text(source.forkedFromThreadId, 120),
    forkedFromRunId: text(source.forkedFromRunId, 120),
    providerContinuation: sanitizeProviderContinuation(source.providerContinuation),
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
  return ["active", "running", "waiting", "continuable"].includes(normalized.status);
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
  userMessageId = "",
  forkedFromThreadId = "",
  forkedFromRunId = "",
  now = Date.now()
} = {}) {
  const initialRun = runId
    ? createRunIdentity({
        id: runId,
        threadId: id,
        sequence: 1,
        state: RUN_STATES_V2.RUNNING,
        relation: forkedFromThreadId ? RUN_RELATIONS.FORK : RUN_RELATIONS.INITIAL,
        userMessageId,
        forkedFromThreadId,
        forkedFromRunId,
        now
      })
    : null;
  return sanitizeExecutionThread({
    id,
    taskId,
    goalId,
    platformRunId,
    objective,
    status: "running",
    mode,
    workspaceId,
    planState,
    workingState,
    runs: initialRun ? [initialRun] : [],
    lastRunId: runId,
    continuationCount: 0,
    resumable: true,
    forkedFromThreadId,
    forkedFromRunId,
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
  relation = "",
  previousRunId = "",
  retryOfRunId = "",
  regeneratedFromRunId = "",
  userMessageId = "",
  now = Date.now()
} = {}) {
  const thread = sanitizeExecutionThread(threadSource);
  if (!thread) return null;
  let runs = [...thread.runs];
  const existingRun = runs.find((run) => run.id === runId);
  if (!existingRun && runId) {
    const resolvedPreviousRunId = previousRunId || thread.lastRunId;
    const resolvedRelation = Object.values(RUN_RELATIONS).includes(relation)
      ? relation
      : regeneratedFromRunId
        ? RUN_RELATIONS.REGENERATE
        : retryOfRunId
          ? RUN_RELATIONS.RETRY
          : thread.lastRunId
            ? RUN_RELATIONS.RESUME
            : RUN_RELATIONS.INITIAL;
    const created = createRunIdentity({
      id: runId,
      threadId: thread.id,
      sequence: (runs.at(-1)?.sequence || 0) + 1,
      state: RUN_STATES_V2.RUNNING,
      relation: resolvedRelation,
      userMessageId,
      previousRunId: resolvedPreviousRunId,
      retryOfRunId,
      regeneratedFromRunId,
      forkedFromThreadId: thread.forkedFromThreadId,
      forkedFromRunId: thread.forkedFromRunId,
      now
    });
    if (created) runs = [...runs, created].slice(-MAX_RUNS);
  } else if (existingRun && existingRun.state !== RUN_STATES_V2.RUNNING) {
    const transitioned = transitionRunIdentity(existingRun, RUN_STATES_V2.RUNNING, { now });
    if (transitioned.ok) {
      runs = runs.map((run) => run.id === runId ? transitioned.run : run);
    }
  }
  return sanitizeExecutionThread({
    ...thread,
    revision: thread.revision + 1,
    goalId: goalId || thread.goalId,
    platformRunId: platformRunId || thread.platformRunId,
    objective: objective || thread.objective,
    status: "running",
    planState: planState ?? thread.planState,
    workingState: workingState ?? thread.workingState,
    runs,
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
    revision: thread.revision + 1,
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
  const runs = updateLastRun(
    thread.runs,
    thread.lastRunId,
    runTerminalState(outcome, resumable),
    now
  );
  return sanitizeExecutionThread({
    ...thread,
    revision: thread.revision + 1,
    status,
    stopReason,
    checkpoint: checkpoint ?? thread.checkpoint,
    planState: planState ?? checkpoint?.planState ?? thread.planState,
    workingState: workingState ?? checkpoint?.workingState ?? thread.workingState,
    runs,
    lastAssistantMessageId: lastAssistantMessageId || thread.lastAssistantMessageId,
    resumable: status === "waiting",
    completedAt: status === "completed" ? now : null,
    updatedAt: now
  });
}

export function setExecutionThreadProviderContinuation(threadSource, continuation, {
  now = Date.now()
} = {}) {
  const thread = sanitizeExecutionThread(threadSource);
  if (!thread) return null;
  const normalizedContinuation = continuation
    ? sanitizeProviderContinuation({
        ...continuation,
        updatedAt: now,
        createdAt: continuation.createdAt ?? now
      })
    : null;
  if (continuation && !normalizedContinuation) return null;
  return sanitizeExecutionThread({
    ...thread,
    revision: thread.revision + 1,
    providerContinuation: normalizedContinuation,
    updatedAt: now
  });
}

export function recoverInterruptedExecutionThread(threadSource, {
  now = Date.now()
} = {}) {
  const thread = sanitizeExecutionThread(threadSource);
  if (!thread || !["active", "running"].includes(thread.status)) {
    return { changed: false, thread };
  }
  const runs = updateLastRun(
    thread.runs,
    thread.lastRunId,
    RUN_STATES_V2.CONTINUABLE,
    now
  );
  return {
    changed: true,
    thread: sanitizeExecutionThread({
      ...thread,
      revision: thread.revision + 1,
      status: "waiting",
      runs,
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
