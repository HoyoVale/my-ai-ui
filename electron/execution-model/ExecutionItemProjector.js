import {
  sanitizePublicAssistantText
} from "../agent/PublicTextSanitizer.js";

import {
  EXECUTION_ITEM_KINDS,
  EXECUTION_ITEM_SCOPES,
  EXECUTION_ITEM_STATES,
  EXECUTION_ITEM_VISIBILITY,
  createExecutionItem
} from "./ExecutionItemSchema.js";
import {
  sequenceExecutionItems,
  stableExecutionItemId
} from "./ExecutionItemSequence.js";

function text(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function timestamp(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.round(number))
    : fallback;
}

function itemStatus(value, fallback = EXECUTION_ITEM_STATES.COMPLETED) {
  if (value === "queued") return EXECUTION_ITEM_STATES.QUEUED;
  if (["running", "in_progress", "retrying"].includes(value)) {
    return EXECUTION_ITEM_STATES.RUNNING;
  }
  if (["cancelled", "aborted"].includes(value)) {
    return EXECUTION_ITEM_STATES.CANCELLED;
  }
  if (["failed", "error", "attention", "blocked"].includes(value)) {
    return EXECUTION_ITEM_STATES.FAILED;
  }
  if (value === "superseded") return EXECUTION_ITEM_STATES.SUPERSEDED;
  return fallback;
}

function resultReference(value) {
  if (typeof value === "string") return text(value, 500);
  if (!value || typeof value !== "object") return "";
  for (const key of ["uri", "id", "path", "key", "resultId"]) {
    if (value[key]) return text(value[key], 500);
  }
  return "";
}

function toolCommandPreview(tool) {
  const result = tool?.result && typeof tool.result === "object"
    ? tool.result
    : {};
  const source = tool?.commandPreview ?? result.commandPreview;
  return source && typeof source === "object" ? source : null;
}

function toolChangePreview(tool) {
  const result = tool?.result && typeof tool.result === "object"
    ? tool.result
    : {};
  const source = result.changePreview ?? tool?.changePreview;
  return source && typeof source === "object" ? source : null;
}

function classifyToolKind(tool) {
  if (toolCommandPreview(tool)?.displayCommand) {
    return EXECUTION_ITEM_KINDS.COMMAND;
  }
  if (toolChangePreview(tool)) {
    return EXECUTION_ITEM_KINDS.FILE_CHANGE;
  }
  return EXECUTION_ITEM_KINDS.TOOL_CALL;
}

function toolSummary(tool) {
  const command = toolCommandPreview(tool);
  if (command?.displayCommand) {
    return text(command.displayCommand, 1000);
  }

  const change = toolChangePreview(tool);
  if (change) {
    const paths = Array.isArray(change.paths)
      ? change.paths.map((value) => text(value, 300)).filter(Boolean)
      : [];
    const path = text(change.path, 300);
    const target = paths.length > 0 ? paths.join(", ") : path;
    return text(
      target
        ? `${tool?.title || tool?.name || "文件修改"} · ${target}`
        : tool?.title || tool?.name || "文件修改",
      1000
    );
  }

  const result = tool?.result && typeof tool.result === "object"
    ? tool.result
    : {};
  const title = text(tool?.title || tool?.name || "工具调用", 240);
  const summary = text(result.summary, 600);
  return text(summary ? `${title} · ${summary}` : title, 1000);
}

function planSummary(event, planState) {
  const items = Array.isArray(event?.plan)
    ? event.plan
    : Array.isArray(planState?.rootItems)
      ? planState.rootItems
      : Array.isArray(planState)
        ? planState
        : [];
  const completed = items.filter((item) => [
    "completed",
    "skipped",
    "superseded"
  ].includes(item?.status)).length;
  const label = text(event?.title, 400);
  if (label) return label;
  return items.length > 0
    ? `计划进度 ${completed}/${items.length}`
    : "计划更新";
}

function diffSummaryText(diffSummary) {
  const files = Array.isArray(diffSummary?.files)
    ? diffSummary.files
    : [];
  const totals = diffSummary?.totals && typeof diffSummary.totals === "object"
    ? diffSummary.totals
    : {};
  const fileCount = Math.max(0, Number(totals.files) || files.length);
  const added = Math.max(0, Number(totals.added) || 0);
  const removed = Math.max(0, Number(totals.removed) || 0);
  return `最终变更 ${fileCount} 个文件（+${added} -${removed}）`;
}

function checkpointSummary(checkpoint) {
  if (!checkpoint || typeof checkpoint !== "object") return "";
  const objective = text(checkpoint.objective, 700);
  const phase = text(checkpoint.phase, 120);
  const publicStatus = text(checkpoint.publicStatus || checkpoint.outcome, 120);
  return text(
    [objective, phase, publicStatus].filter(Boolean).join(" · ") || "运行检查点",
    1000
  );
}

