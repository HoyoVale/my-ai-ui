import {
  app,
  BrowserWindow,
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
  applySettingsToOpenWindows
} from "./settings/settingsRuntime.js";

import {
  conversationManager,
  getConversationPath
} from "./conversation/index.js";

import {
  flushAllPersistenceQueues
} from "./persistence/AsyncPersistenceQueue.js";

import {
  mcpClientManager
} from "./mcp/index.js";

import {
  RuntimeRecoveryManager
} from "./tools/runtime-state/RuntimeRecoveryManager.js";

import {
  platformKernel,
  worktreeRuntime
} from "./platform/index.js";

import {
  createPetWindow
} from "./windows/pet/petWindow.js";

import {
  applyTraySettings,
  destroyTray,
  hasActiveTray
} from "./windows/tray/trayManager.js";

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

app.whenReady().then(async () => {
  try {
    const platformRecovery = platformKernel.recoverInterruptedRuns();
    const worktreeRecovery = worktreeRuntime.recover();
    if (
      platformRecovery.recoveredRunIds.length > 0 ||
      platformRecovery.expiredLeaseIds.length > 0
    ) {
      console.info(
        "Platform Kernel recovered interrupted work:",
        platformRecovery
      );
    }
    if (worktreeRecovery.recoveredWorktreeIds.length > 0) {
      console.info(
        "Worktree Runtime recovered isolated work:",
        worktreeRecovery
      );
    }
  } catch (error) {
    console.warn(
      "Platform Kernel startup recovery failed:",
      error
    );
  }

  let runtimeRecoveryReport = { decisions: [] };
  try {
    const runtimeRecoveryManager = new RuntimeRecoveryManager({
      rootDirectory: path.join(
        path.dirname(getConversationPath()),
        "tool-results"
      )
    });
    runtimeRecoveryReport = await runtimeRecoveryManager.recoverAll();
    if (!runtimeRecoveryReport.ok) {
      console.warn(
        "部分 Tool Runtime 启动恢复失败：",
        runtimeRecoveryReport.errors
      );
    }
  } catch (error) {
    console.warn(
      "Tool Runtime 启动恢复失败：",
      error
    );
  }

  conversationManager.recoverInterruptedRuns({
    runtimeRecoveries: runtimeRecoveryReport.decisions
  });

  installRendererSessionSecurity(
    session.defaultSession
  );

  const settings = getSettings();

  createPetWindow();

  applySettingsToOpenWindows(
    settings
  );

  app.on("activate", () => {
    if (
      BrowserWindow
        .getAllWindows()
        .length === 0
    ) {
      createPetWindow();
      applyTraySettings(
        getSettings()
      );
    }
  });
});

app.on(
  "window-all-closed",
  () => {
    if (
      process.platform !== "darwin" &&
      !hasActiveTray()
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
    destroyTray();

    void Promise.all([
      flushAllPersistenceQueues(),
      mcpClientManager.closeAll()
    ])
      .then(([result]) => {
        if (!result.ok) {
          console.warn(
            `应用退出前仍有 ${result.pendingCount} 个持久化队列未写入。`
          );
        }
      })
      .finally(() => {
        app.quit();
      });
  }
);
