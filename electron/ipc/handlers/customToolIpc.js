import {
  ipcMain
} from "electron";

import IPC_CHANNELS from "../../shared/ipcChannels.cjs";

import {
  declarativeHttpToolManager
} from "../../custom-tools/DeclarativeHttpToolManager.js";

import {
  clearCustomHttpSecret,
  getCustomHttpSecretStatus,
  setCustomHttpSecret
} from "../../custom-tools/customHttpCredentialStore.js";

import {
  getSettings
} from "../../settings/settingsStore.js";

import {
  sanitizeSettings
} from "../../settings/validateSettings.js";

import {
  isSettingSender
} from "../../windows/setting/settingWindow.js";

function assertSettingSender(event) {
  if (!isSettingSender(event.sender)) {
    throw new Error("Only the Setting window can manage custom tools.");
  }
}

export function registerCustomToolIpc() {
  ipcMain.handle(
    IPC_CHANNELS.customTools.GET_STATE,
    (event) => {
      assertSettingSender(event);
      const settings = getSettings();
      const snapshot = declarativeHttpToolManager.snapshot(settings);
      return {
        ...snapshot,
        tools: snapshot.tools.map((tool) => ({
          ...tool,
          credential: getCustomHttpSecretStatus(tool.id)
        }))
      };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.customTools.GET_SECRET_STATUS,
    (event, toolId) => {
      assertSettingSender(event);
      return getCustomHttpSecretStatus(toolId);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.customTools.SET_SECRET,
    (event, request = {}) => {
      assertSettingSender(event);
      return setCustomHttpSecret(request.toolId, request.value);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.customTools.CLEAR_SECRET,
    (event, toolId) => {
      assertSettingSender(event);
      return clearCustomHttpSecret(toolId);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.customTools.TEST,
    async (event, request = {}) => {
      assertSettingSender(event);
      const current = getSettings();
      const preview = request.config && typeof request.config === "object"
        ? sanitizeSettings({
            ...current,
            customTools: {
              ...current.customTools,
              tools: [request.config]
            }
          }).customTools.tools[0]
        : null;
      const input = request.input && typeof request.input === "object"
        ? request.input
        : {};
      return preview
        ? declarativeHttpToolManager.testConfig(preview, input)
        : declarativeHttpToolManager.testTool(
            current,
            request.toolId,
            input
          );
    }
  );
}
