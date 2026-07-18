import {
  TOOL_METADATA
} from "../../Setting/tools/toolPanelOptions.js";

export function formatTaskDuration(
  milliseconds
) {
  const numeric = Math.max(
    0,
    Number(milliseconds) || 0
  );

  if (numeric < 1000) {
    return `${Math.max(1, Math.round(numeric))} 毫秒`;
  }

  const seconds = numeric / 1000;

  if (seconds < 60) {
    return seconds < 10
      ? `${seconds.toFixed(1)} 秒`
      : `${Math.round(seconds)} 秒`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);

  return remainder > 0
    ? `${minutes} 分 ${remainder} 秒`
    : `${minutes} 分钟`;
}

export function stringifyTaskValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function getToolTitle(toolCall) {
  return (
    TOOL_METADATA[toolCall?.name]?.title ??
    toolCall?.title ??
    toolCall?.name ??
    "工具调用"
  );
}

export function getToolDescription(toolCall) {
  return (
    TOOL_METADATA[toolCall?.name]
      ?.description ??
    ""
  );
}

export function describeToolTarget(toolCall) {
  const input = toolCall?.input ?? {};
  const target =
    input.path ??
    input.directory ??
    input.root ??
    input.query ??
    input.expression ??
    input.timezone ??
    input.targetTimezone;

  if (!target) {
    return "";
  }

  const normalized = String(target);

  return normalized.length > 82
    ? `${normalized.slice(0, 39)}…${normalized.slice(-36)}`
    : normalized;
}

export function normalizeToolStatus(status) {
  if (["failed", "error"].includes(status)) {
    return "error";
  }

  if (["queued"].includes(status)) {
    return "queued";
  }

  if (["running", "in_progress", "retrying"].includes(status)) {
    return status === "retrying" ? "retrying" : "running";
  }

  if (["aborted", "cancelled"].includes(status)) {
    return "aborted";
  }

  return "complete";
}

export function toolStatusLabel(status) {
  const normalized = normalizeToolStatus(status);

  if (normalized === "error") {
    return "失败";
  }

  if (normalized === "queued") {
    return "等待中";
  }

  if (normalized === "running") {
    return "进行中";
  }

  if (normalized === "retrying") {
    return "正在重试";
  }

  if (normalized === "aborted") {
    return "已取消";
  }

  return "完成";
}

export function toolStatusMark(status) {
  const normalized = normalizeToolStatus(status);

  if (normalized === "error") {
    return "!";
  }

  if (["queued", "running", "retrying"].includes(normalized)) {
    return "";
  }

  if (normalized === "aborted") {
    return "–";
  }

  return "✓";
}

export function normalizePlanStatus(status) {
  if (["in_progress", "running"].includes(status)) {
    return "in_progress";
  }

  if (["completed", "complete"].includes(status)) {
    return "completed";
  }

  if (status === "needs_input") {
    return "needs_input";
  }

  if (["blocked", "error", "failed"].includes(status)) {
    return "blocked";
  }

  if (status === "skipped") {
    return "skipped";
  }

  if (["aborted", "cancelled"].includes(status)) {
    return "cancelled";
  }

  if (status === "superseded") {
    return "superseded";
  }

  return "pending";
}

export function getPlanStats(plan = []) {
  const normalizedPlan = Array.isArray(plan)
    ? plan.map((item) => ({
        ...item,
        status: normalizePlanStatus(
          item?.status
        )
      }))
    : [];
  const completed = normalizedPlan.filter(
    (item) => item.status === "completed"
  ).length;
  const active = normalizedPlan.find(
    (item) => item.status === "in_progress"
  ) ?? null;
  const blocked = normalizedPlan.some(
    (item) =>
      ["blocked", "needs_input"].includes(item.status)
  );
  const settled = normalizedPlan.filter(
    (item) =>
      [
        "completed",
        "skipped",
        "cancelled",
        "superseded",
        "needs_input"
      ].includes(item.status)
  ).length;

  return {
    plan: normalizedPlan,
    total: normalizedPlan.length,
    completed,
    settled,
    active,
    blocked,
    ratio:
      normalizedPlan.length > 0
        ? settled / normalizedPlan.length
        : 0
  };
}

