import {
  RUN_RELATIONS,
  RUN_STATES_V2,
  createRunIdentity
} from "./RunIdentityContract.js";
import {
  executionItemSequenceFingerprint,
  validateExecutionItemSequence
} from "./ExecutionItemSequence.js";
import {
  projectRunExecutionItems
} from "./ExecutionItemProjector.js";
import {
  validateExecutionOwnership
} from "./ExecutionModelContract.js";

function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function timestamp(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.round(number))
    : fallback;
}

function runStateFromSource(assistantMessage, activity) {
  if (assistantMessage?.status === "aborted") {
    return RUN_STATES_V2.CANCELLED;
  }

  const status = text(activity?.status, 80);
  const outcome = text(activity?.outcome, 80);
  const resumable = activity?.resumable === true;
  const ended = activity?.endedAt != null;

  if (["cancelled", "canceled"].includes(outcome) || status === "cancelled") {
    return RUN_STATES_V2.CANCELLED;
  }
  if (outcome === "completed" || status === "completed") {
    return RUN_STATES_V2.COMPLETED;
  }
  if (
    outcome === "continuable" ||
    status === "checkpoint_ready" ||
    status === "interrupted" ||
    status === "resumed"
  ) {
    return RUN_STATES_V2.CONTINUABLE;
  }
  if (status === "needs_input") {
    return ended || resumable
      ? RUN_STATES_V2.CONTINUABLE
      : RUN_STATES_V2.WAITING_INPUT;
  }
  if (["blocked", "failed", "unknown"].includes(status)) {
    return resumable
      ? RUN_STATES_V2.CONTINUABLE
      : RUN_STATES_V2.FAILED;
  }
  if (status === "cancelling") return RUN_STATES_V2.RUNNING;
  if (status === "running") return RUN_STATES_V2.RUNNING;
  if (assistantMessage?.status === "streaming") return RUN_STATES_V2.RUNNING;
  return assistantMessage?.status === "complete"
    ? RUN_STATES_V2.COMPLETED
    : RUN_STATES_V2.RUNNING;
}

function relationFromSource({
  sequence,
  assistantMessage,
  relation = ""
}) {
  if (Object.values(RUN_RELATIONS).includes(relation)) return relation;
  if (assistantMessage?.resumedFromMessageId) return RUN_RELATIONS.RESUME;
  return sequence <= 1
    ? RUN_RELATIONS.INITIAL
    : RUN_RELATIONS.FOLLOW_UP;
}

function countItems(items) {
  const byKind = {};
  const byStatus = {};
  const byVisibility = {};

  for (const item of items) {
    byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
    byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
    byVisibility[item.visibility] = (byVisibility[item.visibility] ?? 0) + 1;
  }

  return {
    total: items.length,
    byKind,
    byStatus,
    byVisibility
  };
}

