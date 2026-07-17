function isContextMessage(
  message
) {
  return (
    message &&
    (
      message.role === "user" ||
      message.role === "assistant"
    ) &&
    message.status ===
      "complete" &&
    typeof message.content ===
      "string" &&
    message.content.trim()
  );
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
      !isContextMessage(
        message
      )
    ) {
      continue;
    }

    const normalized = {
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

export function buildShortTermContext({
  messages = [],
  maxTurns = 8
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

  const turns =
    groupConversationTurns(
      messages
    );

  return turns
    .slice(
      -normalizedMaxTurns
    )
    .flat();
}
