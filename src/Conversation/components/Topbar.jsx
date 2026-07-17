export function ConversationTopbar({
  title,
  isMaximized,
  onMinimize,
  onMaximize,
  onClose
}) {
  return (
    <header className="conversation-topbar">
      <div className="conversation-topbar__title">
        <span>会话</span>
        <strong>{title}</strong>
      </div>

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
    </header>
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
