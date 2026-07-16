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
  useInputWindowResize
} from "./hooks/useInputWindowResize.js";

import "./Input.css";

export default function Input() {
  const [
    value,
    setValue
  ] = useState("");

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

  const inputSettings =
    settings.input;

  useInputWindowResize({
    value,
    textareaRef,
    settings:
      inputSettings
  });

  const handleSend = () => {
    const message =
      value.trim();

    if (!message) {
      return;
    }

    // TODO: 后续接入正式模型请求 IPC。
    console.log(
      "Send message:",
      message
    );

    setValue("");
  };

  const handleKeyDown =
    (event) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event
          .nativeEvent
          ?.isComposing
      ) {
        event.preventDefault();
        handleSend();
      }
    };

  const lineHeight =
    Math.round(
      inputSettings.fontSize *
      1.45
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
      textareaRef={
        textareaRef
      }
      value={value}
      placeholder={
        inputSettings
          .placeholder
      }
      canSend={
        Boolean(
          value.trim()
        )
      }
      onChange={
        setValue
      }
      onKeyDown={
        handleKeyDown
      }
      onSend={
        handleSend
      }
      onClose={() => {
        window.api
          ?.closeWindow?.();
      }}
    />
  );
}
