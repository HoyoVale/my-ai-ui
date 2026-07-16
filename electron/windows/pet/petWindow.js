import {
  createBaseWindow
} from "../../core/createWindow.js";

import {
  getRendererUrl
} from "../../shared/rendererRoutes.js";

import {
  getSettings,
  updateSettings
} from "../../settings/settingsStore.js";

const PET_BASE_WIDTH = 300;
const PET_BASE_HEIGHT = 420;

let petWindow = null;

function getPetSize(
  settings
) {
  const scale =
    settings.pet.scale;

  return {
    width:
      Math.round(
        PET_BASE_WIDTH *
        scale
      ),

    height:
      Math.round(
        PET_BASE_HEIGHT *
        scale
      )
  };
}

function safelySetOpacity(
  window,
  opacity
) {
  try {
    window.setOpacity(
      opacity
    );
  } catch (error) {
    console.warn(
      "当前系统不支持窗口透明度设置：",
      error
    );
  }
}

function resizeLockedWindow(
  window,
  width,
  height
) {
  const bounds =
    window.getBounds();

  window.setMinimumSize(
    1,
    1
  );

  window.setMaximumSize(
    10000,
    10000
  );

  window.setBounds(
    {
      x: bounds.x,
      y: bounds.y,
      width,
      height
    },
    false
  );

  window.setMinimumSize(
    width,
    height
  );

  window.setMaximumSize(
    width,
    height
  );
}

export function createPetWindow() {
  if (
    petWindow &&
    !petWindow.isDestroyed()
  ) {
    petWindow.show();
    petWindow.focus();

    return petWindow;
  }

  const settings =
    getSettings();

  const size =
    getPetSize(
      settings
    );

  const rememberedPosition =
    settings.general
      .rememberPetPosition
      ? settings.pet.position
      : null;

  petWindow =
    createBaseWindow({
      ...(rememberedPosition
        ? {
            x:
              rememberedPosition.x,

            y:
              rememberedPosition.y
          }
        : {}),

      width: size.width,
      height: size.height,

      minWidth: size.width,
      maxWidth: size.width,

      minHeight: size.height,
      maxHeight: size.height,

      transparent: true,

      backgroundColor:
        "#00000000",

      frame: false,
      hasShadow: false,

      resizable: false,
      minimizable: true,
      maximizable: false,
      fullscreenable: false,

      skipTaskbar:
        !settings
          .pet
          .showInTaskbar,

      alwaysOnTop:
        settings
          .pet
          .alwaysOnTop
    });

  if (!rememberedPosition) {
    petWindow.center();
  }

  safelySetOpacity(
    petWindow,
    settings.pet.opacity
  );

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

export function applyPetWindowSettings(
  settings
) {
  if (
    !petWindow ||
    petWindow.isDestroyed()
  ) {
    return;
  }

  const size =
    getPetSize(
      settings
    );

  const bounds =
    petWindow.getBounds();

  if (
    bounds.width !== size.width ||
    bounds.height !== size.height
  ) {
    resizeLockedWindow(
      petWindow,
      size.width,
      size.height
    );
  }

  petWindow.setAlwaysOnTop(
    settings
      .pet
      .alwaysOnTop
  );

  petWindow.setSkipTaskbar(
    !settings
      .pet
      .showInTaskbar
  );

  safelySetOpacity(
    petWindow,
    settings.pet.opacity
  );
}

export function savePetWindowPosition() {
  if (
    !petWindow ||
    petWindow.isDestroyed()
  ) {
    return;
  }

  const settings =
    getSettings();

  if (
    !settings
      .general
      .rememberPetPosition
  ) {
    return;
  }

  const bounds =
    petWindow.getBounds();

  try {
    updateSettings({
      pet: {
        position: {
          x: bounds.x,
          y: bounds.y
        }
      }
    });
  } catch (error) {
    console.warn(
      "保存桌宠位置失败：",
      error
    );
  }
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
