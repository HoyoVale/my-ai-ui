export const THREAD_COMMANDS = Object.freeze({
  START: "start",
  RESUME: "resume",
  STEER: "steer",
  FORK: "fork",
  REGENERATE: "regenerate"
});

export const ROUTING_ACTIONS = Object.freeze({
  START: "start",
  RESUME: "resume",
  STEER: "steer",
  FORK: "fork",
  REGENERATE: "regenerate",
  REJECT: "reject",
  NONE: "none"
});

export const ROUTING_SOURCES = Object.freeze({
  EXPLICIT_COMMAND: "explicit_command",
  ACTIVE_THREAD: "active_thread",
  ACTIVE_RUN: "active_run",
  SEMANTIC_FALLBACK: "semantic_fallback",
  SYSTEM_RECOVERY: "system_recovery",
  LEGACY_SHADOW: "legacy_shadow"
});

export const ROUTING_DECISION_STATES = Object.freeze({
  PROPOSED: "proposed",
  APPLIED: "applied",
  REJECTED: "rejected"
});

const COMMANDS = new Set(Object.values(THREAD_COMMANDS));
const ACTIONS = new Set(Object.values(ROUTING_ACTIONS));
const SOURCES = new Set(Object.values(ROUTING_SOURCES));
const STATES = new Set(Object.values(ROUTING_DECISION_STATES));

function text(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function timestamp(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

function evidenceList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => text(entry, 120))
    .filter(Boolean)
    .slice(0, 20);
}

export function createThreadRoutingDecision({
  id,
  command,
  action = command,
  state = ROUTING_DECISION_STATES.PROPOSED,
  source = ROUTING_SOURCES.EXPLICIT_COMMAND,
  conversationId = "",
  workspaceId = "",
  messageId = "",
  currentThreadId = "",
  targetThreadId = "",
  activeRunId = "",
  sourceThreadId = "",
  sourceRunId = "",
  targetRunId = "",
  reason = "",
  evidence = [],
  legacyAction = "",
  shadowMode = false,
  now = Date.now()
} = {}) {
  const decision = {
    version: 1,
    id: text(id),
    command: COMMANDS.has(command) ? command : "",
    action: ACTIONS.has(action) ? action : "",
    state: STATES.has(state) ? state : "",
    source: SOURCES.has(source) ? source : "",
    conversationId: text(conversationId),
    workspaceId: text(workspaceId),
    messageId: text(messageId),
    currentThreadId: text(currentThreadId),
    targetThreadId: text(targetThreadId),
    activeRunId: text(activeRunId),
    sourceThreadId: text(sourceThreadId),
    sourceRunId: text(sourceRunId),
    targetRunId: text(targetRunId),
    reason: text(reason, 500),
    evidence: evidenceList(evidence),
    shadow: {
      enabled: shadowMode === true,
      legacyAction: ACTIONS.has(legacyAction) ? legacyAction : "",
      mismatch: shadowMode === true && ACTIONS.has(legacyAction)
        ? legacyAction !== action
        : false
    },
    createdAt: timestamp(now, Date.now())
  };

  const validation = validateThreadRoutingDecision(decision);
  return validation.ok ? decision : null;
}

export function validateThreadRoutingDecision(decision) {
  const errors = [];
  if (!decision || typeof decision !== "object") {
    return { ok: false, errors: ["routing-decision-required"] };
  }
  if (!text(decision.id)) errors.push("routing-decision-id-required");
  if (!COMMANDS.has(decision.command)) errors.push("routing-command-invalid");
  if (!ACTIONS.has(decision.action)) errors.push("routing-action-invalid");
  if (!STATES.has(decision.state)) errors.push("routing-state-invalid");
  if (!SOURCES.has(decision.source)) errors.push("routing-source-invalid");
  if (!text(decision.conversationId)) errors.push("conversation-id-required");

  if (
    decision.state === ROUTING_DECISION_STATES.REJECTED ||
    decision.action === ROUTING_ACTIONS.REJECT
  ) {
    if (!text(decision.reason)) errors.push("routing-rejection-reason-required");
    return { ok: errors.length === 0, errors };
  }

  if (decision.state === ROUTING_DECISION_STATES.APPLIED) {
    if (decision.action === ROUTING_ACTIONS.START && !text(decision.targetThreadId)) {
      errors.push("start-target-thread-required");
    }
    if (decision.action === ROUTING_ACTIONS.RESUME && !text(decision.targetThreadId)) {
      errors.push("resume-target-thread-required");
    }
    if (decision.action === ROUTING_ACTIONS.STEER) {
      if (!text(decision.targetThreadId)) errors.push("steer-target-thread-required");
      if (!text(decision.activeRunId)) errors.push("steer-active-run-required");
    }
    if (decision.action === ROUTING_ACTIONS.FORK) {
      if (!text(decision.sourceThreadId)) errors.push("fork-source-thread-required");
      if (!text(decision.sourceRunId)) errors.push("fork-source-run-required");
      if (!text(decision.targetThreadId)) errors.push("fork-target-thread-required");
      if (
        text(decision.sourceThreadId) &&
        text(decision.sourceThreadId) === text(decision.targetThreadId)
      ) {
        errors.push("fork-target-must-differ");
      }
    }
    if (decision.action === ROUTING_ACTIONS.REGENERATE) {
      if (!text(decision.targetThreadId)) errors.push("regenerate-thread-required");
      if (!text(decision.sourceRunId)) errors.push("regenerate-source-run-required");
      if (!text(decision.targetRunId)) errors.push("regenerate-target-run-required");
      if (
        text(decision.sourceRunId) &&
        text(decision.sourceRunId) === text(decision.targetRunId)
      ) {
        errors.push("regenerate-target-must-differ");
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
