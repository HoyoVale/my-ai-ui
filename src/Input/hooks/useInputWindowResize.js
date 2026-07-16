import {
  useLayoutEffect
} from "react";

const MIN_WINDOW_HEIGHT = 48;
const WINDOW_VERTICAL_SPACE = 16;

export function useInputWindowResize({
  value,
  textareaRef,
  settings
}) {
  useLayoutEffect(() => {
    const textarea =
      textareaRef.current;

    if (
      !textarea ||
      !settings
    ) {
      return;
    }

    const lineHeight =
      Math.round(
        settings.fontSize *
        1.45
      );

    const maxTextareaHeight =
      settings.maxLines *
      lineHeight;

    textarea.style.height =
      "0px";

    const contentHeight =
      Math.min(
        textarea.scrollHeight,
        maxTextareaHeight
      );

    textarea.style.height =
      `${contentHeight}px`;

    textarea.style.overflowY =
      textarea.scrollHeight >
      maxTextareaHeight
        ? "auto"
        : "hidden";

    const requestedWindowHeight =
      Math.max(
        MIN_WINDOW_HEIGHT,
        Math.ceil(
          contentHeight +
          WINDOW_VERTICAL_SPACE
        )
      );

    window.api
      ?.resizeInputWindow?.(
        requestedWindowHeight
      );
  }, [
    value,
    textareaRef,
    settings?.fontSize,
    settings?.maxLines
  ]);
}