const STOP_REASON_LABELS = Object.freeze({
  completed: "已完成",
  waiting_for_user: "等待你的回答",
  cancelled_by_user: "已取消",
  needs_input: "需要补充信息",
  blocked: "任务被阻塞",
  agent_segment_limit: "达到任务分段上限",
  no_progress: "连续分段没有新进展",
  tool_call_limit: "达到工具调用上限",
  agent_step_limit: "达到任务步骤上限",
  agent_run_timeout: "任务运行超时",
  tool_timeout: "工具运行超时",
  repeated_tool_call: "停止重复工具调用",
  tool_error: "工具执行失败",
  model_error: "模型执行失败",
  invalid_tool_arguments: "工具参数无效",
  permission_denied: "权限不足",
  output_limit: "达到输出上限",
  content_filter: "内容被安全策略拦截",
  plan_incomplete: "计划尚未执行完成",
  interrupted: "执行被应用关闭中断",
  unknown: "任务已结束"
});

export function stopReasonLabel(reason) {
  return STOP_REASON_LABELS[reason] ??
    STOP_REASON_LABELS.unknown;
}

function legacyEvents(source) {
  const events = [];
  const startedAt = Math.max(
    0,
    Number(source?.createdAt || 0) -
      Number(source?.durationMs || 0)
  );
  let sequence = 0;

  if (Array.isArray(source?.plan) && source.plan.length > 0) {
    events.push({
      id: `legacy-plan:${source.id ?? "source"}`,
      type: "plan",
      sequence: sequence++,
      status: "completed",
      title: `任务计划 · ${source.plan.length} 步`,
      createdAt: startedAt,
      updatedAt: Number(source.createdAt || 0),
      plan: source.plan
    });
  }

  for (const toolCall of source?.activeToolCalls ?? source?.toolCalls ?? []) {
    events.push({
      id: `tool:${toolCall.id}`,
      type: "tool",
      sequence: sequence++,
      status: toolCall.status,
      title: getToolTitle(toolCall),
      createdAt:
        toolCall.queuedAt ??
        toolCall.startedAt ??
        startedAt,
      updatedAt:
        toolCall.endedAt ??
        Number(source?.createdAt || Date.now()),
      tool: toolCall
    });
  }

  const reasoning = String(
    source?.reasoningSummary ?? ""
  ).trim();

  if (reasoning) {
    events.push({
      id: `legacy-summary:${source.id ?? "source"}`,
      type: "summary",
      sequence: sequence++,
      status: "completed",
      title: "思考摘要",
      content: reasoning,
      createdAt: startedAt,
      updatedAt: Number(source?.createdAt || 0)
    });
  }

  if (source?.pendingQuestion?.question) {
    events.push({
      id: `legacy-question:${source.id ?? "source"}`,
      type: "question",
      sequence: sequence++,
      status:
        source.pendingQuestion.status === "answered"
          ? "answered"
          : "waiting_for_user",
      title: "等待你的回答",
      question: source.pendingQuestion,
      createdAt: Number(source?.createdAt || 0),
      updatedAt: Number(source?.createdAt || 0)
    });
  }

  return events;
}

export function activityEvents(source) {
  if (Array.isArray(source?.activity?.events)) {
    return source.activity.events;
  }

  if (Array.isArray(source?.events)) {
    return source.events;
  }

  return legacyEvents(source);
}

function sourceTaskId(source) {
  return (
    source?.activity?.taskId ??
    source?.taskId ??
    source?.id ??
    ""
  );
}

function assistantMessages(conversation) {
  return Array.isArray(conversation?.messages)
    ? conversation.messages.filter(
        (message) => message?.role === "assistant"
      )
    : [];
}

export function findTaskMessage(
  conversation,
  targetMessageId
) {
  const messages = assistantMessages(conversation);

  if (targetMessageId) {
    const selected = messages.find(
      (message) => message.id === targetMessageId
    );

    if (selected) {
      return selected;
    }
  }

  return (
    [...messages].reverse().find((message) => {
      return Boolean(
        message.activity ||
        (Array.isArray(message.plan) && message.plan.length > 0) ||
        (Array.isArray(message.toolCalls) && message.toolCalls.length > 0) ||
        String(message.reasoningSummary ?? "").trim()
      );
    }) ??
    messages.at(-1) ??
    null
  );
}

function collectTaskSources({
  source
}) {
  // Tool UX 1.4: one activity panel represents exactly one
  // assistant message / model run. Cross-run task history can be
  // introduced later as an explicit task view, never implicitly.
  return source ? [source] : [];
}

function eventTimestamp(event) {
  return Number(
    event?.createdAt ??
    event?.updatedAt ??
    0
  ) || 0;
}

