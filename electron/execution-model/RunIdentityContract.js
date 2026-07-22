export const RUN_STATES_V2 = Object.freeze({
  QUEUED: "queued",
  PREPARING: "preparing",
  RUNNING: "running",
  WAITING_APPROVAL: "waiting_approval",
  WAITING_INPUT: "waiting_input",
  FINALIZING: "finalizing",
  COMPLETED: "completed",
  CONTINUABLE: "continuable",
  FAILED: "failed",
  CANCELLED: "cancelled"
});

export const RUN_RELATIONS = Object.freeze({
  INITIAL: "initial",
  FOLLOW_UP: "follow_up",
  RESUME: "resume",
  RETRY: "retry",
  REGENERATE: "regenerate",
  FORK: "fork"
});

const VALID_STATES = new Set(Object.values(RUN_STATES_V2));
const VALID_RELATIONS = new Set(Object.values(RUN_RELATIONS));
const TERMINAL_STATES = new Set([
  RUN_STATES_V2.COMPLETED,
  RUN_STATES_V2.CONTINUABLE,
  RUN_STATES_V2.FAILED,
  RUN_STATES_V2.CANCELLED
]);

const TRANSITIONS = Object.freeze({
  [RUN_STATES_V2.QUEUED]: new Set([
    RUN_STATES_V2.PREPARING,
    RUN_STATES_V2.CANCELLED
  ]),
  [RUN_STATES_V2.PREPARING]: new Set([
    RUN_STATES_V2.RUNNING,
    RUN_STATES_V2.FAILED,
    RUN_STATES_V2.CANCELLED
  ]),
  [RUN_STATES_V2.RUNNING]: new Set([
    RUN_STATES_V2.WAITING_APPROVAL,
    RUN_STATES_V2.WAITING_INPUT,
    RUN_STATES_V2.FINALIZING,
    RUN_STATES_V2.CONTINUABLE,
    RUN_STATES_V2.FAILED,
    RUN_STATES_V2.CANCELLED
  ]),
  [RUN_STATES_V2.WAITING_APPROVAL]: new Set([
    RUN_STATES_V2.RUNNING,
    RUN_STATES_V2.FAILED,
    RUN_STATES_V2.CANCELLED
  ]),
  [RUN_STATES_V2.WAITING_INPUT]: new Set([
    RUN_STATES_V2.RUNNING,
    RUN_STATES_V2.CONTINUABLE,
    RUN_STATES_V2.CANCELLED
  ]),
  [RUN_STATES_V2.FINALIZING]: new Set([
    RUN_STATES_V2.COMPLETED,
    RUN_STATES_V2.CONTINUABLE,
    RUN_STATES_V2.FAILED,
    RUN_STATES_V2.CANCELLED
  ]),
  [RUN_STATES_V2.COMPLETED]: new Set(),
  [RUN_STATES_V2.CONTINUABLE]: new Set(),
  [RUN_STATES_V2.FAILED]: new Set(),
  [RUN_STATES_V2.CANCELLED]: new Set()
});

