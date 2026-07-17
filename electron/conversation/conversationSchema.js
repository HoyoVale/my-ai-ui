const STORE_VERSION = 1;

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

export function createEmptyConversationData() {
  return {
    version: STORE_VERSION,
    currentConversationId: null,
    conversations: []
  };
}

export function sanitizeMessage(
  source,
  fallbackTimestamp = 0
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

  return {
    id:
      stringValue(
        source.id,
        "",
        100
      ) || null,

    role,
    content,
    status,

    createdAt:
      timestampValue(
        source.createdAt,
        fallbackTimestamp
      )
  };
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
          .map((message) =>
            sanitizeMessage(
              message,
              createdAt
            )
          )
          .filter(Boolean)
      : [];

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
