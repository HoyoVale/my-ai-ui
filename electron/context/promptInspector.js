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
    : conversationManager.getCurrentConversation();
  const execution = resolveConversationExecutionContext({
    settings,
    conversation
  });
  const memories = memoryManager.retrieve({
    query: latestUserQuery(execution.conversation),
    trackUsage: false
  });
  const manifest = getToolManifestSnapshot({
    settings: execution.settings,
    executionContext: execution.metadata
  });
  const context = assembleAgentContext({
    settings: execution.settings,
    conversation: execution.conversation,
    memories,
    toolManifest: manifest.tools
  });

  return {
    schemaVersion: 1,
    generatedAt: Date.now(),
    conversationId: conversation?.id ?? null,
    conversationTitle: execution.conversation?.title ?? "当前会话",
    mode: execution.metadata.mode,
    workspaceId: execution.metadata.workspaceId,
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
