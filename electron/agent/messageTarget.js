export function normalizeAgentMessageRequest(input) {
  if (input && typeof input === "object") {
    return {
      content: String(input.content ?? ""),
      expectedConversationId: String(
        input.expectedConversationId ?? ""
      ).trim(),
      continueTask: input.continueTask === true
    };
  }

  return {
    content: String(input ?? ""),
    expectedConversationId: "",
    continueTask: false
  };
}

export function getConversationTargetError(
  conversation,
  expectedConversationId = ""
) {
  const expected = String(expectedConversationId ?? "").trim();

  if (!expected) {
    return null;
  }

  const currentId = String(conversation?.id ?? "").trim();

  if (currentId === expected) {
    return null;
  }

  return {
    ok: false,
    code: "conversation-changed",
    message:
      "当前会话已经切换，请确认会话后重新发送。"
  };
}
