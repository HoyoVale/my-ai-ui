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

let memoryWindow = null;

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
    !memoryWindow ||
    memoryWindow.isDestroyed() ||
    memoryWindow
      .webContents
      .isDestroyed()
  ) {
    return;
  }

  memoryWindow.webContents.send(
    IPC_CHANNELS
      .window
      .STATE_CHANGED,
    Boolean(isMaximized)
  );
}

export function openMemoryWindow() {
  if (
    memoryWindow &&
    !memoryWindow.isDestroyed()
  ) {
    memoryWindow.show();
    memoryWindow.focus();

    return memoryWindow;
  }

  const settings =
    getSettings();

  memoryWindow =
    createBaseWindow({
      width: 1040,
      height: 720,
      minWidth: 760,
      minHeight: 520,
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

  memoryWindow.on(
    "maximize",
    () => {
      emitWindowState(true);
    }
  );

  memoryWindow.on(
    "unmaximize",
    () => {
      emitWindowState(false);
    }
  );

  memoryWindow.once(
    "ready-to-show",
    () => {
      if (
        !memoryWindow ||
        memoryWindow.isDestroyed()
      ) {
        return;
      }

      memoryWindow.show();
      memoryWindow.focus();
    }
  );

  memoryWindow.on(
    "closed",
    () => {
      memoryWindow = null;
    }
  );

  memoryWindow.loadURL(
    getRendererUrl(
      "/memory"
    )
  );

  return memoryWindow;
}

export function applyMemoryWindowSettings(
  settings
) {
  if (
    !memoryWindow ||
    memoryWindow.isDestroyed()
  ) {
    return;
  }

  memoryWindow.setBackgroundColor(
    getBackgroundColor(
      settings
    )
  );
}

export function getMemoryWindow() {
  return memoryWindow;
}
