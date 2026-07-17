export const INPUT_MIN_WINDOW_HEIGHT =
  48;

export const INPUT_WINDOW_VERTICAL_SPACE =
  16;

export const INPUT_TEXTAREA_VERTICAL_PADDING =
  12;

export function calculateInputHeights({
  value,
  measuredScrollHeight,
  fontSize,
  maxLines
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

  return {
    lineHeight,
    minTextareaHeight,
    maxTextareaHeight,
    contentHeight,

    windowHeight:
      Math.max(
        INPUT_MIN_WINDOW_HEIGHT,
        Math.ceil(
          contentHeight +
          INPUT_WINDOW_VERTICAL_SPACE
        )
      ),

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
