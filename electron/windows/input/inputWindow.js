import {
  createBaseWindow
} from "../../core/createWindow.js";

import {
  getRendererUrl
} from "../../shared/rendererRoutes.js";

import {
  getSettings
} from "../../settings/settingsStore.js";

import {
  getPetWindow
} from "../pet/petWindow.js";

const INPUT_MIN_HEIGHT = 48;
const INPUT_VERTICAL_SPACE = 16;
const INPUT_TEXTAREA_VERTICAL_PADDING = 12;

let inputWindow = null;
let attachedPet = null;

let fixedInputWidth = null;
let logicalInputHeight =
  INPUT_MIN_HEIGHT;

let petMoveHandler = null;
let petResizeHandler = null;
let petClosedHandler = null;

function clamp(
  value,
  min,
  max
) {
  return Math.min(
    Math.max(value, min),
    max
  );
}

function getInputMetrics(
  settings = getSettings()
) {
  const input =
    settings.input;

  const lineHeight =
    Math.round(
      input.fontSize *
      1.45
    );

  return {
    gap:
      input.gap,

    extraWidth:
      input.extraWidth,

    minHeight:
      INPUT_MIN_HEIGHT,

    maxHeight:
      Math.max(
        INPUT_MIN_HEIGHT,
        input.maxLines *
          lineHeight +
          INPUT_TEXTAREA_VERTICAL_PADDING +
          INPUT_VERTICAL_SPACE
      ),

    alwaysOnTop:
      input.alwaysOnTop
  };
}

function getAnchorBounds(
  settings = getSettings()
) {
  const pet = getPetWindow();

  if (
    !pet ||
    pet.isDestroyed()
  ) {
    return null;
  }

  const metrics =
    getInputMetrics(
      settings
    );

  const petBounds =
    pet.getBounds();

  return {
    x: Math.round(
      petBounds.x -
      metrics.extraWidth / 2
    ),

    y: Math.round(
      petBounds.y +
      petBounds.height +
      metrics.gap
    ),

    width: Math.round(
      petBounds.width +
      metrics.extraWidth
    )
  };
}

function applyInputBounds(
  settings = getSettings()
) {
  if (
    !inputWindow ||
    inputWindow.isDestroyed() ||
    !Number.isFinite(
      fixedInputWidth
    )
  ) {
    return;
  }

  const anchor =
    getAnchorBounds(
      settings
    );

  if (!anchor) {
    return;
  }

  inputWindow.setBounds(
    {
      x: anchor.x,
      y: anchor.y,

      width:
        fixedInputWidth,

      height:
        logicalInputHeight
    },
    false
  );
}

function updateSizeConstraints(
  settings
) {
  if (
    !inputWindow ||
    inputWindow.isDestroyed()
  ) {
    return;
  }

  const metrics =
    getInputMetrics(
      settings
    );

  const anchor =
    getAnchorBounds(
      settings
    );

  if (!anchor) {
    return;
  }

  fixedInputWidth =
    anchor.width;

  logicalInputHeight =
    Math.round(
      clamp(
        logicalInputHeight,
        metrics.minHeight,
        metrics.maxHeight
      )
    );

  inputWindow.setMinimumSize(
    1,
    1
  );

  inputWindow.setMaximumSize(
    10000,
    10000
  );

  inputWindow.setMinimumSize(
    fixedInputWidth,
    metrics.minHeight
  );

  inputWindow.setMaximumSize(
    fixedInputWidth,
    metrics.maxHeight
  );
}

function detachPetListeners() {
  if (
    attachedPet &&
    !attachedPet.isDestroyed()
  ) {
    if (petMoveHandler) {
      attachedPet.removeListener(
        "move",
        petMoveHandler
      );
    }

    if (petResizeHandler) {
      attachedPet.removeListener(
        "resize",
        petResizeHandler
      );
    }

    if (petClosedHandler) {
      attachedPet.removeListener(
        "closed",
        petClosedHandler
      );
    }
  }

  attachedPet = null;
  petMoveHandler = null;
  petResizeHandler = null;
  petClosedHandler = null;
}

