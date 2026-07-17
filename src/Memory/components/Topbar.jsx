import {
  MemoryIcon
} from "./Icon.jsx";

export function MemoryTopbar({
  sidebarCollapsed,
  isMaximized,
  onToggleSidebar,
  onCreate,
  onMinimize,
  onMaximize,
  onClose
}) {
  return (
    <header className="memory-topbar">
      <div className="memory-topbar__left">
        <button
          type="button"
          className="memory-icon-button"
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
          <MemoryIcon
            name="sidebar"
            size={17}
          />
        </button>
      </div>

      <div className="memory-topbar__right">
        <button
          type="button"
          className="memory-icon-button"
          data-testid="memory-new-topbar"
          title="新建记忆"
          aria-label="新建记忆"
          onClick={onCreate}
        >
          <MemoryIcon
            name="plus"
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
    <div className="memory-window-controls">
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
              fill="var(--memory-topbar)"
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
        className="memory-window-button--close"
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
        `memory-window-button ${className}`
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
