import {
  isGracefulRunBoundary,
  isRecoverableRunFailure
} from "./runStopReasons.js";

const EXPLICIT_NEW_TASK_PATTERNS = [
  /^(?:请(?:你)?|麻烦(?:你)?|现在)?\s*(?:新建|创建|建立|另建|再建)(?:一个|一份|一套)?\s*(?:全新|新的|独立)?\s*(?:项目|任务|工程|应用|程序|仓库)(?:吧|：|:|，|,|。|\s|$)/u,
  /^(?:请(?:你)?|现在)?\s*(?:从零开始|重新开始)(?:做|创建|建立|开发)?(?:一个|一份|一套)?\s*(?:项目|任务|工程|应用|程序|仓库)?(?:吧|：|:|，|,|。|\s|$)/u,
  /^(?:请(?:你)?|现在)?\s*(?:换|切换到|改做)(?:一个|另一个|另外一个|新的)?\s*(?:项目|任务|问题|方向|主题)(?:吧|：|:|，|,|。|\s|$)/u,
  /^(?:不要|不再|先别|无需)(?:继续|接着)(?:刚才|之前|上一个|当前)?(?:的)?(?:项目|任务|问题)?(?:吧|，|,|。|\s|$)/u,
  /^(?:new|create|start|build)\s+(?:a\s+)?(?:new|separate|independent)?\s*(?:project|task|app|application|repository)\b/iu,
  /^(?:switch|move)\s+to\s+(?:a\s+)?(?:new|different)\s+(?:project|task|topic)\b/iu
];

const CONTINUATION_PATTERNS = [
  /^(?:请(?:你)?|你)?(?:继续|接着|继续做|接着做|继续执行|接着执行|继续完成|完成剩余|完成余下|执行下一步|继续下一步)(?:吧|下去|剩余部分|余下部分|这个任务|当前任务|，|,|。|\s|$)/u,
  /^(?:按|照)(?:你|你的|刚才|之前|上面|这个|该)?(?:的)?(?:方案|计划|建议|步骤)(?:继续|接着|执行|完成|做|处理)(?:吧|，|,|。|\s|$)/u,
  /^(?:继续|接着)(?:，|,)?(?:但|不过|同时|并且|先|请)(?:.|\s)+/u,
  /^(?:continue|go on|proceed|resume|keep going|continue the task|continue with the plan)\b/iu
];

function nonNegativeInteger(value) {
  const normalized = Math.round(Number(value));
  return Number.isFinite(normalized)
    ? Math.max(0, normalized)
    : 0;
}

export function isCoreLiteExplicitNewTask(message) {
  const normalized = String(message ?? "").trim();
  return Boolean(
    normalized &&
    EXPLICIT_NEW_TASK_PATTERNS.some((pattern) =>
      pattern.test(normalized)
    )
  );
}

export function isCoreLiteContinuationMessage(message) {
  const normalized = String(message ?? "").trim();
  return Boolean(
    normalized &&
    !isCoreLiteExplicitNewTask(normalized) &&
    CONTINUATION_PATTERNS.some((pattern) =>
      pattern.test(normalized)
    )
  );
}

export function isCoreLiteResumableCheckpointActivity(activity) {
  if (!activity || typeof activity !== "object") {
    return false;
  }

  const checkpoint = activity.checkpoint;
  if (!checkpoint || typeof checkpoint !== "object") {
    return false;
  }

  const stopReason = checkpoint.stopReason || activity.stopReason;
  return (
    (
      isGracefulRunBoundary(stopReason) ||
      isRecoverableRunFailure({
        stopReason,
        records: checkpoint.tools ?? activity.tools ?? []
      })
    ) &&
    (
      activity.status === "checkpoint_ready" ||
      activity.status === "failed" ||
      checkpoint.phase === "checkpoint_ready" ||
      checkpoint.resumable === true ||
      activity.resumable === true
    )
  );
}

