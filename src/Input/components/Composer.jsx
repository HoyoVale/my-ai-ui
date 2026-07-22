import {
  useLayoutEffect,
  useRef
} from "react";

import {
  InputContextMenu
} from "./ContextMenu.jsx";

import {
  SlashMenu
} from "./SlashMenu.jsx";

export function InputComposer({
  className = "",
  style,
  barRef,
  textareaRef,
  value,
  cursorPosition,
  placeholder,
  canSend,
  isRunning,
  isStopping,
  disabled,
  context,
  contextMenuCloseToken = 0,
  slashSuppressed = false,
  skillsReady = false,
  skillsError = "",
  onContextMenuOpenChange,
  onContextMenuPanelHeightChange,
  onSlashMenuOpenChange,
  onSlashMenuPanelHeightChange,
  onSelectSession,
  onCreateSession,
  onAddWorkspace,
  onSkillChange,
  onGoalChange,
  onModelChange,
  onToggleMcp,
  onToggleMcpServer,
  onChange,
  onCursorChange,
  onSuppressSlash,
  onKeyDown,
  onSend,
  onClose
}) {
  const slashMenuRef = useRef(null);
  const contextMenuRef = useRef(null);

  const executeSlashCommand = (command) => {
    const action = command?.action ?? {};
    if (action.type === "open-context") {
      contextMenuRef.current?.openPage(action.page);
      return;
    }
    if (action.type === "new-session") {
      void onCreateSession?.({
        mode: context?.mode,
        workspaceId: context?.workspaceId ?? null,
        modelSelection: context?.currentModelSelection ?? undefined,
        skillIds: context?.currentSkillIds ?? [],
        skillRoutingMode: context?.currentSkillRoutingMode ?? "manual"
      });
      return;
    }
    if (action.type === "open-window") {
      const open = {
        conversation: window.api?.openConversation,
        memory: window.api?.openMemory,
        settings: window.api?.openSetting
      }[action.window];
      open?.();
    }
  };

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || document.activeElement !== textarea) return;
    const position = Math.max(0, Math.min(value.length, Number(cursorPosition) || 0));
    if (textarea.selectionStart !== position || textarea.selectionEnd !== position) {
      textarea.setSelectionRange(position, position);
    }
  }, [cursorPosition, textareaRef, value.length]);

  return (
    <div
      className={`input-window ${className}`.trim()}
      style={style}
    >
      <div
        ref={barRef}
        className="input-bar"
      >
        <InputContextMenu
          ref={contextMenuRef}
          context={context}
          disabled={disabled || isRunning || context?.busy}
          closeToken={contextMenuCloseToken}
          onOpenChange={onContextMenuOpenChange}
          onPanelHeightChange={onContextMenuPanelHeightChange}
          onSelectSession={onSelectSession}
          onCreateSession={onCreateSession}
          onAddWorkspace={onAddWorkspace}
          onSkillChange={onSkillChange}
          onGoalChange={onGoalChange}
          onModelChange={onModelChange}
          onToggleMcp={onToggleMcp}
          onToggleMcpServer={onToggleMcpServer}
        />

        <SlashMenu
          ref={slashMenuRef}
          value={value}
          cursorPosition={cursorPosition}
          skills={context?.skills}
          skillsReady={skillsReady}
          skillsError={skillsError}
          mode={context?.mode}
          disabled={disabled || isRunning || context?.busy}
          suppressed={slashSuppressed}
          onOpenChange={onSlashMenuOpenChange}
          onPanelHeightChange={onSlashMenuPanelHeightChange}
          onExecuteCommand={executeSlashCommand}
          onChange={(nextValue, nextCursor, options = {}) => {
            if (options.suppressSlash) {
              onSuppressSlash?.();
              return;
            }
            onChange(nextValue, nextCursor);
          }}
        />

        <textarea
          ref={textareaRef}
          className="input-bar__field"
          data-testid="input-textarea"
          rows={1}
          placeholder={context?.error || placeholder}
          value={value}
          aria-busy={disabled}
          onChange={(event) => {
            onChange(event.target.value, event.target.selectionStart);
          }}
          onSelect={(event) => onCursorChange?.(event.currentTarget.selectionStart)}
          onClick={(event) => onCursorChange?.(event.currentTarget.selectionStart)}
          onKeyUp={(event) => onCursorChange?.(event.currentTarget.selectionStart)}
          onKeyDown={(event) => {
            if (slashMenuRef.current?.handleKeyDown(event)) return;
            onKeyDown(event);
          }}
          autoFocus
        />

        <button
          data-testid="input-send"
          className={`input-bar__send${isRunning ? " is-running" : ""}`}
          type="button"
          onClick={onSend}
          disabled={!canSend || disabled}
          title={isRunning ? "Stop" : "Send"}
          aria-label={isRunning ? "Stop generation" : "Send"}
        >
          {isRunning ? (
            <span
              className={`input-bar__stop-icon${isStopping ? " is-stopping" : ""}`}
              aria-hidden="true"
            />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>

        <button
          className="input-bar__close"
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
