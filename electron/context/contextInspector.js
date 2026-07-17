import {
  conversationManager
} from "../conversation/index.js";

import {
  memoryManager
} from "../memory/index.js";

import {
  getSettings
} from "../settings/settingsStore.js";

import {
  assembleAgentContext
} from "./ContextAssembler.js";

function getInspectionQuery(
  conversation
) {
  return conversation
    ?.messages
    ?.findLast?.(
      (message) =>
        message.role === "user" &&
        message.status === "complete"
    )
    ?.content ??
    conversation?.summary ??
    conversation?.title ??
    "";
}

export function inspectConversationContext(
  conversationId
) {
  const conversation =
    conversationManager
      .getConversation(
        conversationId
      );

  if (!conversation) {
    return null;
  }

  const memories =
    memoryManager.retrieve({
      query:
        getInspectionQuery(
          conversation
        ),
      trackUsage: false
    });

  const context =
    assembleAgentContext({
      settings: getSettings(),
      conversation,
      memories
    });

  return {
    conversationId:
      conversation.id,
    title: conversation.title,
    summary:
      conversation.summary,
    contextStartAfterMessageId:
      conversation
        .contextStartAfterMessageId,
    budget: context.budget,
    metadata:
      context.metadata,
    memories:
      memories.map((memory) => ({
        id: memory.id,
        title: memory.title,
        priority:
          memory.priority
      })),
    recentMessages:
      context.metadata
        .recentMessageIds,
    pinnedMessages:
      context.metadata
        .pinnedMessageIds
  };
}
