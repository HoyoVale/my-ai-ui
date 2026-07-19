import {
  useLayoutEffect
} from "react";

import {
  calculateInputHeights
} from "../utils/inputLayout.js";

export function useInputWindowResize({
  value,
  barRef,
  textareaRef,
  settings,
  menuOpen = false,
  menuHeight = 0
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

    const textLayout =
      calculateInputHeights({
        value,
        measuredScrollHeight:
          textarea.scrollHeight,
        fontSize,
        maxLines
      });

    textarea.style.height =
      `${textLayout.contentHeight}px`;

    textarea.style.overflowY =
      textLayout.overflow;

    const measuredBaseHeight =
      barRef.current
        ? Math.ceil(
            barRef.current
              .getBoundingClientRect()
              .height
          )
        : 0;

    const layout =
      calculateInputHeights({
        value,
        measuredScrollHeight:
          textarea.scrollHeight,
        measuredBaseHeight,
        fontSize,
        maxLines,
        menuOpen,
        menuHeight
      });

    window.api
      ?.resizeInputWindow?.({
        height:
          layout.windowHeight,
        baseHeight:
          layout.baseWindowHeight,
        menuExtraHeight:
          layout.menuExtraHeight
      });
  }, [
    value,
    barRef,
    textareaRef,
    fontSize,
    maxLines,
    menuOpen,
    menuHeight
  ]);
}