function text(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

export function isTerminalRunState(value) {
  return TERMINAL_STATES.has(value);
}

export function sanitizeRunIdentity(source) {
  if (!source || typeof source !== "object") return null;
  const id = text(source.id);
  const threadId = text(source.threadId);
  const state = VALID_STATES.has(source.state) ? source.state : "";
  const relation = VALID_RELATIONS.has(source.relation)
    ? source.relation
    : RUN_RELATIONS.INITIAL;
  if (!id || !threadId || !state) return null;

  const retryOfRunId = text(source.retryOfRunId);
  const regeneratedFromRunId = text(source.regeneratedFromRunId);
  if (retryOfRunId && regeneratedFromRunId) return null;
  if ([retryOfRunId, regeneratedFromRunId].includes(id)) return null;

  return {
    version: 1,
    id,
    threadId,
    sequence: Math.max(1, integer(source.sequence, 1)),
    state,
    relation,
    userMessageId: text(source.userMessageId),
    previousRunId: text(source.previousRunId),
    retryOfRunId,
    regeneratedFromRunId,
    forkedFromThreadId: text(source.forkedFromThreadId),
    forkedFromRunId: text(source.forkedFromRunId),
    createdAt: integer(source.createdAt, Date.now()),
    updatedAt: integer(source.updatedAt, Date.now()),
    terminalAt: source.terminalAt == null
      ? null
      : integer(source.terminalAt)
  };
}

export function createRunIdentity({
  id,
  threadId,
  sequence = 1,
  state = RUN_STATES_V2.QUEUED,
  relation = RUN_RELATIONS.INITIAL,
  userMessageId = "",
  previousRunId = "",
  retryOfRunId = "",
  regeneratedFromRunId = "",
  forkedFromThreadId = "",
  forkedFromRunId = "",
  now = Date.now()
} = {}) {
  return sanitizeRunIdentity({
    id,
    threadId,
    sequence,
    state,
    relation,
    userMessageId,
    previousRunId,
    retryOfRunId,
    regeneratedFromRunId,
    forkedFromThreadId,
    forkedFromRunId,
    createdAt: now,
    updatedAt: now,
    terminalAt: isTerminalRunState(state) ? now : null
  });
}

export function canTransitionRunState(from, to) {
  if (!VALID_STATES.has(from) || !VALID_STATES.has(to)) return false;
  if (from === to) return true;
  return TRANSITIONS[from]?.has(to) === true;
}

export function transitionRunIdentity(runSource, nextState, {
  now = Date.now()
} = {}) {
  const run = sanitizeRunIdentity(runSource);
  if (!run) return { ok: false, code: "run-identity-invalid" };
  if (!VALID_STATES.has(nextState)) {
    return { ok: false, code: "run-state-invalid" };
  }
  if (isTerminalRunState(run.state) && run.state !== nextState) {
    return { ok: false, code: "terminal-run-immutable" };
  }
  if (!canTransitionRunState(run.state, nextState)) {
    return {
      ok: false,
      code: "run-transition-invalid",
      from: run.state,
      to: nextState
    };
  }
  if (run.state === nextState) {
    return { ok: true, changed: false, run };
  }

  const timestamp = integer(now);
  return {
    ok: true,
    changed: true,
    run: {
      ...run,
      state: nextState,
      updatedAt: timestamp,
      terminalAt: isTerminalRunState(nextState) ? timestamp : null
    }
  };
}

export function validateRunLineage(runSource, knownRuns = []) {
  const run = sanitizeRunIdentity(runSource);
  if (!run) return { ok: false, errors: ["run-identity-invalid"] };
  const byId = new Map(
    knownRuns
      .map((candidate) => sanitizeRunIdentity(candidate))
      .filter(Boolean)
      .map((candidate) => [candidate.id, candidate])
  );
  const errors = [];

  for (const [field, value] of [
    ["previousRunId", run.previousRunId],
    ["retryOfRunId", run.retryOfRunId],
    ["regeneratedFromRunId", run.regeneratedFromRunId],
    ["forkedFromRunId", run.forkedFromRunId]
  ]) {
    if (!value) continue;
    const parent = byId.get(value);
    if (!parent) {
      errors.push(`${field}-not-found`);
      continue;
    }
    if (field !== "forkedFromRunId" && parent.threadId !== run.threadId) {
      errors.push(`${field}-thread-mismatch`);
    }
    if (parent.sequence >= run.sequence && parent.threadId === run.threadId) {
      errors.push(`${field}-sequence-invalid`);
    }
  }

  if (
    run.relation === RUN_RELATIONS.RETRY &&
    !run.retryOfRunId
  ) {
    errors.push("retry-parent-required");
  }
  if (
    run.relation === RUN_RELATIONS.REGENERATE &&
    !run.regeneratedFromRunId
  ) {
    errors.push("regeneration-parent-required");
  }
  if (
    run.relation === RUN_RELATIONS.FORK &&
    (!run.forkedFromThreadId || !run.forkedFromRunId)
  ) {
    errors.push("fork-lineage-required");
  }

  return { ok: errors.length === 0, errors };
}
