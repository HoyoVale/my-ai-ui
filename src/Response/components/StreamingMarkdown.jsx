import {
  useLayoutEffect,
  useRef
} from "react";

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

function createCursorElement() {
  const cursor =
    document.createElement("span");

  cursor.className =
    "response-bubble__cursor";

  cursor.dataset.testid =
    "response-stream-cursor";

  cursor.setAttribute(
    "aria-hidden",
    "true"
  );

  return cursor;
}

export function StreamingMarkdown({
  content,
  compact = false,
  cursor = false
}) {
  const rootRef = useRef(null);

  useLayoutEffect(() => {
    if (!cursor) {
      return undefined;
    }

    const host = resolveCursorHost(
      rootRef.current
    );

    if (!host) {
      return undefined;
    }

    /*
     * 不使用 React Portal 把光标挂到 ReactMarkdown 管理的节点中。
     * Markdown 在流式更新时会替换段落节点，Portal 仍引用旧节点会导致
     * React DOM 提交阶段报错，进而让整个 Response 回复区域停止渲染。
     *
     * 光标属于纯视觉增强，直接在 layout effect 中附加，并在下一次
     * Markdown 提交后重新定位到最后一个实际文本块，既能跟随文本，
     * 也不会参与 React 子树的 reconciliation。
     */
    const cursorElement =
      createCursorElement();

    host.appendChild(
      cursorElement
    );

    return () => {
      if (
        cursorElement.parentNode
      ) {
        cursorElement.remove();
      }
    };
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
    </div>
  );
}
