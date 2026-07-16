import IPC_CHANNELS
  from "../../shared/ipcChannels.cjs";

import {
  createBaseWindow
} from "../../core/createWindow.js";

import {
  getRendererUrl
} from "../../shared/rendererRoutes.js";

import {
  getSettings
} from "../../settings/settingsStore.js";

import {
  resolveMainTheme
} from "../../settings/theme.js";

let settingWindow = null;

function getBackgroundColor(
  settings
) {
  return resolveMainTheme(
    settings
  ) === "dark"
    ? "#212121"
    : "#ffffff";
}

function emitWindowState(
  isMaximized
) {
  if (
    !settingWindow ||
    settingWindow.isDestroyed() ||
    settingWindow
      .webContents
      .isDestroyed()
  ) {
    return;
  }

  settingWindow
    .webContents
    .send(
      IPC_CHANNELS
        .window
        .STATE_CHANGED,

      Boolean(
        isMaximized
      )
    );
}

export function openSettingWindow() {
  if (
    settingWindow &&
    !settingWindow.isDestroyed()
  ) {
    settingWindow.show();
    settingWindow.focus();

    return settingWindow;
  }

  const settings =
    getSettings();

  settingWindow =
    createBaseWindow({
      width: 1120,
      height: 760,

      minWidth: 760,
      minHeight: 560,

      show: false,

      transparent: false,

      backgroundColor:
        getBackgroundColor(
          settings
        ),

      resizable: true,
      minimizable: true,
      maximizable: true,
      fullscreenable: true
    });

  settingWindow.on(
    "maximize",
    () => {
      emitWindowState(true);
    }
  );

  settingWindow.on(
    "unmaximize",
    () => {
      emitWindowState(false);
    }
  );

  settingWindow.once(
    "ready-to-show",
    () => {
      if (
        !settingWindow ||
        settingWindow.isDestroyed()
      ) {
        return;
      }

      settingWindow.show();
      settingWindow.focus();
    }
  );

  settingWindow.on(
    "closed",
    () => {
      settingWindow = null;
    }
  );

  settingWindow.loadURL(
    getRendererUrl("/setting")
  );

  return settingWindow;
}

export function applySettingWindowSettings(
  settings
) {
  if (
    !settingWindow ||
    settingWindow.isDestroyed()
  ) {
    return;
  }

  settingWindow.setBackgroundColor(
    getBackgroundColor(
      settings
    )
  );
}

export function getSettingWindow() {
  return settingWindow;
}

export function isSettingSender(
  webContents
) {
  return Boolean(
    settingWindow &&
    !settingWindow.isDestroyed() &&
    settingWindow.webContents ===
      webContents
  );
}

export function closeSettingWindow() {
  if (
    !settingWindow ||
    settingWindow.isDestroyed()
  ) {
    return;
  }

  settingWindow.close();
}
