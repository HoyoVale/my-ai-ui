import crypto from "node:crypto";

import {
  ROUTING_ACTIONS,
  ROUTING_DECISION_STATES,
  ROUTING_SOURCES,
  THREAD_COMMANDS,
  createThreadRoutingDecision
} from "./ThreadRoutingDecision.js";

import {
  classifyThreadCommand,
  normalizeThreadCommand
} from "./ThreadCommand.js";

const REUSABLE_THREAD_STATES = new Set([
  "active",
  "running",
  "waiting",
  "continuable"
]);

function text(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function currentThread(conversation) {
  const source = conversation?.executionThread;
  if (!source || typeof source !== "object") return null;
  const id = text(source.id);
  if (!id) return null;
  return {
    id,
    taskId: text(source.taskId),
    status: text(source.status, 40) || "active",
    workspaceId: text(source.workspaceId),
    lastRunId: text(source.lastRunId),
    lastAssistantMessageId: text(source.lastAssistantMessageId)
  };
}

function workspaceMismatch(thread, conversation) {
  const threadWorkspace = text(thread?.workspaceId);
  const conversationWorkspace = text(conversation?.workspaceId);
  return Boolean(
    threadWorkspace &&
    conversationWorkspace &&
    threadWorkspace !== conversationWorkspace
  );
}

function routeSource(classification, action) {
  if ([
    "explicit",
    "explicit_continue",
    "message",
    "operation"
  ].includes(classification.source)) {
    return ROUTING_SOURCES.EXPLICIT_COMMAND;
  }
  if (action === ROUTING_ACTIONS.STEER) {
    return ROUTING_SOURCES.ACTIVE_RUN;
  }
  if (classification.source === "semantic_feedback") {
    return ROUTING_SOURCES.SEMANTIC_FALLBACK;
  }
  return ROUTING_SOURCES.ACTIVE_THREAD;
}

function actionForCommand(command) {
  return Object.values(ROUTING_ACTIONS).includes(command)
    ? command
    : ROUTING_ACTIONS.NONE;
}

export class ExecutionThreadRouter {
  constructor({
    createId = () => crypto.randomUUID(),
    now = () => Date.now()
  } = {}) {
    this.createId = createId;
    this.now = now;
  }

  route({
    operation = "message",
    conversation = null,
    activeRun = null,
    message = "",
    requestedCommand = "",
    explicitContinue = false,
    sourceThreadId = "",
    sourceRunId = "",
    targetThreadId = "",
    targetRunId = "",
    messageId = "",
    legacyAction = "",
    shadowMode = true
  } = {}) {
    const thread = currentThread(conversation);
    const activeRunId = text(activeRun?.runId);
    const activeThreadId = text(activeRun?.executionThreadId) || thread?.id || "";
    const classification = classifyThreadCommand({
      message,
      requestedCommand,
      operation,
      activeRun: Boolean(activeRunId),
      explicitContinue
    });

    let command = normalizeThreadCommand(classification.command);
    let action = actionForCommand(command);
    let reason = "";
    const evidence = [...classification.evidence];
    let resolvedTargetThreadId = text(targetThreadId);
    let resolvedSourceThreadId = text(sourceThreadId);
    let resolvedSourceRunId = text(sourceRunId);

    if (activeRunId && operation === THREAD_COMMANDS.REGENERATE) {
      action = ROUTING_ACTIONS.REJECT;
      reason = "regeneration-blocked-by-active-run";
      resolvedTargetThreadId = activeThreadId;
      resolvedSourceRunId ||= activeRunId;
      evidence.push("active-run");
    } else if (
      activeRunId &&
      operation === "message" &&
      command === THREAD_COMMANDS.RESUME
    ) {
      command = THREAD_COMMANDS.STEER;
      action = ROUTING_ACTIONS.STEER;
      reason = "active-run-steering";
      resolvedTargetThreadId = activeThreadId;
      resolvedSourceRunId = activeRunId;
      evidence.push("active-run");
    } else if (
      activeRunId &&
      operation === "message" &&
      command &&
      command !== THREAD_COMMANDS.STEER
    ) {
      action = ROUTING_ACTIONS.REJECT;
      reason = "active-run-command-blocked";
      resolvedTargetThreadId = activeThreadId;
      resolvedSourceRunId ||= activeRunId;
      evidence.push("active-run");
    } else if (!command) {
      if (thread && workspaceMismatch(thread, conversation)) {
        command = THREAD_COMMANDS.START;
        action = ROUTING_ACTIONS.START;
        reason = "workspace-changed-start-new-thread";
        evidence.push("workspace-mismatch");
      } else if (thread && REUSABLE_THREAD_STATES.has(thread.status)) {
        command = THREAD_COMMANDS.RESUME;
        action = ROUTING_ACTIONS.RESUME;
        reason = "active-thread-default";
        resolvedTargetThreadId = thread.id;
        resolvedSourceRunId ||= thread.lastRunId;
        evidence.push(`thread-state:${thread.status}`);
      } else {
        command = THREAD_COMMANDS.START;
        action = ROUTING_ACTIONS.START;
        reason = "no-reusable-thread";
        evidence.push(thread ? `thread-state:${thread.status}` : "thread-absent");
      }
    } else if (command === THREAD_COMMANDS.STEER) {
      if (!activeRunId || !activeThreadId) {
        action = ROUTING_ACTIONS.REJECT;
        reason = "steer-active-run-required";
        evidence.push("active-run-missing");
      } else {
        action = ROUTING_ACTIONS.STEER;
        reason = "active-run-steering";
        resolvedTargetThreadId = activeThreadId;
        resolvedSourceRunId ||= activeRunId;
      }
    } else if (command === THREAD_COMMANDS.RESUME) {
      if (!thread) {
        action = ROUTING_ACTIONS.REJECT;
        reason = "resume-thread-required";
        evidence.push("thread-absent");
      } else if (workspaceMismatch(thread, conversation)) {
        action = ROUTING_ACTIONS.REJECT;
        reason = "resume-workspace-mismatch";
        evidence.push("workspace-mismatch");
      } else {
        action = ROUTING_ACTIONS.RESUME;
        reason = classification.source === "semantic_feedback"
          ? "feedback-on-current-thread"
          : "resume-current-thread";
        resolvedTargetThreadId = thread.id;
        resolvedSourceRunId ||= thread.lastRunId;
        evidence.push(`thread-state:${thread.status}`);
      }
    } else if (command === THREAD_COMMANDS.START) {
      action = ROUTING_ACTIONS.START;
      reason = "explicit-start-new-thread";
      if (thread) evidence.push(`current-thread:${thread.status}`);
    } else if (command === THREAD_COMMANDS.FORK) {
      resolvedSourceThreadId ||= thread?.id || "";
      resolvedSourceRunId ||= thread?.lastRunId || "";
      if (!resolvedSourceThreadId || !resolvedSourceRunId) {
        action = ROUTING_ACTIONS.REJECT;
        reason = "fork-source-required";
      } else {
        action = ROUTING_ACTIONS.FORK;
        reason = "fork-from-existing-run";
      }
    } else if (command === THREAD_COMMANDS.REGENERATE) {
      resolvedTargetThreadId ||= thread?.id || activeThreadId;
      resolvedSourceRunId ||= thread?.lastRunId || "";
      if (activeRunId && operation !== THREAD_COMMANDS.REGENERATE) {
        action = ROUTING_ACTIONS.STEER;
        command = THREAD_COMMANDS.STEER;
        reason = "active-run-steering";
        resolvedTargetThreadId = activeThreadId;
        resolvedSourceRunId = activeRunId;
      } else if (!resolvedTargetThreadId || !resolvedSourceRunId) {
        action = ROUTING_ACTIONS.REJECT;
        reason = "regeneration-source-required";
      } else {
        action = ROUTING_ACTIONS.REGENERATE;
        reason = "regenerate-existing-run";
      }
    }

    if (!reason) {
      reason = `${action}-routing-decision`;
    }

    return createThreadRoutingDecision({
      id: this.createId(),
      command,
      action,
      state: ROUTING_DECISION_STATES.PROPOSED,
      source: routeSource(classification, action),
      conversationId: text(conversation?.id),
      workspaceId: text(conversation?.workspaceId),
      messageId: text(messageId),
      currentThreadId: thread?.id || activeThreadId,
      targetThreadId: resolvedTargetThreadId,
      activeRunId,
      sourceThreadId: resolvedSourceThreadId,
      sourceRunId: resolvedSourceRunId,
      targetRunId: text(targetRunId),
      reason,
      evidence,
      legacyAction,
      shadowMode,
      now: this.now()
    });
  }
}

export const executionThreadRouter = new ExecutionThreadRouter();