export function findLatestCoreLiteCheckpoint(conversation) {
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
    if (!isCoreLiteResumableCheckpointActivity(message.activity)) {
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

export function resolveCoreLiteCheckpointContinuation({
  conversation,
  message,
  explicit = false
} = {}) {
  if (isCoreLiteExplicitNewTask(message)) {
    return null;
  }

  if (!explicit && !isCoreLiteContinuationMessage(message)) {
    return null;
  }

  return findLatestCoreLiteCheckpoint(conversation);
}

export function createCoreLiteContinuationState(continuation) {
  const checkpoint = continuation?.checkpoint;
  if (!checkpoint || typeof checkpoint !== "object") {
    return null;
  }

  return {
    taskId: String(checkpoint.taskId || ""),
    workspaceId: String(checkpoint.workspaceId || ""),
    workspaceSnapshot:
      checkpoint.workspaceSnapshot &&
      typeof checkpoint.workspaceSnapshot === "object"
        ? structuredClone(checkpoint.workspaceSnapshot)
        : null,
    mode: checkpoint.mode === "coding" ? "coding" : "chat",
    modelSelection:
      checkpoint.modelSelection &&
      typeof checkpoint.modelSelection === "object"
        ? structuredClone(checkpoint.modelSelection)
        : null,
    modelSnapshot:
      checkpoint.modelSnapshot &&
      typeof checkpoint.modelSnapshot === "object"
        ? structuredClone(checkpoint.modelSnapshot)
        : null,
    skillId: String(checkpoint.skillId || ""),
    skillSnapshot:
      checkpoint.skillSnapshot &&
      typeof checkpoint.skillSnapshot === "object"
        ? structuredClone(checkpoint.skillSnapshot)
        : null,
    skillIds: Array.isArray(checkpoint.skillIds)
      ? structuredClone(checkpoint.skillIds)
      : checkpoint.skillId
        ? [String(checkpoint.skillId)]
        : [],
    skillSnapshots: Array.isArray(checkpoint.skillSnapshots)
      ? structuredClone(checkpoint.skillSnapshots)
      : checkpoint.skillSnapshot
        ? [structuredClone(checkpoint.skillSnapshot)]
        : [],
    skillRoutingMode:
      checkpoint.skillRoutingMode === "auto" ? "auto" : "manual",
    skillSource: ["manual", "command", "router", "none"].includes(
      checkpoint.skillSource
    )
      ? checkpoint.skillSource
      : "manual",
    skillRouter:
      checkpoint.skillRouter && typeof checkpoint.skillRouter === "object"
        ? structuredClone(checkpoint.skillRouter)
        : null,
    parentRunId: String(checkpoint.runId || ""),
    resumedFromMessageId: String(
      continuation?.messageId || checkpoint.messageId || ""
    ),
    objective: String(checkpoint.objective || ""),
    continuationCount:
      nonNegativeInteger(checkpoint.continuationCount) + 1,
    contextCompactionCount: nonNegativeInteger(
      checkpoint.counts?.contextCompactions
    ),
    checkpointVersion: nonNegativeInteger(checkpoint.version),
    reportedReceiptIds: Array.isArray(checkpoint.reportedReceiptIds)
      ? [...new Set(
          checkpoint.reportedReceiptIds
            .map((value) => String(value ?? "").trim())
            .filter(Boolean)
        )]
      : [],
    unresolvedCallIds: Array.isArray(checkpoint.unresolvedCallIds)
      ? [...new Set(
          checkpoint.unresolvedCallIds
            .map((value) => String(value ?? "").trim())
            .filter(Boolean)
        )]
      : [],
    partialResponse: String(checkpoint.partialResponse ?? ""),
    partialResponseRole: ["none", "commentary", "final"].includes(
      checkpoint.partialResponseRole
    )
      ? checkpoint.partialResponseRole
      : "none"
  };
}
