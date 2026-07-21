import {
  app,
  BrowserWindow
} from "electron";

import IPC_CHANNELS
  from "../shared/ipcChannels.cjs";

import {
  applyConversationWindowSettings
} from "../windows/conversation/conversationWindow.js";

import {
  applyInputWindowSettings
} from "../windows/input/inputWindow.js";

import {
  applyMemoryWindowSettings
} from "../windows/memory/memoryWindow.js";

import {
  applyPetWindowSettings
} from "../windows/pet/petWindow.js";

import {
  applyResponseWindowSettings
} from "../windows/response/index.js";

import {
  applySettingWindowSettings
} from "../windows/setting/settingWindow.js";

import {
  configureRuntimeCircuitBreakers
} from "../runtime/runtimeCircuitBreakers.js";

import {
  mcpClientManager
} from "../mcp/index.js";

import {
  applyTraySettings
} from "../windows/tray/trayManager.js";


export function applyGeneralSettings(
  settings
) {
  if (!app.isPackaged) {
    return;
  }

  try {
    app.setLoginItemSettings({
      openAtLogin:
        Boolean(
          settings
            .general
            .launchAtLogin
        )
    });
  } catch (error) {
    console.warn(
      "设置开机启动失败：",
      error
    );
  }
}

export function applySettingsToOpenWindows(
  settings
) {
  configureRuntimeCircuitBreakers(settings);
  void mcpClientManager.applySettings(settings);

  applyGeneralSettings(
    settings
  );

  applyPetWindowSettings(
    settings
  );

  applyTraySettings(settings);

  applyConversationWindowSettings(
    settings
  );

  applyInputWindowSettings(
    settings
  );

  applyMemoryWindowSettings(
    settings
  );

  applyResponseWindowSettings(
    settings
  );

  applySettingWindowSettings(
    settings
  );
}

export function broadcastSettings(
  settings
) {
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

    window
      .webContents
      .send(
        IPC_CHANNELS
          .settings
          .CHANGED,

        settings
      );
  }
}
