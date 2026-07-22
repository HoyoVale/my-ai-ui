export const EXECUTION_ITEM_KINDS = Object.freeze({
  USER_MESSAGE: "user_message",
  ASSISTANT_COMMENTARY: "assistant_commentary",
  ASSISTANT_FINAL: "assistant_final",
  PLAN_UPDATE: "plan_update",
  TOOL_CALL: "tool_call",
  COMMAND: "command",
  FILE_CHANGE: "file_change",
  DIFF: "diff",
  APPROVAL: "approval",
  CHECKPOINT: "checkpoint",
  VERIFICATION: "verification",
  ERROR: "error",
  STATUS: "status"
});

export const EXECUTION_ITEM_STATES = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
  SUPERSEDED: "superseded"
});

export const EXECUTION_ITEM_VISIBILITY = Object.freeze({
  PUBLIC: "public",
  DEVELOPER: "developer",
  INTERNAL: "internal"
});

export const EXECUTION_ITEM_SCOPES = Object.freeze({
  RUN: "run",
  THREAD: "thread"
});

const KINDS = new Set(Object.values(EXECUTION_ITEM_KINDS));
const STATES = new Set(Object.values(EXECUTION_ITEM_STATES));
const VISIBILITIES = new Set(Object.values(EXECUTION_ITEM_VISIBILITY));
const SCOPES = new Set(Object.values(EXECUTION_ITEM_SCOPES));

const TRANSITIONS = Object.freeze({
  [EXECUTION_ITEM_STATES.QUEUED]: new Set([
    EXECUTION_ITEM_STATES.RUNNING,
    EXECUTION_ITEM_STATES.COMPLETED,
    EXECUTION_ITEM_STATES.FAILED,
    EXECUTION_ITEM_STATES.CANCELLED
  ]),
  [EXECUTION_ITEM_STATES.RUNNING]: new Set([
    EXECUTION_ITEM_STATES.COMPLETED,
    EXECUTION_ITEM_STATES.FAILED,
    EXECUTION_ITEM_STATES.CANCELLED
  ]),
  [EXECUTION_ITEM_STATES.COMPLETED]: new Set([
    EXECUTION_ITEM_STATES.SUPERSEDED
  ]),
  [EXECUTION_ITEM_STATES.FAILED]: new Set([
    EXECUTION_ITEM_STATES.SUPERSEDED
  ]),
  [EXECUTION_ITEM_STATES.CANCELLED]: new Set(),
  [EXECUTION_ITEM_STATES.SUPERSEDED]: new Set()
});

function text(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

export function sanitizeExecutionItem(source) {
  if (!source || typeof source !== "object") return null;
  const id = text(source.id);
  const threadId = text(source.threadId);
  const scope = SCOPES.has(source.scope)
    ? source.scope
    : EXECUTION_ITEM_SCOPES.RUN;
  const runId = text(source.runId);
  if (!id || !threadId) return null;
  if (scope === EXECUTION_ITEM_SCOPES.RUN && !runId) return null;
  if (scope === EXECUTION_ITEM_SCOPES.THREAD && runId) return null;
  if (!KINDS.has(source.kind) || !STATES.has(source.status)) return null;

  return {
    version: 1,
    id,
    threadId,
    runId,
    scope,
    sequence: Math.max(1, integer(source.sequence, 1)),
    kind: source.kind,
    status: source.status,
    visibility: VISIBILITIES.has(source.visibility)
      ? source.visibility
      : EXECUTION_ITEM_VISIBILITY.PUBLIC,
    sourceType: text(source.sourceType, 80),
    sourceId: text(source.sourceId),
    parentItemId: text(source.parentItemId),
    summary: text(source.summary, 1000),
    resultRef: text(source.resultRef, 500),
    resolved: source.resolved === true,
    supersededBy: text(source.supersededBy),
    createdAt: integer(source.createdAt, Date.now()),
    completedAt: source.completedAt == null
      ? null
      : integer(source.completedAt)
  };
}

export function createExecutionItem({
  id,
  threadId,
  runId = "",
  scope = EXECUTION_ITEM_SCOPES.RUN,
  sequence,
  kind,
  status = EXECUTION_ITEM_STATES.QUEUED,
  visibility = EXECUTION_ITEM_VISIBILITY.PUBLIC,
  sourceType = "",
  sourceId = "",
  parentItemId = "",
  summary = "",
  resultRef = "",
  now = Date.now()
} = {}) {
  return sanitizeExecutionItem({
    id,
    threadId,
    runId,
    scope,
    sequence,
    kind,
    status,
    visibility,
    sourceType,
    sourceId,
    parentItemId,
    summary,
    resultRef,
    createdAt: now,
    completedAt: [
      EXECUTION_ITEM_STATES.COMPLETED,
      EXECUTION_ITEM_STATES.FAILED,
      EXECUTION_ITEM_STATES.CANCELLED,
      EXECUTION_ITEM_STATES.SUPERSEDED
    ].includes(status)
      ? now
      : null
  });
}

export function canTransitionExecutionItem(from, to) {
  if (!STATES.has(from) || !STATES.has(to)) return false;
  if (from === to) return true;
  return TRANSITIONS[from]?.has(to) === true;
}

export function transitionExecutionItem(itemSource, nextStatus, {
  supersededBy = "",
  resolved = undefined,
  now = Date.now()
} = {}) {
  const item = sanitizeExecutionItem(itemSource);
  if (!item) return { ok: false, code: "execution-item-invalid" };
  if (!STATES.has(nextStatus)) {
    return { ok: false, code: "execution-item-status-invalid" };
  }
  if (!canTransitionExecutionItem(item.status, nextStatus)) {
    return {
      ok: false,
      code: "execution-item-transition-invalid",
      from: item.status,
      to: nextStatus
    };
  }
  if (
    nextStatus === EXECUTION_ITEM_STATES.SUPERSEDED &&
    !text(supersededBy)
  ) {
    return { ok: false, code: "superseding-item-required" };
  }
  if (item.status === nextStatus) {
    return { ok: true, changed: false, item };
  }

  const terminal = [
    EXECUTION_ITEM_STATES.COMPLETED,
    EXECUTION_ITEM_STATES.FAILED,
    EXECUTION_ITEM_STATES.CANCELLED,
    EXECUTION_ITEM_STATES.SUPERSEDED
  ].includes(nextStatus);

  return {
    ok: true,
    changed: true,
    item: {
      ...item,
      status: nextStatus,
      resolved: resolved === undefined
        ? nextStatus === EXECUTION_ITEM_STATES.SUPERSEDED || item.resolved
        : resolved === true,
      supersededBy: nextStatus === EXECUTION_ITEM_STATES.SUPERSEDED
        ? text(supersededBy)
        : item.supersededBy,
      completedAt: terminal ? integer(now) : null
    }
  };
}
