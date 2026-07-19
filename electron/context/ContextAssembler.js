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
  buildCapabilityContext
} from "./capabilityContextBuilder.js";

import {
  createPromptSection,
  renderPromptSections
} from "./promptSections.js";


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

import {
  buildRuntimeContextSection
} from "../runtime/runtimeContextProvider.js";

import {
  resolveToolProfileId
} from "../tools/toolCatalog.js";


export function assembleAgentContext({
  settings,
  conversation,
  memories = [],
  toolManifest = []
} = {}) {
  const normalizedSettings =
    settings ?? {};

  let activeModel;

  try {
    activeModel =
      resolveActiveModelSettings(
        normalizedSettings.model
      );
  } catch {
    activeModel = {
      provider: "unconfigured",
      providerId: "",
      providerName: "未配置",
      modelConfigId: "",
      modelName: "未配置",
      model: "",
      contextTokenBudget: 64000
    };
  }

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

  const runtimeContext =
    buildRuntimeContextSection({
      activeModel,
      contextSettings:
        normalizedSettings.context,
      toolSettings:
        normalizedSettings.tools
    });

  const capabilityContext =
    buildCapabilityContext({
      toolSettings:
        normalizedSettings.tools,
      toolManifest
    });

  const promptSections = [
    createPromptSection({
      id: "policy",
      authority: "policy",
      source: "app",
      title: "core",
      content: BASE_SYSTEM_CONTEXT
    }),
    createPromptSection({
      id: "capabilities",
      authority: "capability",
      source: "tool-runtime",
      title: "active tools",
      content: capabilityContext
    }),
    createPromptSection({
      id: "runtime",
      authority: "runtime",
      source: "app",
      title: "environment",
      content: runtimeContext
    }),
    createPromptSection({
      id: "personality",
      authority: "preference",
      source: "user-settings",
      title: "personality",
      content: personalityContext
    }),
    createPromptSection({
      id: "memory",
      authority: "data",
      source: "memory",
      title: "long-term memory",
      content: memoryContext
    }),
    createPromptSection({
      id: "pinned",
      authority: "data",
      source: "conversation",
      title: "pinned messages",
      content: pinnedContext
    })
  ].filter((section) =>
    section.content
  );

  const system =
    renderPromptSections(
      promptSections
    );

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
          id: "capability",
          label: "工具能力",
          tokens:
            estimateTextTokens(
              capabilityContext
            )
        },
        {
          id: "runtime",
          label: "运行环境",
          tokens:
            estimateTextTokens(
              runtimeContext
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
    promptSections:
      structuredClone(
        promptSections
      ),
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

      runtime: {
        enabled:
          Boolean(runtimeContext),
        timezone:
          Intl.DateTimeFormat()
            .resolvedOptions()
            .timeZone || "UTC",
        toolProfile:
          resolveToolProfileId(
            normalizedSettings.tools
          )
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
