import {
  app,
  ipcMain
} from "electron";

import IPC_CHANNELS
  from "../../shared/ipcChannels.cjs";

import {
  conversationManager,
  getConversationPath
} from "../../conversation/index.js";

import {
  getMemoryPath,
  memoryManager
} from "../../memory/index.js";

import {
  getSettings,
  getSettingsPath,
  resetSettings,
  updateSettings
} from "../../settings/settingsStore.js";

import {
  applySettingsToOpenWindows,
  broadcastSettings
} from "../../settings/settingsRuntime.js";

import {
  isSettingSender
} from "../../windows/setting/settingWindow.js";

function canModifySettings(
  event
) {
  return isSettingSender(
    event.sender
  );
}

function commitSettings(
  settings
) {
  applySettingsToOpenWindows(
    settings
  );

  broadcastSettings(
    settings
  );

  return settings;
}

export function registerSettingsIpc() {
  ipcMain.handle(
    IPC_CHANNELS
      .settings
      .GET,
    () => {
      return getSettings();
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .settings
      .UPDATE,
    (event, patch) => {
      if (
        !canModifySettings(event)
      ) {
        throw new Error(
          "Only the Setting window can update settings."
        );
      }

      const normalizedPatch =
        patch?.general
          ?.rememberPetPosition ===
        false
          ? {
              ...patch,

              pet: {
                ...patch?.pet,
                position: null
              }
            }
          : patch;

      const settings =
        updateSettings(
          normalizedPatch
        );

      if (
        normalizedPatch
          ?.conversation
      ) {
        conversationManager
          .reconcileSettings();
      }

      if (
        normalizedPatch
          ?.memory
      ) {
        memoryManager
          .reconcileSettings();
      }

      return commitSettings(
        settings
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .settings
      .RESET,
    (event) => {
      if (
        !canModifySettings(event)
      ) {
        throw new Error(
          "Only the Setting window can reset settings."
        );
      }

      const settings =
        resetSettings();

      conversationManager
        .reconcileSettings();

      memoryManager
        .reconcileSettings();

      return commitSettings(
        settings
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .settings
      .GET_APP_INFO,
    () => {
      return {
        name:
          app.getName(),

        version:
          app.getVersion(),

        isPackaged:
          app.isPackaged,

        platform:
          process.platform,

        arch:
          process.arch,

        electron:
          process.versions.electron,

        chrome:
          process.versions.chrome,

        node:
          process.versions.node,

        settingsPath:
          getSettingsPath(),

        conversationsPath:
          getConversationPath(),

        memoriesPath:
          getMemoryPath()
      };
    }
  );
}
