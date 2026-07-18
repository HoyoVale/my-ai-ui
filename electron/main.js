import {
  app,
  BrowserWindow,
  nativeTheme,
  session
} from "electron";

import path from "node:path";

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

const e2eUserData =
  process.env
    .XIXI_E2E_USER_DATA;

if (e2eUserData) {
  app.setPath(
    "userData",
    path.resolve(
      e2eUserData
    )
  );
}

registerIpcHandlers();

app.whenReady().then(() => {

  session.defaultSession.webRequest.onErrorOccurred(
    (details) => {
      console.error(
        "[NET ERROR]",
        details.error,
        details.resourceType,
        details.url
      );
    }
  );

  const settings = getSettings();

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
