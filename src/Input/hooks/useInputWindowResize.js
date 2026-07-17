import {
  useLayoutEffect
} from "react";

const MIN_WINDOW_HEIGHT = 48;
const WINDOW_VERTICAL_SPACE = 16;
const TEXTAREA_VERTICAL_PADDING = 12;

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

    const minTextareaHeight =
      lineHeight +
      TEXTAREA_VERTICAL_PADDING;

    const maxTextareaHeight =
      settings.maxLines *
        lineHeight +
      TEXTAREA_VERTICAL_PADDING;

    /*
     * 空输入框不要使用 scrollHeight。
     * textarea 的 placeholder 也会参与 scrollHeight 计算，
     * “正在生成回复……”这类长占位文字可能被误判为多行。
     */
    let contentHeight =
      minTextareaHeight;

    if (value.length > 0) {
      textarea.style.height =
        "0px";

      contentHeight =
        Math.min(
          Math.max(
            textarea.scrollHeight,
            minTextareaHeight
          ),
          maxTextareaHeight
        );
    }

    textarea.style.height =
      `${contentHeight}px`;

    textarea.style.overflowY =
      value.length > 0 &&
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
