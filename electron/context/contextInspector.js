import {
  conversationManager
} from "../conversation/index.js";

import {
  resolveConversationExecutionContext
} from "../conversation/executionContext.js";

import {
  memoryManager
} from "../memory/index.js";

import {
  getSettings
} from "../settings/settingsStore.js";

import {
  assembleAgentContext
} from "./ContextAssembler.js";

import {
  getToolManifestSnapshot
} from "../tools/index.js";

import {
  aggregateTokenLedgers
} from "../agent/TokenLedger.js";

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

  const execution =
    resolveConversationExecutionContext({
      settings: getSettings(),
      conversation
    });

  const manifest = getToolManifestSnapshot({
    settings: execution.settings,
    executionContext: execution.metadata
  });

  const context =
    assembleAgentContext({
      settings: execution.settings,
      conversation: execution.conversation,
      memories,
      toolManifest: manifest.tools.filter((tool) => tool.ready)
    });

  const ledgers = (conversation.messages ?? [])
    .map((message) => message?.tokenLedger)
    .filter(Boolean);
  const latestRun = [...ledgers].reverse().find(Boolean) ?? null;
  const conversationUsage = aggregateTokenLedgers(ledgers);

  return {
    conversationId:
      conversation.id,
    title: conversation.title,
    mode: execution.metadata.mode,
    workspaceId: execution.metadata.workspaceId,
    contextStartAfterMessageId:
      conversation
        .contextStartAfterMessageId,
    budget: context.budget,
    usage: {
      latestRun,
      conversation: conversationUsage,
      goal: conversation.goal?.usage ?? null
    },
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