export function openInputWindow() {
  if (
    inputWindow &&
    !inputWindow.isDestroyed()
  ) {
    inputWindow.show();
    inputWindow.focus();

    return inputWindow;
  }

  const pet = getPetWindow();
  const settings =
    getSettings();

  const metrics =
    getInputMetrics(
      settings
    );

  const anchor =
    getAnchorBounds(
      settings
    );

  if (
    !pet ||
    pet.isDestroyed() ||
    !anchor
  ) {
    return null;
  }

  fixedInputWidth =
    anchor.width;

  logicalInputHeight =
    metrics.minHeight;

  inputWindow =
    createBaseWindow({
      x: anchor.x,
      y: anchor.y,

      width:
        fixedInputWidth,

      height:
        logicalInputHeight,

      minWidth:
        fixedInputWidth,

      maxWidth:
        fixedInputWidth,

      minHeight:
        metrics.minHeight,

      maxHeight:
        metrics.maxHeight,

      show: false,

      transparent: true,

      backgroundColor:
        "#00000000",

      /*
       * 关闭原生矩形阴影，避免大圆角时在透明四角露出灰层。
       */
      hasShadow: false,

      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,

      skipTaskbar: true,

      alwaysOnTop:
        metrics.alwaysOnTop
    });

  inputWindow.loadURL(
    getRendererUrl("/input")
  );

  inputWindow.once(
    "ready-to-show",
    () => {
      if (
        !inputWindow ||
        inputWindow.isDestroyed()
      ) {
        return;
      }

      inputWindow.show();
      inputWindow.focus();
    }
  );

  attachedPet = pet;

  petMoveHandler = () => {
    applyInputBounds();
  };

  petResizeHandler = () => {
    applyInputWindowSettings(
      getSettings()
    );
  };

  petClosedHandler = () => {
    closeInputWindow();
  };

  pet.on(
    "move",
    petMoveHandler
  );

  pet.on(
    "resize",
    petResizeHandler
  );

  pet.on(
    "closed",
    petClosedHandler
  );

  inputWindow.on(
    "closed",
    () => {
      detachPetListeners();

      inputWindow = null;
      fixedInputWidth = null;

      logicalInputHeight =
        INPUT_MIN_HEIGHT;
    }
  );

  return inputWindow;
}

export function applyInputWindowSettings(
  settings
) {
  if (
    !inputWindow ||
    inputWindow.isDestroyed()
  ) {
    return;
  }

  const metrics =
    getInputMetrics(
      settings
    );

  updateSizeConstraints(
    settings
  );

  inputWindow.setAlwaysOnTop(
    metrics.alwaysOnTop
  );

  applyInputBounds(
    settings
  );
}

export function resizeInputWindow(
  requestedHeight
) {
  if (
    !inputWindow ||
    inputWindow.isDestroyed() ||
    !Number.isFinite(
      fixedInputWidth
    )
  ) {
    return;
  }

  const numericHeight =
    Number(requestedHeight);

  if (
    !Number.isFinite(
      numericHeight
    )
  ) {
    return;
  }

  const settings =
    getSettings();

  const metrics =
    getInputMetrics(
      settings
    );

  logicalInputHeight =
    Math.round(
      clamp(
        numericHeight,
        metrics.minHeight,
        metrics.maxHeight
      )
    );

  applyInputBounds(
    settings
  );
}

export function isInputSender(
  webContents
) {
  return Boolean(
    inputWindow &&
    !inputWindow.isDestroyed() &&
    inputWindow.webContents ===
      webContents
  );
}

export function closeInputWindow() {
  if (
    !inputWindow ||
    inputWindow.isDestroyed()
  ) {
    return;
  }

  inputWindow.close();
}
