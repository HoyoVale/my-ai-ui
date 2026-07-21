import {
  app,
  BrowserWindow
} from "electron";

import path from "node:path";

import {
  fileURLToPath
} from "node:url";

import {
  applyWindowSecurity
} from "../security/rendererSecurity.js";

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);

const preloadPath = path.resolve(
  __dirname,
  "../preload/preload.cjs"
);

const appIconPath = path.join(
  app.getAppPath(),
  "public",
  "icon.png"
);

/**
 * 创建所有窗口共用的安全基础配置。
 *
 * webPreferences 单独合并，避免调用方传入
 * webPreferences 后覆盖掉 preload 和安全设置。
 */
export function createBaseWindow(
  options = {}
) {
  const {
    webPreferences = {},
    ...windowOptions
  } = options;

  const window =
    new BrowserWindow({
      frame: false,
      show: true,
      icon: appIconPath,

      ...windowOptions,

      webPreferences: {
        ...webPreferences,

        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent:
          false
      }
    });

  applyWindowSecurity(window);

  return window;
}
