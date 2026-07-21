import {
  useLayoutEffect,
  useRef,
  useState
} from "react";

export function useResponseLayout({
  hasContent,
  contentKey,
  streamId,
  shellRef,
  contentRef
}) {
  const lastSizeRef = useRef({ width: 0, height: 0 });
  const stickToBottomRef = useRef(true);
  const [scrollable, setScrollable] = useState(false);

  useLayoutEffect(() => {
    lastSizeRef.current = { width: 0, height: 0 };
    stickToBottomRef.current = true;
    setScrollable(false);
  }, [streamId]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell || !hasContent) return undefined;

    let animationFrame = null;
    const reportSize = () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const rect = shell.getBoundingClientRect();
        const width = Math.ceil(rect.width);
        const height = Math.ceil(rect.height);
        const previous = lastSizeRef.current;
        if (previous.width === width && previous.height === height) return;
        lastSizeRef.current = { width, height };
        window.api?.resizeResponseWindow?.({ width, height });
      });
    };

    const observer = new ResizeObserver(reportSize);
    observer.observe(shell);
    reportSize();

    return () => {
      observer.disconnect();
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    };
  }, [hasContent, shellRef]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || !hasContent) {
      setScrollable(false);
      return undefined;
    }

    let animationFrame = null;
    const inspectOverflow = () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const nextScrollable = content.scrollHeight > content.clientHeight + 1;
        setScrollable((current) => current === nextScrollable ? current : nextScrollable);
        if (stickToBottomRef.current && nextScrollable) {
          content.scrollTop = content.scrollHeight;
        } else if (!nextScrollable && content.scrollTop !== 0) {
          content.scrollTop = 0;
        }
      });
    };

    const observer = new ResizeObserver(inspectOverflow);
    observer.observe(content);
    for (const child of content.children) observer.observe(child);
    inspectOverflow();

    return () => {
      observer.disconnect();
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    };
  }, [contentKey, contentRef, hasContent]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || !stickToBottomRef.current || !scrollable) return;
    content.scrollTop = content.scrollHeight;
  }, [contentKey, contentRef, scrollable]);

  const handleScroll = () => {
    const content = contentRef.current;
    if (!content || !scrollable) {
      stickToBottomRef.current = true;
      return;
    }
    const distanceToBottom = content.scrollHeight - content.scrollTop - content.clientHeight;
    stickToBottomRef.current = distanceToBottom < 24;
  };

  return {
    handleScroll,
    scrollable
  };
}
