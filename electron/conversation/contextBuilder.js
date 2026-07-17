function isCompleteMessage(
  message
) {
  return (
    message &&
    (
      message.role === "user" ||
      message.role === "assistant"
    ) &&
    message.status === "complete" &&
    typeof message.content === "string" &&
    message.content.trim()
  );
}

function isRecentContextMessage(
  message
) {
  return (
    isCompleteMessage(message) &&
    message.includeInContext !== false
  );
}

export function getMessagesAfterContextBoundary({
  messages = [],
  contextStartAfterMessageId = null
} = {}) {
  if (!contextStartAfterMessageId) {
    return messages;
  }

  const boundaryIndex =
    messages.findIndex(
      (message) =>
        message.id ===
        contextStartAfterMessageId
    );

  return boundaryIndex >= 0
    ? messages.slice(
        boundaryIndex + 1
      )
    : messages;
}

export function groupConversationTurns(
  messages = []
) {
  const turns = [];
  let currentTurn = null;

  for (
    const message
    of messages
  ) {
    if (
      !isRecentContextMessage(
        message
      )
    ) {
      continue;
    }

    const normalized = {
      id: message.id ?? null,
      role: message.role,
      content:
        message.content.trim()
    };

    if (
      normalized.role ===
      "user"
    ) {
      currentTurn = [
        normalized
      ];

      turns.push(
        currentTurn
      );

      continue;
    }

    if (!currentTurn) {
      continue;
    }

    currentTurn.push(
      normalized
    );
  }

  return turns;
}

export function selectShortTermContextMessages({
  messages = [],
  maxTurns = 8,
  contextStartAfterMessageId = null
} = {}) {
  const normalizedMaxTurns =
    Math.max(
      1,
      Math.min(
        50,
        Math.round(
          Number(maxTurns) ||
          1
        )
      )
    );

  const afterBoundary =
    getMessagesAfterContextBoundary({
      messages,
      contextStartAfterMessageId
    });

  const turns =
    groupConversationTurns(
      afterBoundary
    );

  return turns
    .slice(
      -normalizedMaxTurns
    )
    .flat();
}

export function buildShortTermContext(
  options = {}
) {
  return selectShortTermContextMessages(
    options
  ).map((message) => ({
    role: message.role,
    content: message.content
  }));
}

export function selectPinnedContextMessages(
  messages = []
) {
  return messages.filter(
    (message) =>
      isCompleteMessage(message) &&
      message.includeInContext !== false &&
      message.pinnedToContext === true
  );
}

export function buildPinnedConversationContext(
  messages = []
) {
  const pinned =
    selectPinnedContextMessages(
      messages
    );

  if (pinned.length === 0) {
    return "";
  }

  const lines =
    pinned.map((message) => {
      const speaker =
        message.role === "assistant"
          ? "助手"
          : "用户";

      return `- ${speaker}：${message.content.trim()}`;
    });

  return [
    "以下消息已由用户固定到当前会话上下文，应持续参考：",
    ...lines
  ].join("\n");
}
