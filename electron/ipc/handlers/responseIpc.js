import {
  ipcMain
} from "electron";

import IPC_CHANNELS
  from "../../shared/ipcChannels.cjs";

import {
  dismissResponseWindow,
  isResponseSender,
  resizeResponseWindow
} from "../../windows/response/index.js";

import {
  runResponseDemo
} from "../../dev/runResponseDemo.js";

export function registerResponseIpc() {
  /*
   * 当前 Pet 菜单中的 openResponse 用于
   * 测试流式气泡。
   *
   * 接入真实模型后，可把这里替换为模型服务，
   * 或增加单独的测试频道。
   */
  ipcMain.on(
    IPC_CHANNELS
      .navigation
      .OPEN_RESPONSE,
    () => {
      runResponseDemo();
    }
  );

  ipcMain.on(
    IPC_CHANNELS
      .response
      .DISMISS_WINDOW,
    (event) => {
      if (
        !isResponseSender(
          event.sender
        )
      ) {
        return;
      }

      dismissResponseWindow();
    }
  );

  ipcMain.on(
    IPC_CHANNELS
      .response
      .RESIZE_WINDOW,
    (event, size) => {
      if (
        !isResponseSender(
          event.sender
        )
      ) {
        return;
      }

      resizeResponseWindow(
        size
      );
    }
  );
}
