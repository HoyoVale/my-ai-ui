import IPC_CHANNELS
  from "../../shared/ipcChannels.cjs";

import {
  createBaseWindow
} from "../../core/createWindow.js";

import {
  getRendererUrl
} from "../../shared/rendererRoutes.js";

let settingWindow = null;

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

  settingWindow =
    createBaseWindow({
      width: 1200,
      height: 800,

      minWidth: 500,
      minHeight: 600,

      show: false,

      transparent: false,

      backgroundColor:
        "#ffffff",

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

export function getSettingWindow() {
  return settingWindow;
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