export function projectRun({
  conversationId = "",
  threadId,
  sequence = 1,
  previousRunId = "",
  relation = "",
  userMessage = null,
  assistantMessage = null
} = {}) {
  const resolvedThreadId = text(
    threadId || assistantMessage?.executionThreadId,
    160
  );
  const activity = assistantMessage?.activity && typeof assistantMessage.activity === "object"
    ? assistantMessage.activity
    : null;
  const runId = text(
    activity?.runId || assistantMessage?.runId || assistantMessage?.id,
    160
  );
  if (!resolvedThreadId || !runId || assistantMessage?.role !== "assistant") {
    return null;
  }

  const state = runStateFromSource(assistantMessage, activity);
  const runRelation = relationFromSource({
    sequence,
    assistantMessage,
    relation
  });
  const startedAt = timestamp(
    activity?.startedAt,
    timestamp(userMessage?.createdAt, timestamp(assistantMessage.createdAt))
  );
  const endedAt = activity?.endedAt == null
    ? null
    : timestamp(activity.endedAt, timestamp(assistantMessage.createdAt));
  const createdAt = timestamp(userMessage?.createdAt, startedAt);
  const updatedAt = endedAt ?? timestamp(assistantMessage.createdAt, startedAt);
  const run = createRunIdentity({
    id: runId,
    threadId: resolvedThreadId,
    sequence,
    state,
    relation: runRelation,
    userMessageId: text(userMessage?.id, 160),
    previousRunId: text(previousRunId, 160),
    now: createdAt
  });
  if (!run) return null;
  run.updatedAt = updatedAt;
  run.terminalAt = [
    RUN_STATES_V2.COMPLETED,
    RUN_STATES_V2.CONTINUABLE,
    RUN_STATES_V2.FAILED,
    RUN_STATES_V2.CANCELLED
  ].includes(state)
    ? updatedAt
    : null;

  const items = projectRunExecutionItems({
    threadId: resolvedThreadId,
    runId,
    userMessage,
    assistantMessage,
    activity,
    planState: assistantMessage.planState,
    toolCalls: assistantMessage.toolCalls,
    diffSummary: assistantMessage.diffSummary,
    checkpoint: activity?.checkpoint
  });
  const sequenceValidation = validateExecutionItemSequence(items);
  const ownershipErrors = items.flatMap((item) => {
    const result = validateExecutionOwnership({
      threadId: resolvedThreadId,
      run,
      item
    });
    return result.errors.map((error) => `${item.id}:${error}`);
  });
  if (!sequenceValidation.ok || ownershipErrors.length > 0) {
    return null;
  }

  return {
    version: 1,
    id: run.id,
    threadId: run.threadId,
    conversationId: text(conversationId, 160),
    taskId: text(activity?.taskId || assistantMessage.taskId, 160),
    sequence: run.sequence,
    relation: run.relation,
    state: run.state,
    userMessageId: run.userMessageId,
    assistantMessageId: text(assistantMessage.id, 160),
    previousRunId: run.previousRunId,
    resumedFromMessageId: text(assistantMessage.resumedFromMessageId, 160),
    startedAt,
    endedAt,
    durationMs: timestamp(activity?.durationMs || assistantMessage.durationMs),
    outcome: text(activity?.outcome || state, 80),
    stopReason: text(activity?.stopReason || assistantMessage.stopReason, 120),
    resumable: activity?.resumable === true || state === RUN_STATES_V2.CONTINUABLE,
    items,
    itemFingerprint: executionItemSequenceFingerprint(items),
    itemCounts: countItems(items),
    source: {
      assistantMessageId: text(assistantMessage.id, 160),
      activityVersion: Math.max(0, Number(activity?.version) || 0),
      activityEventCount: Array.isArray(activity?.events) ? activity.events.length : 0,
      diffRevision: Math.max(0, Number(assistantMessage?.diffSummary?.revision) || 0)
    }
  };
}

function nearestUserMessage(messages, assistantIndex) {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return messages[index];
  }
  return null;
}

export function projectConversationRuns({
  conversation,
  threadId = ""
} = {}) {
  if (!conversation || typeof conversation !== "object") return [];
  const messages = Array.isArray(conversation.messages)
    ? conversation.messages
    : [];
  const conversationThreadId = text(
    threadId || conversation.executionThread?.id,
    160
  );
  const runs = [];
  const runIds = new Set();
  let previousRunId = "";

  for (let index = 0; index < messages.length; index += 1) {
    const assistantMessage = messages[index];
    if (assistantMessage?.role !== "assistant") continue;
    const resolvedThreadId = text(
      assistantMessage.executionThreadId || conversationThreadId,
      160
    );
    if (!resolvedThreadId) continue;
    if (conversationThreadId && resolvedThreadId !== conversationThreadId) continue;

    const runId = text(
      assistantMessage.activity?.runId || assistantMessage.runId || assistantMessage.id,
      160
    );
    if (!runId || runIds.has(runId)) continue;

    const projection = projectRun({
      conversationId: conversation.id,
      threadId: resolvedThreadId,
      sequence: runs.length + 1,
      previousRunId,
      userMessage: nearestUserMessage(messages, index),
      assistantMessage
    });
    if (!projection) continue;

    runs.push(projection);
    runIds.add(runId);
    previousRunId = runId;
  }

  return runs;
}

export function validateRunProjection(projection) {
  if (!projection || typeof projection !== "object") {
    return { ok: false, errors: ["run-projection-required"] };
  }
  const errors = [];
  if (!text(projection.id, 160)) errors.push("run-id-required");
  if (!text(projection.threadId, 160)) errors.push("thread-id-required");
  if (!Number.isInteger(projection.sequence) || projection.sequence < 1) {
    errors.push("run-sequence-invalid");
  }
  const itemValidation = validateExecutionItemSequence(projection.items);
  errors.push(...itemValidation.errors);
  for (const item of Array.isArray(projection.items) ? projection.items : []) {
    if (item.threadId !== projection.threadId) errors.push(`item-thread-mismatch:${item.id}`);
    if (item.runId !== projection.id) errors.push(`item-run-mismatch:${item.id}`);
  }
  if (projection.itemCounts?.total !== (projection.items?.length ?? 0)) {
    errors.push("item-count-mismatch");
  }
  return { ok: errors.length === 0, errors };
}
