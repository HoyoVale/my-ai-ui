import {
  buildConversationSummaryContext,
  buildPinnedConversationContext,
  selectPinnedContextMessages,
  selectShortTermContextMessages
} from "../conversation/contextBuilder.js";

import {
  buildMemoryContext
} from "../memory/memoryContextBuilder.js";

import {
  BASE_SYSTEM_CONTEXT
} from "./baseSystemContext.js";

import {
  buildPersonalityContext,
  getPersonalitySummary
} from "./personalityContextBuilder.js";

import {
  buildTokenBudget,
  estimateMessageTokens,
  estimateTextTokens
} from "./tokenEstimator.js";

export function assembleAgentContext({
  settings,
  conversation,
  memories = []
} = {}) {
  const normalizedSettings =
    settings ?? {};

  const sourceMessages =
    conversation?.messages ?? [];

  const pinnedMessages =
    selectPinnedContextMessages(
      sourceMessages
    );

  const pinnedIds =
    new Set(
      pinnedMessages.map(
        (message) =>
          message.id
      )
    );

  const selectedMessages =
    selectShortTermContextMessages({
      messages: sourceMessages,
      maxTurns:
        normalizedSettings
          .conversation
          ?.contextTurns ?? 8,
      contextStartAfterMessageId:
        conversation
          ?.contextStartAfterMessageId ??
        null
    }).filter(
      (message) =>
        !pinnedIds.has(
          message.id
        )
    );

  const messages =
    selectedMessages.map(
      (message) => ({
        role: message.role,
        content: message.content
      })
    );

  const personalityContext =
    buildPersonalityContext(
      normalizedSettings
        .personality
    );

  const memoryContext =
    normalizedSettings
      .memory
      ?.enabled === false
      ? ""
      : buildMemoryContext(
          memories
        );

  const summaryContext =
    buildConversationSummaryContext(
      conversation?.summary
    );

  const pinnedContext =
    buildPinnedConversationContext(
      sourceMessages
    );

  const systemSections = [
    BASE_SYSTEM_CONTEXT,
    personalityContext,
    memoryContext,
    summaryContext,
    pinnedContext
  ].filter(Boolean);

  const system =
    systemSections.join("\n\n");

  const budget =
    buildTokenBudget({
      contextTokenBudget:
        normalizedSettings
          .conversation
          ?.contextTokenBudget ??
        64000,
      outputReserve:
        normalizedSettings
          .model
          ?.maxOutputTokens ??
        2048,
      sections: [
        {
          id: "base",
          label: "基础提示词",
          tokens:
            estimateTextTokens(
              BASE_SYSTEM_CONTEXT
            )
        },
        {
          id: "personality",
          label: "Personality",
          tokens:
            estimateTextTokens(
              personalityContext
            )
        },
        {
          id: "memory",
          label: "长期记忆",
          tokens:
            estimateTextTokens(
              memoryContext
            )
        },
        {
          id: "summary",
          label: "会话摘要",
          tokens:
            estimateTextTokens(
              summaryContext
            )
        },
        {
          id: "pinned",
          label: "固定消息",
          tokens:
            estimateTextTokens(
              pinnedContext
            )
        },
        {
          id: "messages",
          label: "最近对话",
          tokens:
            estimateMessageTokens(
              messages
            )
        }
      ]
    });

  return {
    system,
    messages,
    budget,
    metadata: {
      personality:
        getPersonalitySummary(
          normalizedSettings
            .personality
        ),
      memoryCount:
        memoryContext
          ? memories.length
          : 0,
      messageCount:
        messages.length,
      contextTurns:
        normalizedSettings
          .conversation
          ?.contextTurns ?? 8,
      summaryIncluded:
        Boolean(summaryContext),
      pinnedMessageCount:
        pinnedMessages.length,
      recentMessageIds:
        selectedMessages
          .map(
            (message) =>
              message.id
          )
          .filter(Boolean),
      pinnedMessageIds:
        pinnedMessages
          .map(
            (message) =>
              message.id
          )
          .filter(Boolean),
      contextStartAfterMessageId:
        conversation
          ?.contextStartAfterMessageId ??
        null
    }
  };
}
