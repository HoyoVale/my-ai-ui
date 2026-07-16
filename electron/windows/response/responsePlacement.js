import {
  screen
} from "electron";

import {
  getPetWindow
} from "../pet/petWindow.js";

import {
  RESPONSE_PET_GAP,
  RESPONSE_SCREEN_MARGIN
} from "./responseConstants.js";

function clampToAvailableRange(
  value,
  min,
  max
) {
  if (max < min) {
    return min;
  }

  return Math.min(
    Math.max(value, min),
    max
  );
}

export function calculateResponsePlacement(
  width,
  height
) {
  const pet = getPetWindow();

  if (
    !pet ||
    pet.isDestroyed()
  ) {
    return {
      x:
        RESPONSE_SCREEN_MARGIN,

      y:
        RESPONSE_SCREEN_MARGIN,

      side:
        "right"
    };
  }

  const petBounds =
    pet.getBounds();

  const display =
    screen.getDisplayMatching(
      petBounds
    );

  const {
    x: workAreaX,
    y: workAreaY,
    width: workAreaWidth,
    height: workAreaHeight
  } = display.workArea;

  const workAreaRight =
    workAreaX +
    workAreaWidth;

  const workAreaBottom =
    workAreaY +
    workAreaHeight;

  const rightX =
    petBounds.x +
    petBounds.width +
    RESPONSE_PET_GAP;

  const leftX =
    petBounds.x -
    width -
    RESPONSE_PET_GAP;

  const rightHasSpace =
    rightX + width <=
    workAreaRight -
    RESPONSE_SCREEN_MARGIN;

  const leftHasSpace =
    leftX >=
    workAreaX +
    RESPONSE_SCREEN_MARGIN;

  const side =
    rightHasSpace ||
    !leftHasSpace
      ? "right"
      : "left";

  let x =
    side === "right"
      ? rightX
      : leftX;

  let y =
    petBounds.y +
    Math.round(
      petBounds.height *
      0.16
    );

  const minX =
    workAreaX +
    RESPONSE_SCREEN_MARGIN;

  const minY =
    workAreaY +
    RESPONSE_SCREEN_MARGIN;

  const maxX =
    workAreaRight -
    width -
    RESPONSE_SCREEN_MARGIN;

  const maxY =
    workAreaBottom -
    height -
    RESPONSE_SCREEN_MARGIN;

  x = clampToAvailableRange(
    x,
    minX,
    maxX
  );

  y = clampToAvailableRange(
    y,
    minY,
    maxY
  );

  return {
    x,
    y,
    side
  };
}
