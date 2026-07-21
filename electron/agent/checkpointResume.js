import {
  isGracefulRunBoundary
} from "./runStopReasons.js";

const NEW_TASK_PATTERNS = [
  /^(?:换个|换一个|开始)?新(?:的)?(?:话题|问题|任务)(?:吧|：|:|，|,|。|\s|$)/u,
  /^(?:换个|换一个|聊点|说点)(?:别的|其他的)(?:吧|，|,|。|\s|$)/u,
  /^(?:另一个|另外一个)(?:问题|任务)(?:是|：|:|，|,|。|\s|$)/u,
  /^(?:不继续了|先不继续|停止|放弃|结束)(?:这个|当前)?任务(?:吧|，|,|。|\s|$)/u,
  /^(?:new task|new topic|different question|stop this task|do not continue|don't continue)\b/iu
];

const CONTINUATION_PATTERNS = [
  /^(?:请)?(?:继续|接着|继续做|接着做|继续执行|接着执行|继续完成|完成剩余|完成余下|执行下一步|继续下一步)(?:吧|下去|剩余部分|余下部分|这个任务|当前任务|，|,|。|\s|$)/u,
  /^(?:按|照)(?:你|你的|刚才|之前|上面|这个|该)?(?:的)?(?:方案|计划|建议|步骤)(?:继续|接着|执行|完成|做|处理)(?:吧|，|,|。|\s|$)/u,
  /^(?:继续|接着)(?:，|,)?(?:但|不过|同时|并且|先|请)(?:.|\s)+/u,
  /^(?:continue|go on|proceed|resume|keep going|continue the task|continue with the plan)\b/iu
];

export function isExplicitNewTask(message) {
  const normalized = String(message ?? "").trim();

  return Boolean(
    normalized &&
    NEW_TASK_PATTERNS.some((pattern) =>
      pattern.test(normalized)
    )
  );
}

export function isExplicitContinuationMessage(message) {
  const normalized = String(message ?? "").trim();

  return Boolean(
    normalized &&
    !isExplicitNewTask(normalized) &&
    CONTINUATION_PATTERNS.some((pattern) =>
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
    isGracefulRunBoundary(stopReason) &&
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
  message,
  explicit = false
} = {}) {
  if (
    !explicit &&
    !isExplicitContinuationMessage(message)
  ) {
    return null;
  }

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
    workspaceId: String(checkpoint.workspaceId || ""),
    workspaceSnapshot:
      checkpoint.workspaceSnapshot &&
      typeof checkpoint.workspaceSnapshot === "object"
        ? structuredClone(checkpoint.workspaceSnapshot)
        : null,
    mode: checkpoint.mode === "coding" ? "coding" : "chat",
    modelSelection:
      checkpoint.modelSelection && typeof checkpoint.modelSelection === "object"
        ? structuredClone(checkpoint.modelSelection)
        : null,
    modelSnapshot:
      checkpoint.modelSnapshot && typeof checkpoint.modelSnapshot === "object"
        ? structuredClone(checkpoint.modelSnapshot)
        : null,
    skillId: String(checkpoint.skillId || ""),
    skillSnapshot:
      checkpoint.skillSnapshot && typeof checkpoint.skillSnapshot === "object"
        ? structuredClone(checkpoint.skillSnapshot)
        : null,
    skillIds: Array.isArray(checkpoint.skillIds)
      ? structuredClone(checkpoint.skillIds)
      : checkpoint.skillId ? [String(checkpoint.skillId)] : [],
    skillSnapshots: Array.isArray(checkpoint.skillSnapshots)
      ? structuredClone(checkpoint.skillSnapshots)
      : checkpoint.skillSnapshot ? [structuredClone(checkpoint.skillSnapshot)] : [],
    skillRoutingMode: checkpoint.skillRoutingMode === "auto" ? "auto" : "manual",
    skillSource: ["manual", "command", "router", "none"].includes(checkpoint.skillSource)
      ? checkpoint.skillSource
      : "manual",
    skillRouter: checkpoint.skillRouter && typeof checkpoint.skillRouter === "object"
      ? structuredClone(checkpoint.skillRouter)
      : null,
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
