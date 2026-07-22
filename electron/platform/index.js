import {
  app,
  BrowserWindow
} from "electron";

import path from "node:path";

import IPC_CHANNELS
  from "../shared/ipcChannels.cjs";

import {
  PlatformKernel
} from "./PlatformKernel.js";

function broadcastPlatformState(state) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (
      window.isDestroyed() ||
      window.webContents.isDestroyed()
    ) {
      continue;
    }
    window.webContents.send(
      IPC_CHANNELS.platform.CHANGED,
      state
    );
  }
}

export const platformKernel = new PlatformKernel({
  getStorageDirectory: () => path.join(
    app.getPath("userData"),
    "platform"
  ),
  onChange: broadcastPlatformState
});

export const completionAuthority = platformKernel.completionAuthority;
