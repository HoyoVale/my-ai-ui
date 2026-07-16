import {
  createBaseWindow
} from "../../core/createWindow.js";

import {
  getRendererUrl
} from "../../shared/rendererRoutes.js";

import {
  getPetWindow
} from "../pet/petWindow.js";

const GAP = 4;
const EXTRA_WIDTH = 40;

export const INPUT_MIN_HEIGHT =
  48;

export const INPUT_MAX_HEIGHT =
  152;

let inputWindow = null;
let attachedPet = null;

let fixedInputWidth = null;

let logicalInputHeight =
  INPUT_MIN_HEIGHT;

let petMoveHandler = null;
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

function getAnchorBounds() {
  const pet = getPetWindow();

  if (
    !pet ||
    pet.isDestroyed()
  ) {
    return null;
  }

  const petBounds =
    pet.getBounds();

  return {
    x: Math.round(
      petBounds.x -
      EXTRA_WIDTH / 2
    ),

    y: Math.round(
      petBounds.y +
      petBounds.height +
      GAP
    ),

    width: Math.round(
      petBounds.width +
      EXTRA_WIDTH
    )
  };
}

function applyInputBounds() {
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
    getAnchorBounds();

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

    if (petClosedHandler) {
      attachedPet.removeListener(
        "closed",
        petClosedHandler
      );
    }
  }

  attachedPet = null;
  petMoveHandler = null;
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

  const anchor =
    getAnchorBounds();

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
    INPUT_MIN_HEIGHT;

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
        INPUT_MIN_HEIGHT,

      maxHeight:
        INPUT_MAX_HEIGHT,

      show: false,

      transparent: true,

      backgroundColor:
        "#00000000",

      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,

      skipTaskbar: true
    });

  inputWindow.setMinimumSize(
    fixedInputWidth,
    INPUT_MIN_HEIGHT
  );

  inputWindow.setMaximumSize(
    fixedInputWidth,
    INPUT_MAX_HEIGHT
  );

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

  petClosedHandler = () => {
    closeInputWindow();
  };

  pet.on(
    "move",
    petMoveHandler
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

  logicalInputHeight =
    Math.round(
      clamp(
        numericHeight,
        INPUT_MIN_HEIGHT,
        INPUT_MAX_HEIGHT
      )
    );

  applyInputBounds();
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
