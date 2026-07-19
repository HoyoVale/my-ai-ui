import {
  app,
  BrowserWindow
} from "electron";

import path from "node:path";

import IPC_CHANNELS
  from "../shared/ipcChannels.cjs";

import {
  getSettings
} from "../settings/settingsStore.js";

import {
  ConversationManager
} from "./ConversationManager.js";

import {
  ConversationStore
} from "./ConversationStore.js";

import {
  createWorkspaceSnapshot,
  getWorkspaceById
} from "../workspace/workspaceRegistry.js";

function broadcastState(
  state
) {
  for (
    const window
    of BrowserWindow
      .getAllWindows()
  ) {
    if (
      window.isDestroyed() ||
      window
        .webContents
        .isDestroyed()
    ) {
      continue;
    }

    window
      .webContents
      .send(
        IPC_CHANNELS
          .conversation
          .CHANGED,

        state
      );
  }
}

const store =
  new ConversationStore({
    getFilePath: () =>
      path.join(
        app.getPath(
          "userData"
        ),
        "conversations.json"
      )
  });

export const conversationManager =
  new ConversationManager({
    store,
    getSettings,
    getWorkspaceById,
    createWorkspaceSnapshot,
    onChange:
      broadcastState
  });

export function getConversationPath() {
  return store.getPath();
}
