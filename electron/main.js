import {
  app,
  BrowserWindow
} from "electron";

import {
  registerIpcHandlers
} from "./ipc/registerIpcHandlers.js";

import {
  createPetWindow
} from "./windows/pet/petWindow.js";

/*
 * IPC 只注册一次。
 * 注册动作本身不依赖窗口已经创建。
 */
registerIpcHandlers();

app.whenReady().then(() => {
  createPetWindow();

  app.on("activate", () => {
    if (
      BrowserWindow
        .getAllWindows()
        .length === 0
    ) {
      createPetWindow();
    }
  });
});

app.on(
  "window-all-closed",
  () => {
    if (
      process.platform !== "darwin"
    ) {
      app.quit();
    }
  }
);