function verificationFromCheckpoint(checkpoint) {
  const verification = checkpoint?.orchestration?.goal?.verification ??
    checkpoint?.goalVerification ??
    checkpoint?.verification;
  return verification && typeof verification === "object"
    ? verification
    : null;
}

function verificationSummary(verification) {
  if (!verification) return "";
  const status = text(verification.status, 120);
  const checks = Array.isArray(verification.checks)
    ? verification.checks
    : [];
  const passed = checks.filter((check) => check?.passed === true).length;
  if (checks.length > 0) {
    return `验证 ${passed}/${checks.length}${status ? ` · ${status}` : ""}`;
  }
  return status || (verification.verified === true ? "验证通过" : "验证未通过");
}

function createProjectedItem({
  threadId,
  runId,
  kind,
  status,
  visibility = EXECUTION_ITEM_VISIBILITY.PUBLIC,
  sourceType,
  sourceId,
  parentItemId = "",
  summary = "",
  resultRef = "",
  createdAt,
  completedAt = null,
  projection = {}
}) {
  const id = stableExecutionItemId({
    threadId,
    runId,
    kind,
    sourceType,
    sourceId
  });
  const item = createExecutionItem({
    id,
    threadId,
    runId,
    scope: EXECUTION_ITEM_SCOPES.RUN,
    sequence: 1,
    kind,
    status,
    visibility,
    sourceType,
    sourceId,
    parentItemId,
    summary,
    resultRef,
    now: createdAt
  });
  if (!item) return null;

  return {
    ...item,
    completedAt: completedAt == null ? item.completedAt : timestamp(completedAt),
    projection
  };
}

function projectActivityEvent({
  event,
  threadId,
  runId,
  assistantMessage,
  batchItemIds
}) {
  const sourceId = text(event?.id, 160);
  if (!sourceId) return null;
  const createdAt = timestamp(
    event.createdAt,
    timestamp(assistantMessage?.createdAt)
  );
  const completedAt = timestamp(event.updatedAt, createdAt);
  const visibility = event.activityVisibility === "developer"
    ? EXECUTION_ITEM_VISIBILITY.DEVELOPER
    : EXECUTION_ITEM_VISIBILITY.PUBLIC;
  const parentItemId = event.batchId
    ? batchItemIds.get(event.batchId) ?? ""
    : "";
  const common = {
    threadId,
    runId,
    visibility,
    sourceType: "activity_event",
    sourceId,
    parentItemId,
    createdAt,
    completedAt,
    projection: {
      timestamp: createdAt,
      group: 1,
      sourceSequence: timestamp(event.sequence),
      priority: 100,
      tieBreaker: sourceId
    }
  };

  if (event.type === "commentary") {
    return createProjectedItem({
      ...common,
      kind: EXECUTION_ITEM_KINDS.ASSISTANT_COMMENTARY,
      status: itemStatus(event.status),
      summary: text(event.content, 1000)
    });
  }

  if (event.type === "plan") {
    return createProjectedItem({
      ...common,
      kind: EXECUTION_ITEM_KINDS.PLAN_UPDATE,
      status: itemStatus(event.status, EXECUTION_ITEM_STATES.RUNNING),
      summary: planSummary(event)
    });
  }

  if (event.type === "tool" && event.tool) {
    const tool = event.tool;
    const kind = classifyToolKind(tool);
    return createProjectedItem({
      ...common,
      kind,
      status: itemStatus(tool.status),
      summary: toolSummary(tool),
      resultRef: resultReference(tool.result?.reference),
      projection: {
        ...common.projection,
        dedupeKey: `tool:${runId}:${tool.id || sourceId}`
      }
    });
  }

  if (event.type === "batch") {
    return createProjectedItem({
      ...common,
      kind: EXECUTION_ITEM_KINDS.STATUS,
      status: itemStatus(event.status, EXECUTION_ITEM_STATES.RUNNING),
      summary: text(event.batch?.objective || event.title || "工具批次", 1000)
    });
  }

  if (event.type === "skill") {
    return createProjectedItem({
      ...common,
      kind: EXECUTION_ITEM_KINDS.STATUS,
      status: itemStatus(event.status),
      summary: text(event.title || event.skill?.name || "Skill", 1000)
    });
  }

  if (event.type === "status") {
    const failed = ["failed", "blocked", "attention"].includes(event.status);
    return createProjectedItem({
      ...common,
      kind: failed ? EXECUTION_ITEM_KINDS.ERROR : EXECUTION_ITEM_KINDS.STATUS,
      status: itemStatus(event.status),
      summary: text(event.title || event.stopReason || event.status, 1000)
    });
  }

  return null;
}

