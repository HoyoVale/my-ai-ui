import {
  ipcMain
} from "electron";

import IPC_CHANNELS
  from "../../shared/ipcChannels.cjs";

import {
  memoryManager
} from "../../memory/index.js";

import {
  openMemoryWindow
} from "../../windows/memory/memoryWindow.js";

export function registerMemoryIpc() {
  ipcMain.on(
    IPC_CHANNELS
      .navigation
      .OPEN_MEMORY,
    () => {
      openMemoryWindow();
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .memory
      .GET_STATE,
    () => {
      return memoryManager
        .getState();
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .memory
      .GET,
    (_event, id) => {
      return memoryManager.get(
        String(id ?? "")
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .memory
      .LIST,
    (_event, filters) => {
      return memoryManager.list(
        filters &&
        typeof filters ===
          "object"
          ? filters
          : {}
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .memory
      .CREATE,
    (_event, input) => {
      return memoryManager.create(
        input &&
        typeof input ===
          "object"
          ? input
          : {}
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .memory
      .UPDATE,
    (_event, id, patch) => {
      return memoryManager.update(
        String(id ?? ""),
        patch &&
        typeof patch ===
          "object"
          ? patch
          : {}
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .memory
      .DELETE,
    (_event, id) => {
      return memoryManager.delete(
        String(id ?? "")
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .memory
      .CLEAR,
    () => {
      return memoryManager
        .clearAll();
    }
  );
}
