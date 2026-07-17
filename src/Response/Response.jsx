import {
  useRef
} from "react";

import {
  useAppSettings
} from "../shared/hooks/useAppSettings.js";

import {
  useResolvedTheme
} from "../shared/hooks/useResolvedTheme.js";

import {
  ResponseBubble
} from "./components/Bubble.jsx";

import {
  useResponseLayout
} from "./hooks/useResponseLayout.js";

import {
  useResponseStream
} from "./hooks/useResponseStream.js";

import {
  getWindowTypographyStyle
} from "../shared/typography.js";

import "./Response.css";

export default function Response() {
  const shellRef =
    useRef(null);

  const contentRef =
    useRef(null);

  const settings =
    useAppSettings();

  const theme =
    useResolvedTheme(
      settings
        .appearance
        .theme
    );

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

  const response =
    settings.response;

  return (
    <ResponseBubble
      shellRef={shellRef}
      contentRef={contentRef}
      text={text}
      streaming={streaming}
      side={side}
      theme={theme}
      reducedMotion={
        settings
          .appearance
          .reducedMotion
      }
      style={{
        ...getWindowTypographyStyle(
          settings,
          "response"
        ),

        "--response-max-width":
          `${response.bubbleMaxWidth}px`,

        "--response-max-height":
          `${response.contentMaxHeight}px`,

        "--response-font-size":
          `${response.fontSize}px`,

        "--response-line-height":
          response.lineHeight,

        "--response-background-opacity":
          response.backgroundOpacity,

        "--response-radius":
          `${response.borderRadius}px`,

        "--accent":
          settings
            .appearance
            .accentColor
      }}
      onScroll={handleScroll}
      onDismiss={() => {
        window.api
          ?.dismissResponseWindow?.();
      }}
    />
  );
}
