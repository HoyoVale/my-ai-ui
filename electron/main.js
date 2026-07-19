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
  conversationManager
} from "./conversation/index.js";

import {
  flushAllPersistenceQueues
} from "./persistence/AsyncPersistenceQueue.js";

import {
  createPetWindow
} from "./windows/pet/petWindow.js";

import {
  installRendererSessionSecurity
} from "./security/rendererSecurity.js";

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
  conversationManager
    .recoverInterruptedRuns();

  installRendererSessionSecurity(
    session.defaultSession
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

let persistenceFlushInProgress = false;

app.on(
  "before-quit",
  (event) => {
    if (persistenceFlushInProgress) {
      return;
    }

    event.preventDefault();
    persistenceFlushInProgress = true;

    void flushAllPersistenceQueues()
      .finally(() => {
        app.quit();
      });
  }
);
