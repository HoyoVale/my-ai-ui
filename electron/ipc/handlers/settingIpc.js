import {
  ipcMain
} from "electron";

import IPC_CHANNELS
  from "../../shared/ipcChannels.cjs";

import {
  openSettingWindow
} from "../../windows/setting/settingWindow.js";

export function registerSettingIpc() {
  ipcMain.on(
    IPC_CHANNELS
      .navigation
      .OPEN_SETTING,
    () => {
      openSettingWindow();
    }
  );
}
