export const INPUT_MIN_WINDOW_HEIGHT =
  52;

export const INPUT_WINDOW_VERTICAL_SPACE =
  20;

export const INPUT_TEXTAREA_VERTICAL_PADDING =
  12;

export const INPUT_CONTEXT_MENU_GAP =
  10;

export const INPUT_CONTEXT_MENU_MAX_HEIGHT =
  320;

export function resolveInputOverlayDirection({
  windowTop = 0,
  baseHeight = INPUT_MIN_WINDOW_HEIGHT,
  overlayHeight = INPUT_CONTEXT_MENU_MAX_HEIGHT,
  screenTop = 0,
  screenHeight = 0,
  preferred = "down"
} = {}) {
  const normalizedScreenHeight = Math.max(0, Number(screenHeight) || 0);
  if (!normalizedScreenHeight) {
    return preferred === "up" ? "up" : "down";
  }

  const top = Number(windowTop) || 0;
  const availableTop = Number(screenTop) || 0;
  const availableBottom = availableTop + normalizedScreenHeight;
  const barHeight = Math.max(INPUT_MIN_WINDOW_HEIGHT, Number(baseHeight) || 0);
  const panelHeight = Math.min(
    INPUT_CONTEXT_MENU_MAX_HEIGHT,
    Math.max(0, Number(overlayHeight) || INPUT_CONTEXT_MENU_MAX_HEIGHT)
  ) + INPUT_CONTEXT_MENU_GAP;

  const roomAbove = Math.max(0, top - availableTop);
  const roomBelow = Math.max(0, availableBottom - (top + barHeight));

  if (roomBelow >= panelHeight) return "down";
  if (roomAbove >= panelHeight) return "up";
  return roomAbove > roomBelow ? "up" : "down";
}

export function calculateInputHeights({
  value,
  measuredScrollHeight,
  measuredBaseHeight = 0,
  fontSize,
  maxLines,
  menuOpen = false,
  menuHeight = 0
}) {
  const lineHeight =
    Math.round(
      Number(fontSize) *
      1.45
    );

  const minTextareaHeight =
    lineHeight +
    INPUT_TEXTAREA_VERTICAL_PADDING;

  const maxTextareaHeight =
    Math.max(
      1,
      Number(maxLines)
    ) *
      lineHeight +
    INPUT_TEXTAREA_VERTICAL_PADDING;

  const hasValue =
    String(value ?? "")
      .length > 0;

  const contentHeight =
    hasValue
      ? Math.min(
          Math.max(
            Number(
              measuredScrollHeight
            ) ||
              minTextareaHeight,

            minTextareaHeight
          ),

          maxTextareaHeight
        )
      : minTextareaHeight;

  const fallbackBaseHeight =
    Math.ceil(
      contentHeight +
      INPUT_WINDOW_VERTICAL_SPACE
    );

  const baseWindowHeight =
    Math.max(
      INPUT_MIN_WINDOW_HEIGHT,
      Math.ceil(
        Number(measuredBaseHeight) ||
        fallbackBaseHeight
      )
    );

  const measuredMenuHeight =
    Math.min(
      INPUT_CONTEXT_MENU_MAX_HEIGHT,
      Math.max(
        0,
        Number(menuHeight) || 0
      )
    );

  const menuExtraHeight =
    menuOpen && measuredMenuHeight > 0
      ? measuredMenuHeight +
        INPUT_CONTEXT_MENU_GAP
      : 0;

  return {
    lineHeight,
    minTextareaHeight,
    maxTextareaHeight,
    contentHeight,
    baseWindowHeight,
    menuExtraHeight,
    windowHeight:
      baseWindowHeight +
      menuExtraHeight,
    overflow:
      hasValue &&
      Number(
        measuredScrollHeight
      ) >
        maxTextareaHeight
        ? "auto"
        : "hidden"
  };
}
