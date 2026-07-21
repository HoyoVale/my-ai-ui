import {
  useLayoutEffect,
  useState
} from "react";

import {
  calculateInputHeights,
  INPUT_CONTEXT_MENU_MAX_HEIGHT,
  resolveInputOverlayDirection
} from "../utils/inputLayout.js";

export function useInputWindowResize({
  value,
  barRef,
  textareaRef,
  settings,
  menuOpen = false,
  menuHeight = 0
}) {
  const [menuDirection, setMenuDirection] = useState("down");
  const fontSize = settings?.fontSize;
  const maxLines = settings?.maxLines;

  useLayoutEffect(() => {
    const textarea = textareaRef.current;

    if (
      !textarea ||
      !Number.isFinite(fontSize) ||
      !Number.isFinite(maxLines)
    ) {
      return;
    }

    textarea.style.height = "0px";

    const textLayout = calculateInputHeights({
      value,
      measuredScrollHeight: textarea.scrollHeight,
      fontSize,
      maxLines
    });

    textarea.style.height = `${textLayout.contentHeight}px`;
    textarea.style.overflowY = textLayout.overflow;

    const measuredBaseHeight = barRef.current
      ? Math.ceil(barRef.current.getBoundingClientRect().height)
      : 0;

    const layout = calculateInputHeights({
      value,
      measuredScrollHeight: textarea.scrollHeight,
      measuredBaseHeight,
      fontSize,
      maxLines,
      menuOpen,
      menuHeight
    });

    const barWindowTop = window.screenY + (
      menuDirection === "up"
        ? Math.max(0, window.innerHeight - layout.baseWindowHeight)
        : 0
    );

    const nextDirection = menuOpen
      ? resolveInputOverlayDirection({
          windowTop: barWindowTop,
          baseHeight: layout.baseWindowHeight,
          overlayHeight: menuHeight || INPUT_CONTEXT_MENU_MAX_HEIGHT,
          screenTop: window.screen?.availTop ?? 0,
          screenHeight: window.screen?.availHeight ?? 0,
          preferred: menuDirection
        })
      : "down";

    if (nextDirection !== menuDirection) {
      setMenuDirection(nextDirection);
    }

    window.api?.resizeInputWindow?.({
      height: layout.windowHeight,
      baseHeight: layout.baseWindowHeight,
      menuExtraHeight: layout.menuExtraHeight,
      menuDirection: nextDirection,
      overlayOpen: menuOpen
    });
  }, [
    value,
    barRef,
    textareaRef,
    fontSize,
    maxLines,
    menuOpen,
    menuHeight,
    menuDirection
  ]);

  return menuDirection;
}
