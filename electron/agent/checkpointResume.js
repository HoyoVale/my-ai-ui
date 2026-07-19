import {
  RUN_STOP_REASONS
} from "./runStopReasons.js";

const NEW_TASK_PATTERNS = [
  /^(?:换个|换一个|开始)?新(?:的)?(?:话题|问题|任务)(?:吧|：|:|，|,|。|\s|$)/u,
  /^(?:换个|换一个|聊点|说点)(?:别的|其他的)(?:吧|，|,|。|\s|$)/u,
  /^(?:另一个|另外一个)(?:问题|任务)(?:是|：|:|，|,|。|\s|$)/u,
  /^(?:不继续了|先不继续|停止|放弃|结束)(?:这个|当前)?任务(?:吧|，|,|。|\s|$)/u,
  /^(?:new task|new topic|different question|stop this task|do not continue|don''t continue)\b/iu
];

function isExplicitNewTask(message) {
  const normalized = String(message ?? "").trim();

  return Boolean(
    normalized &&
    NEW_TASK_PATTERNS.some((pattern) =>
      pattern.test(normalized)
    )
  );
}

function nonNegativeInteger(value) {
  const normalized = Math.round(Number(value));

  return Number.isFinite(normalized)
    ? Math.max(0, normalized)
    : 0;
}

export function isResumableCheckpointActivity(
  activity
) {
  if (!activity || typeof activity !== "object") {
    return false;
  }

  const checkpoint = activity.checkpoint;

  if (!checkpoint || typeof checkpoint !== "object") {
    return false;
  }

  const stopReason =
    checkpoint.stopReason || activity.stopReason;

  return (
    stopReason === RUN_STOP_REASONS.AGENT_SEGMENT_LIMIT &&
    (
      activity.status === "checkpoint_ready" ||
      checkpoint.phase === "checkpoint_ready" ||
      checkpoint.resumable === true ||
      activity.resumable === true
    )
  );
}

export function findLatestResumableCheckpoint(
  conversation
) {
  const messages = Array.isArray(conversation?.messages)
    ? conversation.messages
    : [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role === "user") {
      return null;
    }

    if (message?.role !== "assistant") {
      continue;
    }

    if (!isResumableCheckpointActivity(message.activity)) {
      return null;
    }

    return {
      messageId: String(message.id ?? ""),
      activity: message.activity,
      checkpoint: message.activity.checkpoint
    };
  }

  return null;
}

export function resolveCheckpointContinuation({
  conversation,
  message
} = {}) {
  if (isExplicitNewTask(message)) {
    return null;
  }

  return findLatestResumableCheckpoint(conversation);
}

export function createCheckpointContinuationState(
  continuation
) {
  const checkpoint = continuation?.checkpoint;

  if (!checkpoint || typeof checkpoint !== "object") {
    return null;
  }

  const currentRunSegments = nonNegativeInteger(
    checkpoint.orchestration?.segmentCount
  );

  return {
    goalId: String(
      checkpoint.goalId || checkpoint.taskId || ""
    ),
    taskId: String(checkpoint.taskId || ""),
    parentRunId: String(checkpoint.runId || ""),
    resumedFromMessageId: String(
      continuation?.messageId || checkpoint.messageId || ""
    ),
    objective: String(checkpoint.objective || ""),
    initialPlan: Array.isArray(checkpoint.plan)
      ? structuredClone(checkpoint.plan)
      : [],
    continuationCount:
      nonNegativeInteger(checkpoint.continuationCount) + 1,
    previousSegmentCount:
      nonNegativeInteger(checkpoint.previousSegmentCount) +
      currentRunSegments,
    contextCompactionCount: nonNegativeInteger(
      checkpoint.counts?.contextCompactions
    )
  };
}
