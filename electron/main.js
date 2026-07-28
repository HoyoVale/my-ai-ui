import {
  app,
  BrowserWindow,
  session
} from "electron";

import path from "node:path";

import {
  APP_ID,
  PRODUCT_NAME
} from "../src/shared/releaseIdentity.js";

import {
  updateService
} from "./update/index.js";

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
  agentRuntime
} from "./agent/AgentRuntime.js";

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

app.setName(PRODUCT_NAME);

if (process.platform === "win32") {
  app.setAppUserModelId(APP_ID);
}

const hasSingleInstanceLock =
  app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  registerIpcHandlers();
}

app.on("second-instance", () => {
  if (!app.isReady()) {
    return;
  }

  const pet = createPetWindow();
  pet?.show();
  pet?.focus();
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) {
    return;
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

  await updateService.initialize({
    schedule:
      !process.env.XIXI_E2E_USER_DATA
  });

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
    if (!hasSingleInstanceLock) {
      return;
    }

    if (persistenceFlushInProgress) {
      return;
    }

    event.preventDefault();
    persistenceFlushInProgress = true;
    destroyTray();

    void (async () => {
      try {
        await agentRuntime.shutdown({
          reason: "app-quit",
          timeoutMs: 8000
        });

        const [result] = await Promise.all([
          flushAllPersistenceQueues({
            maxAttempts: 3,
            retryDelayMs: 50,
            attemptTimeoutMs: 2000
          }),
          mcpClientManager.closeAll(),
          updateService.shutdown()
        ]);
        if (!result.ok) {
          const timeoutDetail = result.timedOutCount
            ? `，其中 ${result.timedOutCount} 次等待达到超时边界`
            : "";
          console.warn(
            `应用退出前仍有 ${result.pendingCount} 个持久化队列未写入${timeoutDetail}。`
          );
        }
      } catch (error) {
        console.warn("应用退出清理失败：", error);
      } finally {
        app.quit();
      }
    })();
  }
);
