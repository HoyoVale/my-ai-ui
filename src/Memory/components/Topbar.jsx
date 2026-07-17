import {
  MemoryIcon
} from "./Icon.jsx";

export function MemoryTopbar({
  state,
  isMaximized,
  onMinimize,
  onMaximize,
  onClose
}) {
  return (
    <header className="memory-topbar">
      <div className="memory-topbar__title">
        <MemoryIcon
          name="brain"
          size={17}
        />
        <div>
          <strong>长期记忆</strong>
          <span>
            手动维护、跨会话使用
          </span>
        </div>
      </div>

      <div className="memory-topbar__right">
        <div className="memory-topbar__summary">
          <strong>
            {state.enabledMemories}
          </strong>
          <span>
            / {state.totalMemories} 已启用
          </span>
        </div>

        <div className="memory-window-controls">
          <button
            type="button"
            aria-label="Minimize"
            onClick={onMinimize}
          >
            −
          </button>
          <button
            type="button"
            aria-label="Maximize"
            onClick={onMaximize}
          >
            {isMaximized
              ? "❐"
              : "□"}
          </button>
          <button
            type="button"
            className="is-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>
    </header>
  );
}
