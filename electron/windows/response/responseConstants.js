export const RESPONSE_MIN_WIDTH =
  72;

export const RESPONSE_MIN_HEIGHT =
  60;

export const RESPONSE_WINDOW_HORIZONTAL_CHROME =
  20;

export const RESPONSE_WINDOW_VERTICAL_CHROME =
  44;

export function getResponseMetrics(
  settings
) {
  return {
    minWidth:
      RESPONSE_MIN_WIDTH,

    minHeight:
      RESPONSE_MIN_HEIGHT,

    maxWidth:
      settings
        .response
        .bubbleMaxWidth +
      RESPONSE_WINDOW_HORIZONTAL_CHROME,

    maxHeight:
      settings
        .response
        .contentMaxHeight +
      RESPONSE_WINDOW_VERTICAL_CHROME
  };
}
