import {
  createBaseWindow
} from "../../core/createWindow.js";

import {
  getRendererUrl
} from "../../shared/rendererRoutes.js";

const PET_WIDTH = 300;
const PET_HEIGHT = 420;

let petWindow = null;

export function createPetWindow() {
  if (
    petWindow &&
    !petWindow.isDestroyed()
  ) {
    petWindow.show();
    petWindow.focus();

    return petWindow;
  }

  petWindow =
    createBaseWindow({
      width: PET_WIDTH,
      height: PET_HEIGHT,

      minWidth: PET_WIDTH,
      maxWidth: PET_WIDTH,

      minHeight: PET_HEIGHT,
      maxHeight: PET_HEIGHT,

      transparent: true,

      backgroundColor:
        "#00000000",

      frame: false,
      hasShadow: false,

      resizable: false,
      minimizable: true,
      maximizable: false,
      fullscreenable: false,

      skipTaskbar: true,
      alwaysOnTop: true
    });

  petWindow.loadURL(
    getRendererUrl("/")
  );

  petWindow.on(
    "closed",
    () => {
      petWindow = null;
    }
  );

  return petWindow;
}

export function getPetWindow() {
  return petWindow;
}

export function isPetWindowSender(
  webContents
) {
  return Boolean(
    petWindow &&
    !petWindow.isDestroyed() &&
    petWindow.webContents ===
      webContents
  );
}
