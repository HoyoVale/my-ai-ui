import {
  bindSettingsToConversationWorkspace
} from "../workspace/workspaceRegistry.js";

import {
  resolveToolMode
} from "../tools/toolCatalog.js";

function clone(value) {
  return structuredClone(value);
}

function normalizeMode(value) {
  return value === "coding" ? "coding" : "chat";
}

export function createExecutionConversation(
  conversation,
  overrides = {}
) {
  const source = conversation && typeof conversation === "object"
    ? clone(conversation)
    : { messages: [] };

  return {
    ...source,
    ...clone(overrides),
    mode: normalizeMode(
      overrides.mode === undefined
        ? source.mode
        : overrides.mode
    ),
    workspaceId:
      overrides.workspaceId === undefined
        ? source.workspaceId ?? null
        : overrides.workspaceId,
    workspaceSnapshot:
      overrides.workspaceSnapshot === undefined
        ? source.workspaceSnapshot ?? null
        : overrides.workspaceSnapshot,
    modelSelection:
      overrides.modelSelection === undefined
        ? source.modelSelection ?? null
        : overrides.modelSelection,
    modelSnapshot:
      overrides.modelSnapshot === undefined
        ? source.modelSnapshot ?? null
        : overrides.modelSnapshot,
    skillId:
      overrides.skillId === undefined
        ? source.skillId ?? null
        : overrides.skillId,
    skillSnapshot:
      overrides.skillSnapshot === undefined
        ? source.skillSnapshot ?? null
        : overrides.skillSnapshot,
    skillIds:
      overrides.skillIds === undefined
        ? source.skillIds ?? (source.skillId ? [source.skillId] : [])
        : overrides.skillIds,
    skillSnapshots:
      overrides.skillSnapshots === undefined
        ? source.skillSnapshots ?? (source.skillSnapshot ? [source.skillSnapshot] : [])
        : overrides.skillSnapshots,
    skillRoutingMode:
      overrides.skillRoutingMode === undefined
        ? source.skillRoutingMode === "auto" ? "auto" : "manual"
        : overrides.skillRoutingMode === "auto" ? "auto" : "manual",
    skillSource:
      overrides.skillSource === undefined
        ? ["manual", "command", "router", "none"].includes(source.skillSource)
          ? source.skillSource
          : "manual"
        : ["manual", "command", "router", "none"].includes(overrides.skillSource)
          ? overrides.skillSource
          : "manual",
    skillRouter:
      overrides.skillRouter === undefined
        ? source.skillRouter ?? null
        : overrides.skillRouter ?? null
  };
}

export function resolveConversationExecutionContext({
  settings,
  conversation,
  overrides = {}
} = {}) {
  const executionConversation = createExecutionConversation(
    conversation,
    overrides
  );
  const binding = bindSettingsToConversationWorkspace(
    settings,
    executionConversation
  );
  const expectedMode = normalizeMode(executionConversation.mode);
  const resolvedMode = resolveToolMode(binding.settings.tools ?? {});

  if (resolvedMode !== expectedMode) {
    const error = new Error(
      `会话模式与 Tool Runtime 模式不一致：conversation=${expectedMode}, tools=${resolvedMode}`
    );
    error.code = "CONVERSATION_TOOL_MODE_MISMATCH";
    error.details = {
      conversationId: executionConversation.id ?? null,
      conversationMode: expectedMode,
      toolMode: resolvedMode
    };
    throw error;
  }

  return {
    conversation: executionConversation,
    settings: binding.settings,
    workspace: binding.workspace,
    metadata: {
      conversationId: executionConversation.id ?? null,
      conversationTitle: executionConversation.title ?? "当前会话",
      mode: resolvedMode,
      workspaceId: executionConversation.workspaceId ?? null,
      workspaceName: binding.workspace?.name ?? null,
      workspaceAvailable: Boolean(binding.workspace && !binding.workspace.missing),
      modelSelection: executionConversation.modelSelection ?? null
    }
  };
}

export function getRecoveryExecutionOverrides(message = {}) {
  const checkpoint =
    message.activity?.checkpoint &&
    typeof message.activity.checkpoint === "object"
      ? message.activity.checkpoint
      : null;

  if (!checkpoint) {
    return {};
  }

  return {
    mode: checkpoint.mode,
    workspaceId: checkpoint.workspaceId,
    workspaceSnapshot: checkpoint.workspaceSnapshot,
    modelSelection: checkpoint.modelSelection,
    modelSnapshot: checkpoint.modelSnapshot,
    skillId: checkpoint.skillId,
    skillSnapshot: checkpoint.skillSnapshot,
    skillIds: checkpoint.skillIds,
    skillSnapshots: checkpoint.skillSnapshots,
    skillRoutingMode: checkpoint.skillRoutingMode,
    skillSource: checkpoint.skillSource,
    skillRouter: checkpoint.skillRouter
  };
}
