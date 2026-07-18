import {
  useRef,
  useState
} from "react";

import {
  useAppSettings
} from "../shared/hooks/useAppSettings.js";

import {
  useResolvedTheme
} from "../shared/hooks/useResolvedTheme.js";

import {
  InputComposer
} from "./components/Composer.jsx";

import {
  useAgentStatus
} from "../shared/hooks/useAgentStatus.js";

import {
  useInputWindowResize
} from "./hooks/useInputWindowResize.js";

import {
  getWindowTypographyStyle
} from "../shared/typography.js";

import "./Input.css";

export default function Input() {
  const [value, setValue] =
    useState("");

  const [submitting, setSubmitting] =
    useState(false);

  const textareaRef =
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
    status,
    isRunning,
    isWaitingForUser
  } = useAgentStatus();

  const inputSettings =
    settings.input;

  useInputWindowResize({
    value,
    textareaRef,
    settings:
      inputSettings
  });

  const handleSend = async () => {
    if (isRunning) {
      await window.api
        ?.stopAgent?.();

      return;
    }

    const message =
      value.trim();

    if (
      !message ||
      submitting
    ) {
      return;
    }

    setSubmitting(true);

    try {
      const result =
        await window.api
          ?.sendAgentMessage?.(
            message
          );

      if (result?.ok) {
        setValue("");
      } else if (
        result?.message
      ) {
        console.warn(
          result.message
        );
      }
    } catch (error) {
      console.error(
        "发送消息失败：",
        error
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown =
    (event) => {
      if (
        isRunning ||
        submitting
      ) {
        return;
      }

      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event
          .nativeEvent
          ?.isComposing
      ) {
        event.preventDefault();
        void handleSend();
      }
    };

  const lineHeight =
    Math.round(
      inputSettings.fontSize *
      (
        settings.appearance
          .typography
          .input
          .lineHeight ?? 1.45
      )
    );

  return (
    <InputComposer
      className={
        `${theme === "dark"
          ? "theme-dark"
          : ""}${
          settings
            .appearance
            .reducedMotion
            ? " reduce-motion"
            : ""
        }`
      }
      style={{
        ...getWindowTypographyStyle(
          settings,
          "input"
        ),

        "--input-font-size":
          `${inputSettings.fontSize}px`,

        "--input-line-height":
          `${lineHeight}px`,

        "--input-background-opacity":
          inputSettings
            .backgroundOpacity,

        "--input-radius":
          `${inputSettings.borderRadius}px`,

        "--accent":
          settings
            .appearance
            .accentColor
      }}
      textareaRef={textareaRef}
      value={value}
      placeholder={
        isRunning
          ? "正在生成回复…"
          : isWaitingForUser
            ? "回答 Agent 的问题…"
            : inputSettings
                .placeholder
      }
      canSend={
        isRunning ||
        Boolean(
          value.trim()
        )
      }
      isRunning={isRunning}
      isStopping={
        ["stopping", "cancelling"].includes(
        status.state
      )
      }
      disabled={submitting}
      onChange={setValue}
      onKeyDown={handleKeyDown}
      onSend={() => {
        void handleSend();
      }}
      onClose={() => {
        window.api
          ?.closeWindow?.();
      }}
    />
  );
}
