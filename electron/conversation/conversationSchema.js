import {
  createLegacyActivity,
  deriveLegacyActivityFields,
  sanitizeActivity,
  sanitizeActivityTool
} from "./activitySchema.js";

import {
  normalizeRunStopReason
} from "../agent/runStopReasons.js";

const STORE_VERSION = 12;

const MESSAGE_ROLES =
  new Set([
    "user",
    "assistant"
  ]);

const MESSAGE_STATUSES =
  new Set([
    "running",
    "complete",
    "aborted",
    "interrupted"
  ]);

function stringValue(
  value,
  fallback = "",
  maxLength = 200000
) {
  if (
    typeof value !== "string"
  ) {
    return fallback;
  }

  return value.slice(
    0,
    maxLength
  );
}

function nullableStringValue(
  value,
  maxLength = 120
) {
  const normalized = stringValue(
    value,
    "",
    maxLength
  ).trim();

  return normalized || null;
}

function sanitizeWorkspaceSnapshot(source) {
  if (!source || typeof source !== "object") {
    return null;
  }

  const id = nullableStringValue(source.id, 120);
  const rootPath = stringValue(
    source.rootPath ?? source.canonicalPath,
    "",
    2000
  ).trim();

  if (!id || !rootPath) {
    return null;
  }

  return {
    id,
    name: stringValue(
      source.name,
      "工作区",
      120
    ).trim() || "工作区",
    rootPath,
    canonicalPath: stringValue(
      source.canonicalPath,
      rootPath,
      2000
    ).trim() || rootPath
  };
}

function timestampValue(
  value,
  fallback
) {
  const numeric =
    Number(value);

  return Number.isFinite(
    numeric
  )
    ? Math.max(
        0,
        Math.round(numeric)
      )
    : fallback;
}

function booleanValue(
  value,
  fallback
) {
  return typeof value ===
    "boolean"
    ? value
    : fallback;
}


function sanitizePlanItem(
  source,
  index
) {
  if (
    !source ||
    typeof source !== "object"
  ) {
    return null;
  }

  const title = stringValue(
    source.title,
    "",
    200
  ).trim();

  if (!title) {
    return null;
  }

  const status = [
    "pending",
    "in_progress",
    "completed",
    "blocked",
    "needs_input",
    "skipped",
    "cancelled",
    "superseded"
  ].includes(source.status)
    ? source.status
    : "pending";

  return {
    id:
      stringValue(
        source.id,
        `step-${index + 1}`,
        80
      ) || `step-${index + 1}`,
    title,
    status,
    reason: stringValue(
      source.reason,
      "",
      300
    ).trim()
  };
}
function sanitizeToolCall(
  source,
  index
) {
  return sanitizeActivityTool(
    source,
    index
  );
}

export function createEmptyConversationData() {
  return {
    version: STORE_VERSION,
    currentConversationId: null,
    conversations: []
  };
}

export function sanitizeMessage(
  source,
  fallbackTimestamp = 0,
  fallbackId = null
) {
  if (
    !source ||
    typeof source !== "object"
  ) {
    return null;
  }

  const role =
    MESSAGE_ROLES.has(
      source.role
    )
      ? source.role
      : null;

  const legacyQuestion =
    role === "assistant" &&
    source.pendingQuestion &&
    typeof source.pendingQuestion === "object"
      ? stringValue(
          source.pendingQuestion.question,
          "",
          1000
        ).trim()
      : "";
  const legacyAnswer =
    legacyQuestion
      ? stringValue(
          source.pendingQuestion?.answer,
          "",
          2000
        ).trim()
      : "";
  const sourceContent =
    stringValue(
      source.content
    ).trim();
  const content =
    sourceContent ||
    (legacyQuestion
      ? legacyAnswer
        ? `已记录的信息：${legacyQuestion}\n\n回答：${legacyAnswer}`
        : `需要补充信息：${legacyQuestion}`
      : "");

  const canStoreEmptyAssistant =
    role === "assistant" &&
    Boolean(source.activity);

  if (
    !role ||
    (
      !content &&
      !canStoreEmptyAssistant
    )
  ) {
    return null;
  }

  const status =
    source.status === "waiting"
      ? "complete"
      : MESSAGE_STATUSES.has(
          source.status
        )
        ? source.status
        : "complete";

  const includeInContext =
    booleanValue(
      source.includeInContext,
      true
    );

  const message = {
    id:
      stringValue(
        source.id,
        "",
        100
      ) || fallbackId,

    role,
    content,
    status,

    includeInContext,

    pinnedToContext:
      includeInContext &&
      booleanValue(
        source.pinnedToContext,
        false
      ),

    createdAt:
      timestampValue(
        source.createdAt,
        fallbackTimestamp
      )
  };

  if (role === "assistant") {
    const durationMs =
      timestampValue(
        source.durationMs,
        0
      );

    const sourceToolCalls =
      Array.isArray(
        source.toolCalls
      )
        ? source.toolCalls
            .map(
              sanitizeToolCall
            )
            .filter(Boolean)
            .slice(0, 100)
        : [];

    const sourcePlan =
      Array.isArray(source.plan)
        ? source.plan
            .map(sanitizePlanItem)
            .filter(Boolean)
            .slice(0, 20)
        : [];

    const migratedPlan =
      legacyQuestion && !legacyAnswer
        ? sourcePlan.map((item) =>
            item.status === "in_progress"
              ? {
                  ...item,
                  status: "needs_input",
                  reason: item.reason || legacyQuestion
                }
              : item
          )
        : sourcePlan;

    const sourceTaskId =
      stringValue(
        source.taskId,
        "",
        120
      );

    const legacyStopReason =
      legacyQuestion && !legacyAnswer
        ? "needs_input"
        : normalizeRunStopReason(
            source.stopReason,
            status === "aborted"
              ? "cancelled_by_user"
              : "completed"
          );

    const hasLegacyActivity =
      durationMs > 0 ||
      sourceToolCalls.length > 0 ||
      migratedPlan.length > 0 ||
      Boolean(source.stopReason) ||
      Boolean(legacyQuestion);

    const activity =
      sanitizeActivity(
        source.activity
      ) ??
      (hasLegacyActivity
        ? createLegacyActivity({
            messageId:
              message.id ?? fallbackId,
            createdAt:
              message.createdAt,
            durationMs,
            toolCalls:
              sourceToolCalls,
            plan: migratedPlan,
            stopReason:
              legacyStopReason,
            taskId:
              sourceTaskId
          })
        : null);

    const derived =
      deriveLegacyActivityFields(
        activity
      );

    const toolCalls =
      sourceToolCalls.length > 0
        ? sourceToolCalls
        : derived.toolCalls;
    const plan =
      migratedPlan.length > 0
        ? migratedPlan
        : derived.plan;

    if (durationMs > 0) {
      message.durationMs =
        durationMs;
    } else if (
      activity?.durationMs > 0
    ) {
      message.durationMs =
        activity.durationMs;
    }

    if (toolCalls.length > 0) {
      message.toolCalls =
        toolCalls;
    }

    if (plan.length > 0) {
      message.plan = plan;
    }

    if (activity) {
      message.activity =
        activity;
      message.taskId =
        activity.taskId ||
        sourceTaskId ||
        message.id;
      message.stopReason =
        activity.stopReason;
    } else {
      message.stopReason =
        legacyStopReason;
    }

    const resumedFromMessageId =
      stringValue(
        source.resumedFromMessageId,
        "",
        100
      );

    if (resumedFromMessageId) {
      message.resumedFromMessageId =
        resumedFromMessageId;
    }
  }

  return message;
}

