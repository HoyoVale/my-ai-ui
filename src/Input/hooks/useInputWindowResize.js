import { useLayoutEffect } from "react";

const MIN_WINDOW_HEIGHT = 48;
const MAX_TEXTAREA_HEIGHT = 120;
const WINDOW_VERTICAL_SPACE = 16;

export function useInputWindowResize({
  value,
  textareaRef
}) {
  useLayoutEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";

    const contentHeight = Math.min(
      textarea.scrollHeight,
      MAX_TEXTAREA_HEIGHT
    );

    textarea.style.height =
      `${contentHeight}px`;

    textarea.style.overflowY =
      textarea.scrollHeight >
      MAX_TEXTAREA_HEIGHT
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

    window.api?.resizeInputWindow?.(
      requestedWindowHeight
    );
  }, [value, textareaRef]);
}
