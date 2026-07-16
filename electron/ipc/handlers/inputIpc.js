import {
  ipcMain
} from "electron";

import IPC_CHANNELS
  from "../../shared/ipcChannels.cjs";

import {
  isInputSender,
  openInputWindow,
  resizeInputWindow
} from "../../windows/input/inputWindow.js";

export function registerInputIpc() {
  ipcMain.on(
    IPC_CHANNELS
      .navigation
      .OPEN_INPUT,
    () => {
      openInputWindow();
    }
  );

  ipcMain.on(
    IPC_CHANNELS
      .input
      .RESIZE_WINDOW,
    (event, height) => {
      if (
        !isInputSender(
          event.sender
        )
      ) {
        return;
      }

      resizeInputWindow(
        height
      );
    }
  );
}
