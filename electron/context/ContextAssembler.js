import {
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

import {
  resolveActiveModelSettings
} from "../settings/modelSettings.js";


export function assembleAgentContext({
  settings,
  conversation,
  memories = []
} = {}) {
  const normalizedSettings =
    settings ?? {};

  const activeModel =
    resolveActiveModelSettings(
      normalizedSettings.model
    );

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


  const pinnedContext =
    buildPinnedConversationContext(
      sourceMessages
    );

  const systemSections = [
    BASE_SYSTEM_CONTEXT,
    personalityContext,
    memoryContext,
    pinnedContext
  ].filter(Boolean);

  const system =
    systemSections.join("\n\n");

  const budget =
    buildTokenBudget({
      contextTokenBudget:
        activeModel
          .contextTokenBudget,
      outputReserve:
        activeModel
          .maxOutputTokens,
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
      activeModel: {
        providerId:
          activeModel.providerId,
        providerName:
          activeModel.providerName,
        modelConfigId:
          activeModel.modelConfigId,
        modelName:
          activeModel.modelName,
        modelId:
          activeModel.model,
        contextTokenBudget:
          activeModel.contextTokenBudget
      },

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
