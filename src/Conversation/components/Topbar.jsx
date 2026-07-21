import {
  ConversationIcon
} from "./Icon.jsx";

export function ConversationTopbar({
  sidebarCollapsed,
  isMaximized,
  contextOpen,
  taskOpen,
  goalOpen,
  goal = null,

  skill = null,
  skills = [],
  skillRoutingMode = "manual",
  onToggleSidebar,
  onToggleContext,
  onToggleTask,
  onToggleGoal,

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

        {(skill?.id || skills.length > 0 || skillRoutingMode === "auto") && (
          <div
            className="conversation-topbar__skill"
            title={skillRoutingMode === "auto" && !skills.length
              ? "Skill Router 自动选择"
              : (skills.length ? skills : skill ? [skill] : []).map((item) => `${item.name} · ${item.id}`).join("\n")}
          >
            <span>{skillRoutingMode === "auto" && !skills.length ? "Auto Skill" : "Skill"}</span>
            <strong>
              {skillRoutingMode === "auto" && !skills.length
                ? "自动选择"
                : (skills.length ? skills : [skill]).length > 1
                  ? `${(skills.length ? skills : [skill]).length} 个组合`
                  : (skills[0] ?? skill)?.name}
            </strong>
          </div>
        )}
      </div>

      <div className="conversation-topbar__right">
        <button
          type="button"
          className={`conversation-icon-button conversation-goal-toggle${goalOpen ? " is-active" : ""}${goal?.status ? ` is-${goal.status}` : ""}`}
          data-testid="conversation-goal-toggle"
          title={goal ? `Goal · ${STATUS_LABELS[goal.status] ?? "已设置"}` : "设置 Goal"}
          aria-label="Goal"
          aria-pressed={goalOpen}
          onClick={onToggleGoal}
        >
          <ConversationIcon name="goal" size={17} />
          {goal?.status === "active" && <span aria-hidden="true" />}
        </button>

        <button
          type="button"
          className={
            `conversation-icon-button${
              taskOpen
                ? " is-active"
                : ""
            }`
          }
          data-testid="conversation-task-toggle"
          title="任务活动"
          aria-label="任务活动"
          aria-pressed={taskOpen}
          onClick={onToggleTask}
        >
          <ConversationIcon
            name="activity"
            size={17}
          />
        </button>

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

const STATUS_LABELS = {
  active: "进行中",
  paused: "已暂停",
  completed: "已完成"
};

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
