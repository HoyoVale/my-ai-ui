import {
  BrowserWindow,
  ipcMain
} from "electron";

import IPC_CHANNELS
  from "../../shared/ipcChannels.cjs";

import {
  updateService
} from "../../update/index.js";

let unsubscribe = null;

function broadcast(state) {
  for (
    const window
    of BrowserWindow.getAllWindows()
  ) {
    if (
      window.isDestroyed() ||
      window.webContents.isDestroyed()
    ) {
      continue;
    }

    try {
      window.webContents.send(
        IPC_CHANNELS.update.CHANGED,
        state
      );
    } catch {
      // A renderer may close between the checks and send().
    }
  }
}

export function registerUpdateIpc() {
  ipcMain.handle(
    IPC_CHANNELS.update.GET_STATE,
    () => updateService.getState()
  );

  ipcMain.handle(
    IPC_CHANNELS.update.CHECK,
    () => updateService.checkForUpdates({
      manual: true
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.update.DOWNLOAD,
    () => updateService.downloadUpdate()
  );

  ipcMain.handle(
    IPC_CHANNELS.update.INSTALL,
    () => updateService.installUpdate()
  );

  unsubscribe?.();
  unsubscribe =
    updateService.subscribe(
      broadcast
    );
}
