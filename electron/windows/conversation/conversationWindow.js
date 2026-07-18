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

let conversationWindow = null;

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
    !conversationWindow ||
    conversationWindow
      .isDestroyed() ||
    conversationWindow
      .webContents
      .isDestroyed()
  ) {
    return;
  }

  conversationWindow
    .webContents
    .send(
      IPC_CHANNELS
        .window
        .STATE_CHANGED,

      Boolean(isMaximized)
    );
}

export function openConversationWindow() {
  if (
    conversationWindow &&
    !conversationWindow.isDestroyed()
  ) {
    conversationWindow.show();
    conversationWindow.focus();

    return conversationWindow;
  }

  const settings =
    getSettings();

  conversationWindow =
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
      fullscreenable: true,

      alwaysOnTop: false
    });

  conversationWindow.on(
    "maximize",
    () => {
      emitWindowState(true);
    }
  );

  conversationWindow.on(
    "unmaximize",
    () => {
      emitWindowState(false);
    }
  );

  conversationWindow.once(
    "ready-to-show",
    () => {
      if (
        !conversationWindow ||
        conversationWindow
          .isDestroyed()
      ) {
        return;
      }

      conversationWindow.show();
      conversationWindow.focus();
    }
  );

  conversationWindow.on(
    "closed",
    () => {
      conversationWindow = null;
    }
  );

  conversationWindow.loadURL(
    getRendererUrl(
      "/conversation"
    )
  );

  return conversationWindow;
}

export function applyConversationWindowSettings(
  settings
) {
  if (
    !conversationWindow ||
    conversationWindow.isDestroyed()
  ) {
    return;
  }

  conversationWindow
    .setBackgroundColor(
      getBackgroundColor(
        settings
      )
    );

}

export function isConversationSender(webContents) {
  return Boolean(
    conversationWindow &&
    !conversationWindow.isDestroyed() &&
    conversationWindow.webContents === webContents
  );
}

export function getConversationWindow() {
  return conversationWindow;
}
