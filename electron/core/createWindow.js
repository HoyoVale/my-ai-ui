import {
  BrowserWindow
} from "electron";

import path from "node:path";

import {
  fileURLToPath
} from "node:url";

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);

const preloadPath = path.resolve(
  __dirname,
  "../preload/preload.cjs"
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

  return new BrowserWindow({
    frame: false,
    show: true,

    ...windowOptions,

    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,

      ...webPreferences
    }
  });
}
