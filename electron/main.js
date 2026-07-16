import {
  app,
  BrowserWindow,
  nativeTheme
} from "electron";

import {
  registerIpcHandlers
} from "./ipc/registerIpcHandlers.js";

import {
  getSettings
} from "./settings/settingsStore.js";

import {
  applySettingsToOpenWindows,
  broadcastSettings
} from "./settings/settingsRuntime.js";

import {
  createPetWindow
} from "./windows/pet/petWindow.js";

registerIpcHandlers();

app.whenReady().then(() => {
  const settings =
    getSettings();

  createPetWindow();

  applySettingsToOpenWindows(
    settings
  );

  nativeTheme.on(
    "updated",
    () => {
      const current =
        getSettings();

      applySettingsToOpenWindows(
        current
      );

      broadcastSettings(
        current
      );
    }
  );

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