export function createActivitySnapshot(
  source,
  {
    conversation = null,
    live = false
  } = {}
) {
  const sources = collectTaskSources({
    conversation,
    source,
    live
  });
  const rankedEvents = sources
    .flatMap((item, sourceIndex) =>
      activityEvents(item).map((event, eventIndex) => ({
        ...event,
        __sourceIndex: sourceIndex,
        __eventIndex: eventIndex,
        __runId:
          item?.activity?.runId ??
          item?.runId ??
          `source-${sourceIndex}`
      }))
    )
    .sort((left, right) => {
      const timeDifference =
        eventTimestamp(left) -
        eventTimestamp(right);

      if (timeDifference !== 0) {
        return timeDifference;
      }

      if (left.__sourceIndex !== right.__sourceIndex) {
        return left.__sourceIndex - right.__sourceIndex;
      }

      return (
        Number(left.sequence ?? left.__eventIndex) -
        Number(right.sequence ?? right.__eventIndex)
      );
    });
  const events = rankedEvents.map(
    ({
      __sourceIndex,
      __eventIndex,
      __runId,
      ...event
    }) => event
  );

  const latestPlanEvent = [...events]
    .reverse()
    .find((event) => event.type === "plan");
  const toolEvents = rankedEvents.filter(
    (event) => event.type === "tool" && event.tool
  );
  const toolMap = new Map();

  for (const event of toolEvents) {
    const activityId =
      `${event.__runId}:${event.tool.id ?? event.id}`;
    const tool = {
      ...event.tool,
      activityId,
      status: normalizeToolStatus(
        event.tool.status ?? event.status
      )
    };
    toolMap.set(activityId, tool);
  }

  const toolCalls = [...toolMap.values()];
  const commentary = events
    .filter((event) => event.type === "commentary")
    .map((event) => ({
      id: event.id,
      content: String(event.content ?? "").trim(),
      phase: event.phase ?? "between_tools",
      batchId: event.batchId ?? "",
      createdAt: event.createdAt ?? 0
    }))
    .filter((event) => event.content);
  const batches = events
    .filter((event) => event.type === "batch" && event.batch)
    .map((event) => event.batch);
  const reasoning = events
    .filter((event) => event.type === "summary")
    .map((event) => String(event.content ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
  const lastSource = sources.at(-1) ?? source;
  const stopReason = String(
    lastSource?.activity?.stopReason ??
    lastSource?.stopReason ??
    ""
  ).trim();
  const durationMs = sources.reduce(
    (total, item) =>
      total + Number(
        item?.activity?.durationMs ??
        item?.durationMs ??
        0
      ),
    0
  );
  const planStats = getPlanStats(
    latestPlanEvent?.plan ??
    lastSource?.plan ??
    []
  );
  const running = Boolean(live) && [
    "running",
    "stopping",
    "cancelling"
  ].includes(lastSource?.state);
  const failed =
    planStats.blocked ||
    toolCalls.some(
      (toolCall) =>
        normalizeToolStatus(toolCall.status) === "error"
    ) ||
    ["failed"].includes(lastSource?.activity?.status);
  const aborted =
    lastSource?.status === "aborted" ||
    ["stopping", "cancelling"].includes(lastSource?.state) ||
    lastSource?.activity?.status === "cancelled" ||
    toolCalls.some(
      (toolCall) =>
        normalizeToolStatus(toolCall.status) === "aborted"
    );

  const interrupted =
    lastSource?.status === "interrupted" ||
    lastSource?.activity?.status === "interrupted" ||
    stopReason === "interrupted";

  return {
    source: lastSource,
    sources,
    messageId: lastSource?.id ?? "live",
    taskId: sourceTaskId(lastSource),
    runId:
      lastSource?.activity?.runId ??
      lastSource?.runId ??
      "",
    live,
    running,
    failed,
    aborted,
    interrupted,
    events,
    plan: planStats.plan,
    planStats,
    toolCalls,
    commentary,
    batches,
    reasoning,
    durationMs,
    stopReason,
    status:
      lastSource?.activity?.status ??
      (running ? "running" : "completed")
  };
}

export function createTaskSnapshot({
  conversation,
  liveActivity,
  targetMessageId
}) {
  const useLive = Boolean(liveActivity) && (
    targetMessageId === "live" ||
    !targetMessageId
  );
  const source = useLive
    ? liveActivity
    : findTaskMessage(
        conversation,
        targetMessageId === "live"
          ? null
          : targetMessageId
      );

  return createActivitySnapshot(
    source,
    {
      conversation,
      live: useLive
    }
  );
}
