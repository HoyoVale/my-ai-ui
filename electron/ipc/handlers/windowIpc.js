import {
  BrowserWindow,
  ipcMain
} from "electron";

import IPC_CHANNELS
  from "../../shared/ipcChannels.cjs";

function getSenderWindow(event) {
  return BrowserWindow
    .fromWebContents(
      event.sender
    );
}

export function registerWindowIpc() {
  ipcMain.on(
    IPC_CHANNELS
      .window
      .MINIMIZE,
    (event) => {
      getSenderWindow(event)
        ?.minimize();
    }
  );

  ipcMain.on(
    IPC_CHANNELS
      .window
      .TOGGLE_MAXIMIZE,
    (event) => {
      const window =
        getSenderWindow(event);

      if (!window) {
        return;
      }

      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
    }
  );

  ipcMain.on(
    IPC_CHANNELS
      .window
      .CLOSE,
    (event) => {
      getSenderWindow(event)
        ?.close();
    }
  );

  ipcMain.handle(
    IPC_CHANNELS
      .window
      .IS_MAXIMIZED,
    (event) => {
      return (
        getSenderWindow(event)
          ?.isMaximized() ??
        false
      );
    }
  );

  ipcMain.on(
    IPC_CHANNELS
      .window
      .SET_MOUSE_THROUGH,
    (
      event,
      shouldIgnore
    ) => {
      const window =
        getSenderWindow(event);

      if (!window) {
        return;
      }

      if (shouldIgnore) {
        window.setIgnoreMouseEvents(
          true,
          {
            forward: true
          }
        );
      } else {
        window.setIgnoreMouseEvents(
          false
        );
      }
    }
  );
}