export function sanitizeConversation(
  source,
  fallbackTimestamp = 0
) {
  if (
    !source ||
    typeof source !== "object"
  ) {
    return null;
  }

  const id =
    stringValue(
      source.id,
      "",
      100
    );

  if (!id) {
    return null;
  }

  const createdAt =
    timestampValue(
      source.createdAt,
      fallbackTimestamp
    );

  const messages =
    Array.isArray(
      source.messages
    )
      ? source.messages
          .map((message, index) =>
            sanitizeMessage(
              message,
              createdAt,
              `${id}-message-${index + 1}`
            )
          )
          .filter(Boolean)
      : [];

  const messageIds =
    new Set(
      messages.map(
        (message) =>
          message.id
      )
    );

  const requestedBoundary =
    stringValue(
      source.contextStartAfterMessageId,
      "",
      100
    );

  const updatedAt =
    Math.max(
      createdAt,
      timestampValue(
        source.updatedAt,
        createdAt
      ),
      ...messages.map(
        (message) =>
          message.createdAt
      )
    );

  const workspaceId = nullableStringValue(
    source.workspaceId,
    120
  );
  const workspaceSnapshot =
    sanitizeWorkspaceSnapshot(
      source.workspaceSnapshot
    );

  return {
    id,

    workspaceId,
    workspaceSnapshot:
      workspaceId && workspaceSnapshot?.id === workspaceId
        ? workspaceSnapshot
        : null,

    title:
      stringValue(
        source.title,
        "新会话",
        80
      ).trim() || "新会话",

    contextStartAfterMessageId:
      messageIds.has(
        requestedBoundary
      )
        ? requestedBoundary
        : null,

    createdAt,
    updatedAt,
    messages
  };
}

export function sanitizeConversationData(
  source
) {
  const fallback =
    createEmptyConversationData();

  if (
    !source ||
    typeof source !== "object"
  ) {
    return fallback;
  }

  const conversations =
    Array.isArray(
      source.conversations
    )
      ? source.conversations
          .map((conversation) =>
            sanitizeConversation(
              conversation
            )
          )
          .filter(Boolean)
      : [];

  const unique = [];
  const seenIds =
    new Set();

  for (
    const conversation
    of conversations
  ) {
    if (
      seenIds.has(
        conversation.id
      )
    ) {
      continue;
    }

    seenIds.add(
      conversation.id
    );

    unique.push(
      conversation
    );
  }

  unique.sort(
    (left, right) =>
      right.updatedAt -
      left.updatedAt
  );

  const requestedCurrentId =
    stringValue(
      source.currentConversationId,
      "",
      100
    );

  const currentConversationId =
    unique.some(
      (conversation) =>
        conversation.id ===
        requestedCurrentId
    )
      ? requestedCurrentId
      : unique[0]?.id ??
        null;

  return {
    version: STORE_VERSION,
    currentConversationId,
    conversations: unique
  };
}
