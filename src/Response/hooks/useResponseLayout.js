import {
  useLayoutEffect,
  useRef
} from "react";

export function useResponseLayout({
  hasContent,
  contentKey,
  streamId,
  shellRef,
  contentRef
}) {
  const lastSizeRef = useRef({
    width: 0,
    height: 0
  });

  const stickToBottomRef =
    useRef(true);

  useLayoutEffect(() => {
    lastSizeRef.current = {
      width: 0,
      height: 0
    };

    stickToBottomRef.current =
      true;
  }, [streamId]);

  useLayoutEffect(() => {
    const shell = shellRef.current;

    if (!shell || !hasContent) {
      return undefined;
    }

    let animationFrame = null;

    const reportSize = () => {
      if (animationFrame !== null) {
        cancelAnimationFrame(
          animationFrame
        );
      }

      animationFrame =
        requestAnimationFrame(() => {
          const rect =
            shell.getBoundingClientRect();

          const width =
            Math.ceil(rect.width);

          const height =
            Math.ceil(rect.height);

          const previous =
            lastSizeRef.current;

          if (
            previous.width === width &&
            previous.height === height
          ) {
            return;
          }

          lastSizeRef.current = {
            width,
            height
          };

          window.api
            ?.resizeResponseWindow?.({
              width,
              height
            });
        });
    };

    const observer =
      new ResizeObserver(
        reportSize
      );

    observer.observe(shell);
    reportSize();

    return () => {
      observer.disconnect();

      if (animationFrame !== null) {
        cancelAnimationFrame(
          animationFrame
        );
      }
    };
  }, [
    hasContent,
    shellRef
  ]);

  useLayoutEffect(() => {
    const content =
      contentRef.current;

    if (
      !content ||
      !stickToBottomRef.current
    ) {
      return;
    }

    content.scrollTop =
      content.scrollHeight;
  }, [contentKey, contentRef]);

  const handleScroll = () => {
    const content =
      contentRef.current;

    if (!content) {
      return;
    }

    const distanceToBottom =
      content.scrollHeight -
      content.scrollTop -
      content.clientHeight;

    stickToBottomRef.current =
      distanceToBottom < 24;
  };

  return {
    handleScroll
  };
}
