import {
  useMemo,
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
  createActivitySnapshot
} from "../Conversation/utils/taskActivity.js";

import {
  getWindowTypographyStyle
} from "../shared/typography.js";

import {
  resolveResponsePresentation
} from "./utils/responsePresentation.js";

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
    agentStatus,
    streaming,
    side,
    streamId
  } = useResponseStream();

  const presentation =
    useMemo(() => {
      if (!agentStatus?.runId) {
        return {
          answerText: text,
          liveText: "",
          hasActivity: false,
          activityRevision: ""
        };
      }

      const snapshot =
        createActivitySnapshot(
          agentStatus,
          {
            live: streaming
          }
        );

      const hasActivity =
        snapshot.events.some((event) =>
          ["commentary", "tool"].includes(event.type)
        ) ||
        snapshot.planStats.total > 0;

      const finalText =
        String(
          agentStatus.finalText ?? ""
        ).trim();

      const currentText =
        String(
          agentStatus.liveStepText ?? ""
        );

      const responseText =
        resolveResponsePresentation({
          text,
          finalText,
          liveStepText:
            currentText,
          hasActivity,
          streaming
        });

      return {
        ...responseText,
        hasActivity,
        activityRevision: [
          snapshot.events.length,
          snapshot.events.at(-1)?.updatedAt ?? "",
          snapshot.plan
            .map((item) => `${item.id}:${item.status}`)
            .join("|")
        ].join(":")
      };
    }, [
      agentStatus,
      streaming,
      text
    ]);

  const hasContent =
    Boolean(
      String(presentation.answerText).trim() ||
      String(presentation.liveText).trim() ||
      presentation.hasActivity ||
      agentStatus?.runId
    );

  const contentKey = [
    presentation.answerText,
    presentation.liveText,
    presentation.activityRevision,
    streaming
  ].join("\u0000");

  const {
    handleScroll
  } = useResponseLayout({
    hasContent,
    contentKey,
    streamId,
    shellRef,
    contentRef
  });

  if (!hasContent) {
    return null;
  }

  const response =
    settings.response;

  return (
    <ResponseBubble
      shellRef={shellRef}
      contentRef={contentRef}
      answerText={presentation.answerText}
      liveText={presentation.liveText}
      agentStatus={agentStatus}
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
