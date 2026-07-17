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
  MemoryManager
} from "./MemoryManager.js";

import {
  MemoryStore
} from "./MemoryStore.js";

function broadcastState(state) {
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

    window.webContents.send(
      IPC_CHANNELS
        .memory
        .CHANGED,
      state
    );
  }
}

const store =
  new MemoryStore({
    getFilePath: () =>
      path.join(
        app.getPath(
          "userData"
        ),
        "memories.json"
      )
  });

export const memoryManager =
  new MemoryManager({
    store,
    getSettings,
    onChange:
      broadcastState
  });

export function getMemoryPath() {
  return store.getPath();
}
