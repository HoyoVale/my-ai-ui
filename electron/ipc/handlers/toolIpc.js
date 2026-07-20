import {
  ipcMain
} from "electron";

import IPC_CHANNELS from "../../shared/ipcChannels.cjs";

import {
  getSettings
} from "../../settings/settingsStore.js";

import {
  conversationManager
} from "../../conversation/index.js";

import {
  resolveConversationExecutionContext
} from "../../conversation/executionContext.js";

import {
  sanitizeSettings
} from "../../settings/validateSettings.js";

import {
  getToolManifestSnapshot
} from "../../tools/manifest/ToolManifestService.js";

import {
  inspectEffectivePrompt
} from "../../context/promptInspector.js";

import {
  isSettingSender
} from "../../windows/setting/settingWindow.js";

function assertSettingSender(event) {
  if (!isSettingSender(event.sender)) {
    throw new Error("Only the Setting window can inspect tool and prompt metadata.");
  }
}

function previewSettings(request = {}) {
  const current = getSettings();
  const preview = request?.settingsPreview;
  if (!preview || typeof preview !== "object") {
    return current;
  }

  const allowed = {};
  for (const key of [
    "tools",
    "mcp",
    "customTools",
    "prompts",
    "personality",
    "context",
    "conversation",
    "memory",
    "model",
    "workspaces"
  ]) {
    if (preview[key] && typeof preview[key] === "object") {
      allowed[key] = {
        ...(current[key] ?? {}),
        ...preview[key]
      };
    }
  }

  return sanitizeSettings({
    ...current,
    ...allowed
  });
}

export function registerToolIpc() {
  ipcMain.handle(
    IPC_CHANNELS.tools.GET_MANIFEST,
    (event, request = {}) => {
      assertSettingSender(event);
      const execution = resolveConversationExecutionContext({
        settings: previewSettings(request),
        conversation: conversationManager.getCurrentConversation()
      });
      return getToolManifestSnapshot({
        settings: execution.settings,
        executionContext: execution.metadata
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.developer.INSPECT_PROMPT,
    (event, request = {}) => {
      assertSettingSender(event);
      return inspectEffectivePrompt({
        conversationId: String(request?.conversationId ?? ""),
        settingsOverride: previewSettings(request)
      });
    }
  );
}
