import {
  ipcMain
} from "electron";

import IPC_CHANNELS from "../../shared/ipcChannels.cjs";

import {
  getSettings
} from "../../settings/settingsStore.js";

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
    "prompts",
    "personality",
    "context",
    "conversation",
    "memory"
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
      return getToolManifestSnapshot({
        settings: previewSettings(request)
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
