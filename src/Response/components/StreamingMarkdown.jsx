import {
  useLayoutEffect,
  useRef,
  useState
} from "react";

import {
  createPortal
} from "react-dom";

import {
  MarkdownContent
} from "../../Conversation/components/MarkdownContent.jsx";

const CURSOR_HOST_SELECTOR = [
  "p",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre code",
  "td",
  "th",
  ".markdown-math--display"
].join(",");

function resolveCursorHost(root) {
  const markdown =
    root?.querySelector(
      ".markdown-content"
    );

  if (!markdown) {
    return null;
  }

  const candidates = [
    ...markdown.querySelectorAll(
      CURSOR_HOST_SELECTOR
    )
  ].filter((element) => {
    return !element.closest(
      ".markdown-copy-button"
    );
  });

  return candidates.at(-1) ?? markdown;
}

export function StreamingMarkdown({
  content,
  compact = false,
  cursor = false
}) {
  const rootRef = useRef(null);
  const [cursorHost, setCursorHost] =
    useState(null);

  useLayoutEffect(() => {
    const nextHost = cursor
      ? resolveCursorHost(
          rootRef.current
        )
      : null;

    setCursorHost((current) =>
      current === nextHost
        ? current
        : nextHost
    );
  }, [content, cursor]);

  return (
    <div
      ref={rootRef}
      className="response-streaming-markdown"
    >
      <MarkdownContent
        content={content}
        compact={compact}
      />

      {cursor && cursorHost &&
        createPortal(
          <span
            className="response-bubble__cursor"
            data-testid="response-stream-cursor"
            aria-hidden="true"
          />,
          cursorHost
        )}
    </div>
  );
}
