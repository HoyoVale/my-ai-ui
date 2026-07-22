export const THREAD_STATES = Object.freeze({
  CREATED: "created",
  ACTIVE: "active",
  RUNNING: "running",
  WAITING: "waiting",
  CONTINUABLE: "continuable",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
  ARCHIVED: "archived"
});

const VALID_STATES = new Set(Object.values(THREAD_STATES));

const TRANSITIONS = Object.freeze({
  [THREAD_STATES.CREATED]: new Set([
    THREAD_STATES.ACTIVE,
    THREAD_STATES.CANCELLED,
    THREAD_STATES.ARCHIVED
  ]),
  [THREAD_STATES.ACTIVE]: new Set([
    THREAD_STATES.RUNNING,
    THREAD_STATES.COMPLETED,
    THREAD_STATES.CANCELLED,
    THREAD_STATES.ARCHIVED
  ]),
  [THREAD_STATES.RUNNING]: new Set([
    THREAD_STATES.WAITING,
    THREAD_STATES.CONTINUABLE,
    THREAD_STATES.COMPLETED,
    THREAD_STATES.FAILED,
    THREAD_STATES.CANCELLED
  ]),
  [THREAD_STATES.WAITING]: new Set([
    THREAD_STATES.RUNNING,
    THREAD_STATES.CANCELLED,
    THREAD_STATES.ARCHIVED
  ]),
  [THREAD_STATES.CONTINUABLE]: new Set([
    THREAD_STATES.RUNNING,
    THREAD_STATES.CANCELLED,
    THREAD_STATES.ARCHIVED
  ]),
  [THREAD_STATES.COMPLETED]: new Set([
    THREAD_STATES.ACTIVE,
    THREAD_STATES.ARCHIVED
  ]),
  [THREAD_STATES.FAILED]: new Set([
    THREAD_STATES.ACTIVE,
    THREAD_STATES.ARCHIVED
  ]),
  [THREAD_STATES.CANCELLED]: new Set([
    THREAD_STATES.ARCHIVED
  ]),
  [THREAD_STATES.ARCHIVED]: new Set()
});

function text(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

export function isThreadState(value) {
  return VALID_STATES.has(value);
}

export function canTransitionThreadState(from, to) {
  if (!isThreadState(from) || !isThreadState(to)) return false;
  if (from === to) return true;
  return TRANSITIONS[from]?.has(to) === true;
}

export function createThreadLifecycle({
  threadId,
  status = THREAD_STATES.CREATED,
  workspaceId = "",
  revision = 0,
  now = Date.now()
} = {}) {
  const id = text(threadId);
  if (!id || !isThreadState(status)) return null;
  return {
    version: 1,
    threadId: id,
    status,
    workspaceId: text(workspaceId),
    revision: integer(revision),
    createdAt: integer(now),
    updatedAt: integer(now),
    completedAt: status === THREAD_STATES.COMPLETED ? integer(now) : null,
    archivedAt: status === THREAD_STATES.ARCHIVED ? integer(now) : null,
    lastTransition: null
  };
}

export function transitionThreadState(lifecycleSource, nextStatus, {
  action = "",
  reason = "",
  expectedRevision = undefined,
  now = Date.now()
} = {}) {
  if (!lifecycleSource || typeof lifecycleSource !== "object") {
    return { ok: false, code: "thread-lifecycle-required" };
  }

  const currentStatus = lifecycleSource.status;
  if (!isThreadState(currentStatus) || !isThreadState(nextStatus)) {
    return { ok: false, code: "thread-state-invalid" };
  }

  const revision = integer(lifecycleSource.revision);
  const expected = Number(expectedRevision);
  if (
    expectedRevision !== undefined &&
    (!Number.isFinite(expected) || Math.round(expected) !== revision)
  ) {
    return { ok: false, code: "thread-revision-conflict" };
  }

  if (!canTransitionThreadState(currentStatus, nextStatus)) {
    return {
      ok: false,
      code: "thread-transition-invalid",
      from: currentStatus,
      to: nextStatus
    };
  }

  if (currentStatus === nextStatus) {
    return { ok: true, changed: false, lifecycle: structuredClone(lifecycleSource) };
  }

  const timestamp = integer(now);
  const lifecycle = {
    ...structuredClone(lifecycleSource),
    status: nextStatus,
    revision: revision + 1,
    updatedAt: timestamp,
    completedAt: nextStatus === THREAD_STATES.COMPLETED
      ? timestamp
      : lifecycleSource.completedAt ?? null,
    archivedAt: nextStatus === THREAD_STATES.ARCHIVED
      ? timestamp
      : lifecycleSource.archivedAt ?? null,
    lastTransition: {
      from: currentStatus,
      to: nextStatus,
      action: text(action, 80),
      reason: text(reason, 500),
      at: timestamp
    }
  };

  return { ok: true, changed: true, lifecycle };
}
