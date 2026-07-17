import {
  MemoryIcon
} from "./Icon.jsx";

export function MemoryTopbar({
  state,
  isMaximized,
  onNew,
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
        <strong>长期记忆</strong>
        <span>
          {state.enabledMemories}/
          {state.totalMemories} 已启用
        </span>
      </div>

      <div className="memory-topbar__right">
        <button
          type="button"
          className="memory-primary memory-primary--small"
          data-testid="memory-new-topbar"
          onClick={onNew}
        >
          <MemoryIcon
            name="plus"
            size={15}
          />
          新建记忆
        </button>

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
