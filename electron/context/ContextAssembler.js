import {
  buildPinnedConversationContext,
  selectPinnedContextMessages,
  selectShortTermContextMessages
} from "../conversation/contextBuilder.js";

import {
  buildMemoryContext
} from "../memory/memoryContextBuilder.js";

import {
  PRODUCT_BASE_SYSTEM_CONTEXT,
  RUNTIME_KERNEL_CONTEXT,
  resolveModeContext
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
  resolveToolMode,
  resolveToolProfileId
} from "../tools/toolCatalog.js";


export function assembleAgentContext({
  settings,
  conversation,
  memories = [],
  toolManifest = [],
  skillRuntime = null
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

  const toolMode = resolveToolMode(
    normalizedSettings.tools
  );
  const promptSettings = normalizedSettings.prompts ?? {};
  const modeContext = resolveModeContext(
    promptSettings,
    toolMode
  );
  const developerInstructions = String(
    promptSettings.developerInstructions ?? ""
  ).trim();
  const skillContext = String(
    skillRuntime?.promptSection ?? ""
  ).trim();

  const promptSections = [
    createPromptSection({
      id: "runtime-kernel",
      authority: "policy",
      source: "app",
      title: "runtime kernel",
      content: RUNTIME_KERNEL_CONTEXT,
      locked: true
    }),
    createPromptSection({
      id: "product-base",
      authority: "policy",
      source: "app",
      title: "product behavior",
      content: PRODUCT_BASE_SYSTEM_CONTEXT,
      locked: true
    }),
    createPromptSection({
      id: `mode-${toolMode}`,
      authority: "policy",
      source: promptSettings.modeOverrides?.[toolMode]
        ? "developer-settings"
        : "app",
      title: `${toolMode} mode`,
      content: modeContext,
      editable: true
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
      id: "developer-instructions",
      authority: "developer",
      source: "developer-settings",
      title: "custom behavior",
      content: developerInstructions,
      editable: true
    }),
    createPromptSection({
      id: "skill",
      authority: "skill",
      source: skillRuntime?.skill?.id ? `skill.${skillRuntime.skill.id}` : "skill",
      title: skillRuntime?.skill?.name ?? "active skill",
      content: skillContext
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
          id: "runtime-kernel",
          label: "Runtime Kernel",
          tokens: estimateTextTokens(RUNTIME_KERNEL_CONTEXT)
        },
        {
          id: "product-base",
          label: "基础提示词",
          tokens: estimateTextTokens(PRODUCT_BASE_SYSTEM_CONTEXT)
        },
        {
          id: "mode",
          label: `${toolMode} 模式`,
          tokens: estimateTextTokens(modeContext)
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
          id: "developer",
          label: "开发者附加指令",
          tokens: estimateTextTokens(developerInstructions)
        },
        {
          id: "skill",
          label: skillRuntime?.skill?.name ? `Skill · ${skillRuntime.skill.name}` : "Skill",
          tokens: estimateTextTokens(skillContext)
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
          ),
        toolMode
      },
      prompt: {
        mode: toolMode,
        modeCustomized: Boolean(
          promptSettings.modeOverrides?.[toolMode]
        ),
        developerInstructionsEnabled: Boolean(developerInstructions),
        skillEnabled: Boolean(skillContext),
        sectionCount: promptSections.length
      },
      skill: skillRuntime?.active
        ? {
            id: skillRuntime.skill.id,
            name: skillRuntime.skill.name,
            version: skillRuntime.skill.version,
            requiredCapabilities: [...skillRuntime.skill.requiredCapabilities],
            optionalCapabilities: [...skillRuntime.skill.optionalCapabilities]
          }
        : null,

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
