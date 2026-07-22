import {
  ipcMain
} from "electron";

import IPC_CHANNELS
  from "../../shared/ipcChannels.cjs";

import {
  broadcastSettings,
  applySettingsToOpenWindows
} from "../../settings/settingsRuntime.js";

import {
  isSettingSender
} from "../../windows/setting/settingWindow.js";

import {
  isInputSender
} from "../../windows/input/inputWindow.js";

import {
  listWorkspaces,
  registerWorkspace,
  removeWorkspace
} from "../../workspace/workspaceRegistry.js";

import {
  conversationManager
} from "../../conversation/index.js";

function commitSettings(settings) {
  applySettingsToOpenWindows(settings);
  broadcastSettings(settings);
  return settings;
}

export function registerWorkspaceIpc() {
  ipcMain.handle(
    IPC_CHANNELS.workspace.LIST,
    () => listWorkspaces()
  );

  ipcMain.handle(
    IPC_CHANNELS.workspace.REGISTER,
    (event, input = {}) => {
      if (
        !isSettingSender(event.sender) &&
        !isInputSender(event.sender)
      ) {
        throw new Error(
          "Only the Setting or Input window can register workspaces."
        );
      }

      const result = registerWorkspace(
        input.rootPath
      );

      if (result.ok && result.settings) {
        commitSettings(result.settings);
        conversationManager.reconcileSettings();
      }

      return {
        ...result,
        settings: undefined
      };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.workspace.REMOVE,
    (event, workspaceId) => {
      if (!isSettingSender(event.sender)) {
        throw new Error(
          "Only the Setting window can remove workspaces."
        );
      }

      const result = removeWorkspace(
        workspaceId
      );

      if (result.ok && result.settings) {
        commitSettings(result.settings);
        conversationManager.reconcileSettings();
      }

      return {
        ...result,
        settings: undefined
      };
    }
  );
}
