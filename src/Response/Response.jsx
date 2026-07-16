import { useRef } from "react";

import { ResponseBubble } from "./components/Bubble.jsx";
import { useResponseLayout } from "./hooks/useResponseLayout.js";
import { useResponseStream } from "./hooks/useResponseStream.js";
import "./Response.css";

export default function Response() {
  const shellRef = useRef(null);
  const contentRef = useRef(null);

  const {
    text,
    streaming,
    side,
    streamId
  } = useResponseStream();

  const {
    handleScroll
  } = useResponseLayout({
    text,
    streamId,
    shellRef,
    contentRef
  });

  if (!text) {
    return null;
  }

  return (
    <ResponseBubble
      shellRef={shellRef}
      contentRef={contentRef}
      text={text}
      streaming={streaming}
      side={side}
      onScroll={handleScroll}
      onDismiss={() => {
        window.api
          ?.dismissResponseWindow?.();
      }}
    />
  );
}
