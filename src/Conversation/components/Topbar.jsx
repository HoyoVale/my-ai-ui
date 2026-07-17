import {
  ConversationIcon
} from "./Icon.jsx";

export function ConversationTopbar({
  sidebarCollapsed,
  isMaximized,
  contextOpen,
  onToggleSidebar,
  onToggleContext,
  onCreate,
  onOpenInput,
  onMinimize,
  onMaximize,
  onClose
}) {
  return (
    <header className="conversation-topbar">
      <div className="conversation-topbar__left">
        <button
          type="button"
          className="conversation-icon-button"
          title={
            sidebarCollapsed
              ? "显示侧栏"
              : "隐藏侧栏"
          }
          aria-label={
            sidebarCollapsed
              ? "显示侧栏"
              : "隐藏侧栏"
          }
          onClick={onToggleSidebar}
        >
          <ConversationIcon
            name="sidebar"
            size={17}
          />
        </button>
      </div>

      <div className="conversation-topbar__right">
        <button
          type="button"
          className={
            `conversation-icon-button${
              contextOpen
                ? " is-active"
                : ""
            }`
          }
          data-testid="conversation-context-toggle"
          title="上下文"
          aria-label="上下文"
          aria-pressed={contextOpen}
          onClick={onToggleContext}
        >
          <ConversationIcon
            name="context"
            size={17}
          />
        </button>

        <button
          type="button"
          className="conversation-icon-button"
          data-testid="conversation-new"
          title="新建会话"
          aria-label="新建会话"
          onClick={onCreate}
        >
          <ConversationIcon
            name="plus"
            size={17}
          />
        </button>

        <button
          type="button"
          className="conversation-icon-button"
          data-testid="conversation-open-input"
          title="继续对话"
          aria-label="继续对话"
          onClick={onOpenInput}
        >
          <ConversationIcon
            name="compose"
            size={17}
          />
        </button>

        <WindowControls
          isMaximized={isMaximized}
          onMinimize={onMinimize}
          onMaximize={onMaximize}
          onClose={onClose}
        />
      </div>
    </header>
  );
}

function WindowControls({
  isMaximized,
  onMinimize,
  onMaximize,
  onClose
}) {
  return (
    <div className="conversation-window-controls">
      <WindowButton
        label="Minimize"
        onClick={onMinimize}
      >
        <path
          d="M1.5 5h7"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </WindowButton>

      <WindowButton
        label={
          isMaximized
            ? "Restore"
            : "Maximize"
        }
        onClick={onMaximize}
      >
        {isMaximized ? (
          <>
            <rect
              x="3.5"
              y="1.5"
              width="6"
              height="6"
              rx="1"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
            />
            <rect
              x="1.5"
              y="3.5"
              width="6"
              height="6"
              rx="1"
              fill="var(--conversation-topbar)"
              stroke="currentColor"
              strokeWidth="1.1"
            />
          </>
        ) : (
          <rect
            x="1.5"
            y="1.5"
            width="8"
            height="8"
            rx="1.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
          />
        )}
      </WindowButton>

      <WindowButton
        label="Close"
        className="conversation-window-button--close"
        onClick={onClose}
      >
        <path
          d="m2 2 6 6M8 2 2 8"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </WindowButton>
    </div>
  );
}

function WindowButton({
  label,
  className = "",
  onClick,
  children
}) {
  return (
    <button
      type="button"
      className={
        `conversation-window-button ${className}`
          .trim()
      }
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 11 11"
        aria-hidden="true"
      >
        {children}
      </svg>
    </button>
  );
}
