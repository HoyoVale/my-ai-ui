import {
  estimateTextTokens
} from "../context/tokenEstimator.js";

import {
  createCheckpointInstruction
} from "./runCheckpoint.js";

function messageTokens(message) {
  let content = "";

  try {
    content =
      typeof message?.content === "string"
        ? message.content
        : JSON.stringify(message?.content ?? "");
  } catch {
    content = String(message?.content ?? "");
  }

  return 4 + estimateTextTokens(content);
}

export function estimateRunMessagesTokens(
  messages = []
) {
  return (Array.isArray(messages) ? messages : [])
    .reduce(
      (total, message) =>
        total + messageTokens(message),
      0
    );
}

function recentResponseBoundary(
  responseMessages,
  maxRecentMessages
) {
  const messages = Array.isArray(responseMessages)
    ? responseMessages
    : [];
  let start = Math.max(
    0,
    messages.length - maxRecentMessages
  );

  while (
    start > 0 &&
    messages[start]?.role === "tool"
  ) {
    start -= 1;
  }

  return messages.slice(start);
}

export function compactRunStepContext({
  initialMessages = [],
  responseMessages = [],
  checkpoint = null,
  contextTokenBudget = 0,
  outputReserve = 4096,
  triggerRatio = 0.72,
  maxRecentMessages = 10
} = {}) {
  const budget = Math.max(
    0,
    Number(contextTokenBudget) || 0
  );
  const inputLimit = Math.max(
    0,
    budget - Math.max(0, Number(outputReserve) || 0)
  );
  const allMessages = [
    ...(Array.isArray(initialMessages) ? initialMessages : []),
    ...(Array.isArray(responseMessages) ? responseMessages : [])
  ];
  const estimatedTokens =
    estimateRunMessagesTokens(allMessages);
  const triggerTokens = Math.floor(
    inputLimit * Math.max(0.5, Math.min(0.9, Number(triggerRatio) || 0.72))
  );

  if (
    !checkpoint ||
    inputLimit <= 0 ||
    estimatedTokens <= triggerTokens
  ) {
    return {
      compacted: false,
      messages: allMessages,
      estimatedTokens,
      inputLimit,
      removedMessages: 0,
      checkpointInstruction: ""
    };
  }

  const recent = recentResponseBoundary(
    responseMessages,
    Math.max(4, Number(maxRecentMessages) || 10)
  );
  const messages = [
    ...(Array.isArray(initialMessages) ? initialMessages : []),
    ...recent
  ];
  const checkpointInstruction =
    createCheckpointInstruction(checkpoint);

  return {
    compacted: true,
    messages,
    estimatedTokens,
    compactedTokens:
      estimateRunMessagesTokens(messages) +
      estimateTextTokens(checkpointInstruction),
    inputLimit,
    removedMessages: Math.max(
      0,
      (Array.isArray(responseMessages) ? responseMessages.length : 0) -
      recent.length
    ),
    checkpointInstruction
  };
}
