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
  const [value, setValue] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextMenuHeight, setContextMenuHeight] = useState(0);
  const [contextMenuCloseToken, setContextMenuCloseToken] = useState(0);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashMenuHeight, setSlashMenuHeight] = useState(0);
  const [slashSuppressed, setSlashSuppressed] = useState(false);

  const barRef = useRef(null);
  const textareaRef = useRef(null);
  const settings = useAppSettings();
  const theme = useResolvedTheme(settings.appearance.theme);
  const { status, isRunning } = useAgentStatus();
  const inputSettings = settings.input;
  const inputContext = useInputContext(settings);

  const currentMode = inputContext.state.currentMode ?? "chat";
  const currentModelSelection = inputContext.state.currentModelSelection;
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

  const overlayOpen = contextMenuOpen || slashMenuOpen;
  const overlayHeight = contextMenuOpen ? contextMenuHeight : slashMenuHeight;
  const menuDirection = useInputWindowResize({
    value,
    barRef,
    textareaRef,
    settings: inputSettings,
    menuOpen: overlayOpen,
    menuHeight: overlayHeight
  });

  const handleContextMenuOpenChange = useCallback((open) => {
    const nextOpen = open === true;
    setContextMenuOpen((current) => current === nextOpen ? current : nextOpen);
    if (nextOpen) {
      // The context menu takes ownership of the overlay. Keep Slash suppressed
      // until the user edits the input again so the two menus cannot reopen
      // each other while the same "/" command is still present.
      setSlashSuppressed(true);
    } else {
      setContextMenuHeight((current) => current === 0 ? current : 0);
    }
  }, []);

  const handleSlashMenuOpenChange = useCallback((open) => {
    const nextOpen = open === true;
    setSlashMenuOpen((current) => current === nextOpen ? current : nextOpen);
    if (nextOpen) {
      setContextMenuCloseToken((token) => token + 1);
    } else {
      setSlashMenuHeight((current) => current === 0 ? current : 0);
    }
  }, []);

  const handleContextMenuPanelHeightChange = useCallback((height) => {
    const nextHeight = Math.max(0, Math.ceil(Number(height) || 0));
    setContextMenuHeight((current) => current === nextHeight ? current : nextHeight);
  }, []);

  const handleSlashMenuPanelHeightChange = useCallback((height) => {
    const nextHeight = Math.max(0, Math.ceil(Number(height) || 0));
    setSlashMenuHeight((current) => current === nextHeight ? current : nextHeight);
  }, []);

  const handleValueChange = useCallback((nextValue, nextCursor) => {
    const normalized = String(nextValue ?? "");
    setValue(normalized);
    setCursorPosition(
      Number.isFinite(Number(nextCursor))
        ? Math.max(0, Math.min(normalized.length, Number(nextCursor)))
        : normalized.length
    );
    setSlashSuppressed(false);
  }, []);

  const handleSend = async () => {
    if (isRunning) {
      await window.api?.stopAgent?.();
      return;
    }

    const message = value.trim();
    if (!message || submitting) return;

    setSubmitting(true);
    try {
      const expectedConversationId = inputContext.state.currentConversationId;
      if (!expectedConversationId) {
        console.warn("当前没有可发送消息的会话。");
        return;
      }

      const result = await window.api?.sendAgentMessage?.({
        content: message,
        expectedConversationId
      });

      if (result?.ok) {
        setValue("");
        setCursorPosition(0);
        setSlashSuppressed(false);
      } else if (result?.message) {
        console.warn(result.message);
      }
    } catch (error) {
      console.error("发送消息失败：", error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (event) => {
    if (isRunning || submitting) return;
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent?.isComposing
    ) {
      event.preventDefault();
      void handleSend();
    }
  };

  const lineHeight = Math.round(
    inputSettings.fontSize *
    (settings.appearance.typography.input.lineHeight ?? 1.45)
  );

  return (
    <InputComposer
      className={[
        theme === "dark" ? "theme-dark" : "",
        settings.appearance.reducedMotion ? "reduce-motion" : "",
        menuDirection === "up" ? "menu-up" : "menu-down"
      ].filter(Boolean).join(" ")}
      style={{
        ...getWindowTypographyStyle(settings, "input"),
        "--input-font-size": `${inputSettings.fontSize}px`,
        "--input-line-height": `${lineHeight}px`,
        "--input-background-opacity": inputSettings.backgroundOpacity,
        "--input-radius": `${inputSettings.borderRadius}px`,
        "--accent": settings.appearance.accentColor
      }}
      barRef={barRef}
      textareaRef={textareaRef}
      value={value}
      cursorPosition={cursorPosition}
      placeholder={isRunning ? "正在生成回复…" : inputSettings.placeholder}
      canSend={isRunning || Boolean(value.trim())}
      isRunning={isRunning}
      isStopping={["stopping", "cancelling"].includes(status.state)}
      disabled={submitting}
      contextMenuCloseToken={contextMenuCloseToken}
      slashSuppressed={slashSuppressed}
      skillsReady={inputContext.skillsReady}
      skillsError={inputContext.skillsError}
      context={{
        mode: currentMode,
        workspaceId: inputContext.state.currentWorkspaceId ?? null,
        currentConversationId: inputContext.state.currentConversationId,
        currentConversationTitle: inputContext.state.currentConversation?.title ?? "新会话",
        currentGoal: inputContext.state.currentConversation?.goal ?? null,
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
        mcp: settings.mcp,
        busy: inputContext.busy,
        error: inputContext.error
      }}
      onContextMenuOpenChange={handleContextMenuOpenChange}
      onContextMenuPanelHeightChange={handleContextMenuPanelHeightChange}
      onSlashMenuOpenChange={handleSlashMenuOpenChange}
      onSlashMenuPanelHeightChange={handleSlashMenuPanelHeightChange}
      onSelectSession={(conversationId) => inputContext.selectSession(conversationId)}
      onCreateSession={(input) => inputContext.createSession(input)}
      onAddWorkspace={() => inputContext.addWorkspace()}
      onSkillChange={(selection) => inputContext.setSkill(selection)}
      onGoalChange={(goal) => inputContext.setGoal(goal)}
      onModelChange={(selection) => {
        const parsed = parseModelOptionValue(selection);
        if (!parsed) {
          return Promise.resolve({ ok: false, message: "模型配置无效。" });
        }
        return inputContext.setModel(parsed.providerId, parsed.modelConfigId);
      }}
      onToggleMcp={(enabled) => window.api?.quickSetMcpEnabled?.(enabled)}
      onToggleMcpServer={(serverId, enabled) =>
        window.api?.quickSetMcpServerEnabled?.(serverId, enabled)
      }
      onChange={handleValueChange}
      onCursorChange={setCursorPosition}
      onSuppressSlash={() => setSlashSuppressed(true)}
      onKeyDown={handleKeyDown}
      onSend={() => { void handleSend(); }}
      onClose={() => { window.api?.closeWindow?.(); }}
    />
  );
}
