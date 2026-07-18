import {
  createLegacyActivity,
  deriveLegacyActivityFields,
  sanitizeActivity,
  sanitizeActivityTool
} from "./activitySchema.js";

import {
  normalizeRunStopReason
} from "../agent/runStopReasons.js";

const STORE_VERSION = 10;

const MESSAGE_ROLES =
  new Set([
    "user",
    "assistant"
  ]);

const MESSAGE_STATUSES =
  new Set([
    "running",
    "waiting",
    "complete",
    "aborted",
    "interrupted"
  ]);

const PENDING_QUESTION_STATUSES =
  new Set([
    "waiting",
    "answered"
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


function sanitizePendingQuestion(source) {
  if (
    !source ||
    typeof source !== "object"
  ) {
    return null;
  }

  const question = stringValue(
    source.question,
    "",
    1000
  ).trim();

  if (!question) {
    return null;
  }

  const options =
    Array.isArray(source.options)
      ? source.options
          .map((option, index) => {
            if (
              !option ||
              typeof option !== "object"
            ) {
              return null;
            }

            const label = stringValue(
              option.label,
              "",
              200
            ).trim();
            const id = stringValue(
              option.id,
              `option-${index + 1}`,
              80
            ) || `option-${index + 1}`;
            const normalizedLabel =
              label.toLowerCase();

            if (
              !label ||
              id === "__other__" ||
              [
                "other",
                "other answer",
                "custom",
                "custom answer",
                "其他",
                "其它",
                "其他回答",
                "其它回答"
              ].includes(normalizedLabel)
            ) {
              return null;
            }

            return {
              id,
              label
            };
          })
          .filter(Boolean)
          .slice(0, 6)
      : [];

  const status =
    PENDING_QUESTION_STATUSES.has(
      source.status
    )
      ? source.status
      : "waiting";

  const result = {
    question,
    decisionId: stringValue(
      source.decisionId,
      "",
      160
    ).trim(),
    decisionKey: stringValue(
      source.decisionKey,
      "",
      320
    ).trim(),
    reason: stringValue(
      source.reason,
      "",
      500
    ).trim(),
    options,
    selectionMode:
      source.selectionMode ===
        "multiple"
        ? "multiple"
        : "single",
    allowOther:
      source.allowOther !== false,
    status
  };

  if (status === "answered") {
    result.answeredAt =
      timestampValue(
        source.answeredAt,
        0
      );
    result.answer =
      stringValue(
        source.answer,
        "",
        2000
      ).trim();
    result.selectedOptionIds =
      Array.isArray(
        source.selectedOptionIds
      )
        ? source.selectedOptionIds
            .map((id) =>
              stringValue(
                id,
                "",
                80
              )
            )
            .filter(Boolean)
            .slice(0, 6)
        : [];
    result.otherText =
      stringValue(
        source.otherText,
        "",
        2000
      ).trim();
  }

  return result;
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

  const content =
    stringValue(
      source.content
    ).trim();

  const canStoreEmptyAssistant =
    role === "assistant" &&
    (
      Boolean(
        source.pendingQuestion
      ) ||
      Boolean(
        source.activity
      )
    );

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
    MESSAGE_STATUSES.has(
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

    const sourceReasoning =
      stringValue(
        source.reasoningSummary,
        "",
        100000
      ).trim();

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

    const pendingQuestion =
      sanitizePendingQuestion(
        source.pendingQuestion
      );

    const sourceTaskId =
      stringValue(
        source.taskId,
        "",
        120
      );

    const legacyStopReason =
      normalizeRunStopReason(
        source.stopReason,
        status === "aborted"
          ? "cancelled_by_user"
          : "completed"
      );

    const hasLegacyActivity =
      durationMs > 0 ||
      Boolean(sourceReasoning) ||
      sourceToolCalls.length > 0 ||
      sourcePlan.length > 0 ||
      Boolean(source.stopReason) ||
      Boolean(pendingQuestion);

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
            reasoningSummary:
              sourceReasoning,
            toolCalls:
              sourceToolCalls,
            plan: sourcePlan,
            stopReason:
              legacyStopReason,
            pendingQuestion,
            taskId:
              sourceTaskId
          })
        : null);

    const derived =
      deriveLegacyActivityFields(
        activity
      );

    const reasoningSummary =
      sourceReasoning ||
      derived.reasoningSummary;
    const toolCalls =
      sourceToolCalls.length > 0
        ? sourceToolCalls
        : derived.toolCalls;
    const plan =
      sourcePlan.length > 0
        ? sourcePlan
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

    if (reasoningSummary) {
      message.reasoningSummary =
        reasoningSummary;
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

    if (pendingQuestion) {
      message.pendingQuestion =
        pendingQuestion;
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

  return {
    id,

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
