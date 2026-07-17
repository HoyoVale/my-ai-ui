import {
  useLayoutEffect
} from "react";

import {
  calculateInputHeights
} from "../utils/inputLayout.js";

export function useInputWindowResize({
  value,
  textareaRef,
  settings
}) {
  const fontSize =
    settings?.fontSize;

  const maxLines =
    settings?.maxLines;

  useLayoutEffect(() => {
    const textarea =
      textareaRef.current;

    if (
      !textarea ||
      !Number.isFinite(
        fontSize
      ) ||
      !Number.isFinite(
        maxLines
      )
    ) {
      return;
    }

    textarea.style.height =
      "0px";

    const layout =
      calculateInputHeights({
        value,

        measuredScrollHeight:
          textarea.scrollHeight,

        fontSize,
        maxLines
      });

    textarea.style.height =
      `${layout.contentHeight}px`;

    textarea.style.overflowY =
      layout.overflow;

    window.api
      ?.resizeInputWindow?.(
        layout.windowHeight
      );
  }, [
    value,
    textareaRef,
    fontSize,
    maxLines
  ]);
}
