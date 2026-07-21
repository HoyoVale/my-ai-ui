import {
  useEffect,
  useState
} from "react";

import {
  ConversationIcon
} from "./Icon.jsx";

const STATUS_LABELS = {
  active: "进行中",
  paused: "已暂停",
  completed: "已完成"
};

export function ConversationGoalPanel({
  open,
  conversation,
  busy = false,
  onUpdate,
  onClose
}) {
  const goal = conversation?.goal ?? null;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(goal?.objective ?? "");
    setError("");
  }, [conversation?.id, goal?.id, goal?.objective]);

  if (!open) {
    return null;
  }

  const save = async ({ objective = draft, status = "active" } = {}) => {
    setError("");
    const result = await onUpdate?.({ objective, status });
    if (result?.ok === false) {
      setError(result.message ?? "无法更新 Goal。");
    }
  };

  return (
    <aside
      className="conversation-task-panel conversation-goal-panel"
      data-testid="conversation-goal-panel"
    >
      <header className="conversation-inspector__header">
        <div>
          <strong>Goal</strong>
          <span>{goal ? STATUS_LABELS[goal.status] ?? "已设置" : "未设置"}</span>
        </div>
        <button
          type="button"
          className="conversation-inspector__close"
          aria-label="关闭 Goal 面板"
          title="关闭"
          onClick={onClose}
        >
          <ConversationIcon name="close" size={17} />
        </button>
      </header>

      <div className="conversation-goal-panel__scroll">
        <div className={`conversation-goal-status is-${goal?.status ?? "empty"}`}>
          <span><ConversationIcon name="goal" size={17} /></span>
          <div>
            <strong>{goal ? STATUS_LABELS[goal.status] ?? "已设置" : "为当前会话设置长期目标"}</strong>
            <small>
              {goal?.status === "active"
                ? "Agent 会持续推进，并由完成验证器判断是否真正达成。"
                : goal?.status === "paused"
                  ? "暂停期间，新消息不会继承这个目标。"
                  : goal?.status === "completed"
                    ? "目标已通过完成验证；编辑后可作为新目标继续。"
                    : "写清最终结果和完成标准，过程计划可在执行中持续调整。"}
            </small>
          </div>
        </div>

        <label className="conversation-goal-field">
          <span>目标与完成标准</span>
          <textarea
            data-testid="conversation-goal-objective"
            value={draft}
            maxLength={4000}
            rows={10}
            placeholder={"例如：\n将当前 Electron 项目推进到可稳定日常使用；\n完成标准：测试、Lint、构建和关键 E2E 全部通过。"}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
          />
          <small>{draft.length}/4000</small>
        </label>

        <p className="conversation-goal-help">
          Goal 绑定当前会话。每条新消息都可补充方向；暂停或清除后，消息恢复为普通单次任务。
        </p>

        {error && <div className="conversation-goal-error">{error}</div>}

        <div className="conversation-goal-actions">
          {goal && (
            <button
              type="button"
              className="is-secondary is-danger"
              data-testid="conversation-goal-clear"
              disabled={busy}
              onClick={() => { void save({ objective: "" }); }}
            >
              清除
            </button>
          )}
          {goal?.status === "active" && (
            <button
              type="button"
              className="is-secondary"
              data-testid="conversation-goal-pause"
              disabled={busy}
              onClick={() => { void save({ objective: draft, status: "paused" }); }}
            >
              暂停
            </button>
          )}
          <button
            type="button"
            className="is-primary"
            data-testid="conversation-goal-save"
            disabled={busy || !draft.trim()}
            onClick={() => { void save({ status: "active" }); }}
          >
            {goal?.status === "paused" || goal?.status === "completed"
              ? "恢复并保存"
              : goal
                ? "保存"
                : "设为 Goal"}
          </button>
        </div>
      </div>
    </aside>
  );
}
