import {
  useCallback,
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
  encodeModelOptionValue,
  parseModelOptionValue,
  useInputContext
} from "./hooks/useInputContext.js";

import {
  getWindowTypographyStyle
} from "../shared/typography.js";

import "./Input.css";

export default function Input() {
  const [value, setValue] =
    useState("");

  const [submitting, setSubmitting] =
    useState(false);

  const [contextMenuOpen, setContextMenuOpen] =
    useState(false);

  const [contextMenuHeight, setContextMenuHeight] =
    useState(0);

  const barRef =
    useRef(null);

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
    isRunning
  } = useAgentStatus();

  const inputSettings =
    settings.input;

  const inputContext =
    useInputContext(settings);

  const currentMode =
    inputContext.state.currentMode ?? "chat";
  const currentModelSelection =
    inputContext.state.currentModelSelection;
  const selectedModelValue = currentModelSelection
    ? encodeModelOptionValue(
        currentModelSelection.providerId,
        currentModelSelection.modelConfigId
      )
    : "";
  const modelValue = inputContext.models.some(
    (model) => model.value === selectedModelValue
  )
    ? selectedModelValue
    : inputContext.models[0]?.value ?? "";

  useInputWindowResize({
    value,
    barRef,
    textareaRef,
    settings:
      inputSettings,
    menuOpen: contextMenuOpen,
    menuHeight: contextMenuHeight
  });

  const handleContextMenuOpenChange =
    useCallback((open) => {
      setContextMenuOpen(open);

      if (!open) {
        setContextMenuHeight(0);
      }
    }, []);

  const handleContextMenuPanelHeightChange =
    useCallback((height) => {
      setContextMenuHeight(
        Math.max(
          0,
          Number(height) || 0
        )
      );
    }, []);

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
      const expectedConversationId =
        inputContext.state.currentConversationId;

      if (!expectedConversationId) {
        console.warn("当前没有可发送消息的会话。");
        return;
      }

      const result =
        await window.api
          ?.sendAgentMessage?.({
            content: message,
            expectedConversationId
          });

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
      barRef={barRef}
      textareaRef={textareaRef}
      value={value}
      placeholder={
        isRunning
          ? "正在生成回复…"
          : inputSettings
              .placeholder
      }
      canSend={
        isRunning ||
        Boolean(value.trim())
      }
      isRunning={isRunning}
      isStopping={
        ["stopping", "cancelling"].includes(
        status.state
      )
      }
      disabled={submitting}
      context={{
        mode: currentMode,
        workspaceId:
          inputContext.state.currentWorkspaceId ?? null,
        currentConversationId:
          inputContext.state.currentConversationId,
        currentConversationTitle:
          inputContext.state.currentConversation?.title ?? "新会话",
        currentModelSelection,
        currentSkillId: inputContext.state.currentSkillId ?? null,
        currentSkill: inputContext.state.currentSkill ?? null,
        currentSkillIds: inputContext.state.currentSkillIds ?? [],
        currentSkills: inputContext.state.currentSkills ?? [],
        currentSkillRoutingMode: inputContext.state.currentSkillRoutingMode ?? "manual",
        workspaces: inputContext.workspaces,
        conversations: inputContext.conversations,
        skills: inputContext.skills,
        models: inputContext.models,
        modelValue,
        busy: inputContext.busy,
        error: inputContext.error
      }}
      onContextMenuOpenChange={handleContextMenuOpenChange}
      onContextMenuPanelHeightChange={handleContextMenuPanelHeightChange}
      onSelectSession={(conversationId) => {
        return inputContext.selectSession(conversationId);
      }}
      onCreateSession={(input) => {
        return inputContext.createSession(input);
      }}
      onAddWorkspace={() => {
        return inputContext.addWorkspace();
      }}
      onSkillChange={(selection) => {
        return inputContext.setSkill(selection);
      }}
      onModelChange={(selection) => {
        const parsed = parseModelOptionValue(selection);

        if (!parsed) {
          return Promise.resolve({
            ok: false,
            message: "模型配置无效。"
          });
        }

        return inputContext.setModel(
          parsed.providerId,
          parsed.modelConfigId
        );
      }}
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
