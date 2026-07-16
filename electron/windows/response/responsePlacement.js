import {
  screen
} from "electron";

import {
  getPetWindow
} from "../pet/petWindow.js";

const SCREEN_MARGIN = 12;

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
  height,
  settings
) {
  const pet = getPetWindow();

  if (
    !pet ||
    pet.isDestroyed()
  ) {
    return {
      x: SCREEN_MARGIN,
      y: SCREEN_MARGIN,
      side: "right"
    };
  }

  const response =
    settings.response;

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
    response.gap;

  const leftX =
    petBounds.x -
    width -
    response.gap;

  const rightHasSpace =
    rightX + width <=
    workAreaRight -
    SCREEN_MARGIN;

  const leftHasSpace =
    leftX >=
    workAreaX +
    SCREEN_MARGIN;

  let side =
    response.preferredSide;

  if (side === "auto") {
    side =
      rightHasSpace ||
      !leftHasSpace
        ? "right"
        : "left";
  }

  let x =
    side === "right"
      ? rightX
      : leftX;

  let y =
    petBounds.y +
    Math.round(
      petBounds.height *
      response.anchorRatio
    );

  const minX =
    workAreaX +
    SCREEN_MARGIN;

  const minY =
    workAreaY +
    SCREEN_MARGIN;

  const maxX =
    workAreaRight -
    width -
    SCREEN_MARGIN;

  const maxY =
    workAreaBottom -
    height -
    SCREEN_MARGIN;

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
