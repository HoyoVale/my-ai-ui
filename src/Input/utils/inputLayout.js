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
