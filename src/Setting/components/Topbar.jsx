import {
  Icon
} from "./Icon.jsx";

const STATUS_TEXT = {
  loading:
    "正在读取",

  saving:
    "正在保存",

  saved:
    "已保存",

  error:
    "保存失败"
};

export function SettingsTopbar({
  collapsed,
  isMaximized,
  status,
  onToggleSidebar,
  onMinimize,
  onMaximize,
  onClose
}) {
  return (
    <header className="setting-topbar">
      <div className="setting-topbar__left">
        <button
          type="button"
          className="setting-sidebar-toggle"
          onClick={onToggleSidebar}
          title={
            collapsed
              ? "Show sidebar"
              : "Hide sidebar"
          }
          aria-label={
            collapsed
              ? "Show sidebar"
              : "Hide sidebar"
          }
        >
          <Icon
            name="sidebar"
            size={17}
          />
        </button>
        <span
          data-testid="setting-save-status"
          data-status={status}
          className={
            `setting-save-status setting-save-status--${status}`
          }
        >
          {STATUS_TEXT[status]}
        </span>
      </div>

      <WindowControls
        isMaximized={isMaximized}
        onMinimize={onMinimize}
        onMaximize={onMaximize}
        onClose={onClose}
      />
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
    <div className="setting-window-controls">
      <button
        className="setting-window-button"
        type="button"
        onClick={onMinimize}
        title="Minimize"
        aria-label="Minimize"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden="true"
        >
          <path
            d="M1.5 5h7"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <button
        className="setting-window-button"
        type="button"
        onClick={onMaximize}
        title={
          isMaximized
            ? "Restore"
            : "Maximize"
        }
        aria-label={
          isMaximized
            ? "Restore"
            : "Maximize"
        }
      >
        {isMaximized ? (
          <svg
            width="11"
            height="11"
            viewBox="0 0 11 11"
            aria-hidden="true"
          >
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
              fill="var(--setting-topbar)"
              stroke="currentColor"
              strokeWidth="1.1"
            />
          </svg>
        ) : (
          <svg
            width="11"
            height="11"
            viewBox="0 0 11 11"
            aria-hidden="true"
          >
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
          </svg>
        )}
      </button>

      <button
        className={
          "setting-window-button " +
          "setting-window-button--close"
        }
        type="button"
        onClick={onClose}
        title="Close"
        aria-label="Close"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden="true"
        >
          <path
            d="m2 2 6 6M8 2 2 8"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