export function projectRunExecutionItems({
  threadId,
  runId,
  userMessage = null,
  assistantMessage = null,
  activity = assistantMessage?.activity ?? null,
  planState = assistantMessage?.planState ?? null,
  toolCalls = assistantMessage?.toolCalls ?? [],
  diffSummary = assistantMessage?.diffSummary ?? null,
  checkpoint = activity?.checkpoint ?? null
} = {}) {
  const resolvedThreadId = text(threadId, 160);
  const resolvedRunId = text(runId, 160);
  if (!resolvedThreadId || !resolvedRunId) return [];

  const candidates = [];
  const userCreatedAt = timestamp(userMessage?.createdAt);
  const assistantCreatedAt = timestamp(
    assistantMessage?.createdAt,
    timestamp(activity?.endedAt, timestamp(activity?.startedAt, userCreatedAt))
  );

  if (userMessage?.id && userMessage?.role === "user") {
    candidates.push(createProjectedItem({
      threadId: resolvedThreadId,
      runId: resolvedRunId,
      kind: EXECUTION_ITEM_KINDS.USER_MESSAGE,
      status: EXECUTION_ITEM_STATES.COMPLETED,
      sourceType: "conversation_message",
      sourceId: text(userMessage.id, 160),
      summary: text(userMessage.content, 1000),
      createdAt: userCreatedAt,
      completedAt: userCreatedAt,
      projection: {
        timestamp: userCreatedAt,
        group: 0,
        sourceSequence: 0,
        priority: 100,
        tieBreaker: userMessage.id
      }
    }));
  }

  const events = Array.isArray(activity?.events) ? activity.events : [];
  const batchItemIds = new Map();
  for (const event of events) {
    if (event?.type !== "batch") continue;
    const sourceId = text(event.id, 160);
    if (!sourceId) continue;
    batchItemIds.set(
      event.batch?.id || event.batchId || sourceId,
      stableExecutionItemId({
        threadId: resolvedThreadId,
        runId: resolvedRunId,
        kind: EXECUTION_ITEM_KINDS.STATUS,
        sourceType: "activity_event",
        sourceId
      })
    );
  }

  for (const event of events) {
    const item = projectActivityEvent({
      event,
      threadId: resolvedThreadId,
      runId: resolvedRunId,
      assistantMessage,
      batchItemIds
    });
    if (item) candidates.push(item);
  }

  const hasPlanEvent = events.some((event) => event?.type === "plan");
  const rootItems = Array.isArray(planState?.rootItems)
    ? planState.rootItems
    : Array.isArray(planState)
      ? planState
      : [];
  if (!hasPlanEvent && rootItems.length > 0) {
    candidates.push(createProjectedItem({
      threadId: resolvedThreadId,
      runId: resolvedRunId,
      kind: EXECUTION_ITEM_KINDS.PLAN_UPDATE,
      status: rootItems.every((item) => ["completed", "skipped", "superseded"].includes(item?.status))
        ? EXECUTION_ITEM_STATES.COMPLETED
        : EXECUTION_ITEM_STATES.RUNNING,
      sourceType: "plan_state",
      sourceId: text(planState?.rootPlanId || `plan:${resolvedRunId}`, 160),
      summary: planSummary(null, planState),
      createdAt: timestamp(activity?.startedAt, userCreatedAt),
      completedAt: assistantCreatedAt,
      projection: {
        timestamp: timestamp(activity?.startedAt, userCreatedAt),
        group: 1,
        sourceSequence: 0,
        priority: 50,
        tieBreaker: "fallback-plan"
      }
    }));
  }

  const activityToolIds = new Set(
    events
      .filter((event) => event?.type === "tool")
      .map((event) => text(event.tool?.id || event.id, 160))
      .filter(Boolean)
  );
  for (let index = 0; index < (Array.isArray(toolCalls) ? toolCalls : []).length; index += 1) {
    const tool = toolCalls[index];
    const sourceId = text(tool?.id || `tool-${index + 1}`, 160);
    if (!sourceId || activityToolIds.has(sourceId)) continue;
    const createdAt = timestamp(
      tool?.queuedAt || tool?.startedAt,
      timestamp(activity?.startedAt, userCreatedAt)
    );
    candidates.push(createProjectedItem({
      threadId: resolvedThreadId,
      runId: resolvedRunId,
      kind: classifyToolKind(tool),
      status: itemStatus(tool?.status),
      visibility: tool?.activityVisibility === "developer"
        ? EXECUTION_ITEM_VISIBILITY.DEVELOPER
        : EXECUTION_ITEM_VISIBILITY.PUBLIC,
      sourceType: "legacy_tool",
      sourceId,
      summary: toolSummary(tool),
      resultRef: resultReference(tool?.result?.reference),
      createdAt,
      completedAt: timestamp(tool?.endedAt, assistantCreatedAt),
      projection: {
        timestamp: createdAt,
        group: 1,
        sourceSequence: index,
        priority: 40,
        dedupeKey: `tool:${resolvedRunId}:${sourceId}`,
        tieBreaker: sourceId
      }
    }));
  }

  if (checkpoint && typeof checkpoint === "object") {
    const checkpointId = text(
      checkpoint.id || checkpoint.checkpointId || `checkpoint:${resolvedRunId}`,
      160
    );
    const checkpointAt = timestamp(checkpoint.updatedAt, assistantCreatedAt);
    candidates.push(createProjectedItem({
      threadId: resolvedThreadId,
      runId: resolvedRunId,
      kind: EXECUTION_ITEM_KINDS.CHECKPOINT,
      status: EXECUTION_ITEM_STATES.COMPLETED,
      visibility: EXECUTION_ITEM_VISIBILITY.DEVELOPER,
      sourceType: "run_checkpoint",
      sourceId: checkpointId,
      summary: checkpointSummary(checkpoint),
      resultRef: text(checkpoint.resultRef, 500),
      createdAt: checkpointAt,
      completedAt: checkpointAt,
      projection: {
        timestamp: checkpointAt,
        group: 2,
        sourceSequence: 0,
        priority: 80,
        tieBreaker: checkpointId
      }
    }));

    const verification = verificationFromCheckpoint(checkpoint);
    if (verification) {
      candidates.push(createProjectedItem({
        threadId: resolvedThreadId,
        runId: resolvedRunId,
        kind: EXECUTION_ITEM_KINDS.VERIFICATION,
        status: verification.verified === true
          ? EXECUTION_ITEM_STATES.COMPLETED
          : EXECUTION_ITEM_STATES.FAILED,
        visibility: EXECUTION_ITEM_VISIBILITY.DEVELOPER,
        sourceType: "goal_verification",
        sourceId: text(verification.id || `${checkpointId}:verification`, 160),
        summary: verificationSummary(verification),
        createdAt: checkpointAt,
        completedAt: checkpointAt,
        projection: {
          timestamp: checkpointAt,
          group: 2,
          sourceSequence: 1,
          priority: 90,
          tieBreaker: `${checkpointId}:verification`
        }
      }));
    }
  }

  if (diffSummary && typeof diffSummary === "object" && diffSummary.empty !== true) {
    const diffAt = assistantCreatedAt;
    candidates.push(createProjectedItem({
      threadId: resolvedThreadId,
      runId: resolvedRunId,
      kind: EXECUTION_ITEM_KINDS.DIFF,
      status: EXECUTION_ITEM_STATES.COMPLETED,
      sourceType: "diff_summary",
      sourceId: text(
        diffSummary.id || `diff:${assistantMessage?.id || resolvedRunId}:${diffSummary.revision ?? 0}`,
        160
      ),
      summary: diffSummaryText(diffSummary),
      resultRef: text(
        diffSummary.resultRef || `conversation-message:${assistantMessage?.id || ""}:diff`,
        500
      ),
      createdAt: diffAt,
      completedAt: diffAt,
      projection: {
        timestamp: diffAt,
        group: 2,
        sourceSequence: 2,
        priority: 90,
        tieBreaker: "diff-summary"
      }
    }));
  }

  const finalText = sanitizePublicAssistantText(assistantMessage?.content);
  if (assistantMessage?.id && assistantMessage?.role === "assistant" && finalText) {
    const finalStatus = assistantMessage.status === "aborted"
      ? EXECUTION_ITEM_STATES.CANCELLED
      : EXECUTION_ITEM_STATES.COMPLETED;
    candidates.push(createProjectedItem({
      threadId: resolvedThreadId,
      runId: resolvedRunId,
      kind: EXECUTION_ITEM_KINDS.ASSISTANT_FINAL,
      status: finalStatus,
      sourceType: "conversation_message",
      sourceId: text(assistantMessage.id, 160),
      summary: text(finalText, 1000),
      createdAt: assistantCreatedAt,
      completedAt: assistantCreatedAt,
      projection: {
        timestamp: assistantCreatedAt,
        group: 3,
        sourceSequence: 0,
        priority: 100,
        tieBreaker: assistantMessage.id
      }
    }));
  }

  return sequenceExecutionItems(candidates.filter(Boolean));
}
