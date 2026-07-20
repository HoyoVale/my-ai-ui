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
  getToolManifestSnapshot
} from "../tools/manifest/ToolManifestService.js";

import {
  assembleAgentContext
} from "./ContextAssembler.js";

import {
  estimateTextTokens
} from "./tokenEstimator.js";

function latestUserQuery(conversation) {
  return conversation?.messages?.findLast?.((message) =>
    message.role === "user" && message.status === "complete"
  )?.content ?? conversation?.title ?? "";
}

export function inspectEffectivePrompt({
  conversationId = "",
  settingsOverride = null
} = {}) {
  const settings = settingsOverride ?? getSettings();
  if (settings.general?.developerMode !== true) {
    const error = new Error("Prompt inspection requires developer mode.");
    error.code = "DEVELOPER_MODE_REQUIRED";
    throw error;
  }

  const conversation = conversationId
    ? conversationManager.getConversation(conversationId)
    : null;
  const memories = conversation
    ? memoryManager.retrieve({
        query: latestUserQuery(conversation),
        trackUsage: false
      })
    : [];
  const manifest = getToolManifestSnapshot({ settings });
  const context = assembleAgentContext({
    settings,
    conversation: conversation ?? { messages: [] },
    memories,
    toolManifest: manifest.tools
  });

  return {
    schemaVersion: 1,
    generatedAt: Date.now(),
    conversationId: conversation?.id ?? null,
    conversationTitle: conversation?.title ?? "当前设置预览",
    manifestRevision: manifest.revision,
    effectivePrompt: context.system,
    promptTokens: estimateTextTokens(context.system),
    sections: context.promptSections.map((section, index) => ({
      ...section,
      index,
      tokens: estimateTextTokens(section.content)
    })),
    budget: context.budget,
    metadata: context.metadata
  };
}
