const STORE_VERSION = 4;

const MESSAGE_ROLES =
  new Set([
    "user",
    "assistant"
  ]);

const MESSAGE_STATUSES =
  new Set([
    "complete",
    "aborted"
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

function jsonValue(
  value
) {
  if (
    value === undefined
  ) {
    return undefined;
  }

  try {
    return JSON.parse(
      JSON.stringify(value)
    );
  } catch {
    return String(value)
      .slice(0, 200000);
  }
}

function sanitizeToolCall(
  source,
  index
) {
  if (
    !source ||
    typeof source !== "object"
  ) {
    return null;
  }

  const name =
    stringValue(
      source.name,
      "",
      120
    ).trim();

  if (!name) {
    return null;
  }

  const toolCall = {
    id:
      stringValue(
        source.id,
        `tool-${index + 1}`,
        120
      ) ||
      `tool-${index + 1}`,
    name,
    status:
      stringValue(
        source.status,
        "complete",
        40
      ) || "complete"
  };

  const input =
    jsonValue(source.input);
  const output =
    jsonValue(source.output);
  const durationMs =
    timestampValue(
      source.durationMs,
      0
    );

  if (input !== undefined) {
    toolCall.input = input;
  }

  if (output !== undefined) {
    toolCall.output = output;
  }

  if (durationMs > 0) {
    toolCall.durationMs =
      durationMs;
  }

  return toolCall;
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

  if (
    !role ||
    !content
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

    const reasoningSummary =
      stringValue(
        source.reasoningSummary,
        "",
        100000
      ).trim();

    const toolCalls =
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

    if (durationMs > 0) {
      message.durationMs =
        durationMs;
    }

    if (reasoningSummary) {
      message.reasoningSummary =
        reasoningSummary;
    }

    if (toolCalls.length > 0) {
      message.toolCalls =
        toolCalls;
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
