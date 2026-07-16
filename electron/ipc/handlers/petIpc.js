import {
  ipcMain
} from "electron";

import IPC_CHANNELS
  from "../../shared/ipcChannels.cjs";

import {
  getPetWindow
} from "../../windows/pet/petWindow.js";

let dragState = null;

function isPetSender(
  webContents
) {
  const pet = getPetWindow();

  return Boolean(
    pet &&
    !pet.isDestroyed() &&
    pet.webContents ===
      webContents
  );
}

function normalizePoint(point) {
  const x = Number(point?.x);
  const y = Number(point?.y);

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return null;
  }

  return {
    x,
    y
  };
}

export function registerPetIpc() {
  ipcMain.on(
    IPC_CHANNELS.pet.DRAG_START,
    (event, point) => {
      if (
        !isPetSender(
          event.sender
        )
      ) {
        return;
      }

      const pet = getPetWindow();
      const mouse =
        normalizePoint(point);

      if (
        !pet ||
        pet.isDestroyed() ||
        !mouse
      ) {
        return;
      }

      const bounds =
        pet.getBounds();

      /*
       * 记录拖动开始时的固定基准。
       * 后续不根据上一帧位置累加，
       * 避免透明窗口坐标漂移。
       */
      dragState = {
        webContentsId:
          event.sender.id,

        startMouseX:
          mouse.x,

        startMouseY:
          mouse.y,

        startWindowX:
          bounds.x,

        startWindowY:
          bounds.y,

        width:
          bounds.width,

        height:
          bounds.height
      };
    }
  );

  ipcMain.on(
    IPC_CHANNELS.pet.DRAG_MOVE,
    (event, point) => {
      if (
        !dragState ||
        dragState.webContentsId !==
          event.sender.id ||
        !isPetSender(
          event.sender
        )
      ) {
        return;
      }

      const pet = getPetWindow();
      const mouse =
        normalizePoint(point);

      if (
        !pet ||
        pet.isDestroyed() ||
        !mouse
      ) {
        dragState = null;
        return;
      }

      const x = Math.round(
        dragState.startWindowX +
        mouse.x -
        dragState.startMouseX
      );

      const y = Math.round(
        dragState.startWindowY +
        mouse.y -
        dragState.startMouseY
      );

      pet.setBounds(
        {
          x,
          y,
          width:
            dragState.width,

          height:
            dragState.height
        },
        false
      );
    }
  );

  ipcMain.on(
    IPC_CHANNELS.pet.DRAG_END,
    (event) => {
      if (
        dragState
          ?.webContentsId ===
        event.sender.id
      ) {
        dragState = null;
      }
    }
  );
}
