import {
  useEffect,
  useMemo,
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

const KIND_LABELS = {
  auto: "自动判断",
  test: "测试",
  build: "构建",
  lint: "Lint",
  typecheck: "类型检查",
  check: "检查命令",
  change: "变更收据",
  manual: "人工确认"
};

function draftCriteria(goal, value) {
  const existing = new Map((goal?.criteria ?? []).map((item) => [item.text, item]));
  return String(value ?? "")
    .split(/\n/gu)
    .map((text) => text.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((text, index) => ({
      id: existing.get(text)?.id ?? `criterion-${index + 1}`,
      text,
      verificationKind: existing.get(text)?.verificationKind ?? "auto",
      manualSatisfied: existing.get(text)?.manualSatisfied === true
    }));
}

export function ConversationGoalPanel({
  open,
  conversation,
  busy = false,
  developerMode = false,
  onUpdate,
  onClose
}) {
  const goal = conversation?.goal ?? null;
  const [objectiveDraft, setObjectiveDraft] = useState("");
  const [criteriaDraft, setCriteriaDraft] = useState("");
  const [autoContinue, setAutoContinue] = useState(true);
  const [error, setError] = useState("");
  const storedCriteriaDraft = (goal?.criteria ?? []).map((item) => item.text).join("\n");
  const storedAutoContinue = goal?.autoContinue !== false;

  useEffect(() => {
    setObjectiveDraft(goal?.objective ?? "");
    setCriteriaDraft(storedCriteriaDraft);
    setAutoContinue(storedAutoContinue);
    setError("");
  }, [conversation?.id, goal?.id, goal?.objective, storedAutoContinue, storedCriteriaDraft]);

  const criteria = useMemo(() => goal?.criteria ?? [], [goal?.criteria]);
  const passedCount = criteria.filter((item) => item.status === "passed").length;

  if (!open) return null;

  const save = async ({
    objective = objectiveDraft,
    status = "active",
    nextCriteria = draftCriteria(goal, criteriaDraft),
    nextAutoContinue = autoContinue
  } = {}) => {
    setError("");
    const result = await onUpdate?.({
      objective,
      status,
      criteria: nextCriteria,
      autoContinue: nextAutoContinue
    });
    if (result?.ok === false) {
      setError(result.message ?? "无法更新 Goal。");
    }
    return result;
  };

  const toggleManual = (criterion) => {
    const nextCriteria = criteria.map((item) => item.id === criterion.id
      ? { ...item, manualSatisfied: item.manualSatisfied !== true }
      : item);
    void save({
      objective: goal.objective,
      status: goal.status,
      nextCriteria,
      nextAutoContinue: goal.autoContinue !== false
    });
  };

  const setCriterionKind = (criterion, verificationKind) => {
    const nextCriteria = criteria.map((item) => item.id === criterion.id
      ? { ...item, verificationKind, manualSatisfied: false }
      : item);
    void save({
      objective: goal.objective,
      status: goal.status,
      nextCriteria,
      nextAutoContinue: goal.autoContinue !== false
    });
  };

  return (
    <aside
      className="conversation-task-panel conversation-goal-panel"
      data-testid="conversation-goal-panel"
      aria-label="Goal"
    >
      <header className="conversation-inspector__header">
        <div>
          <strong>Goal</strong>
          <span>{goal ? STATUS_LABELS[goal.status] ?? "已设置" : "未设置"}</span>
        </div>
        <button
          type="button"
          className="conversation-inspector__close"
          onClick={onClose}
          aria-label="关闭 Goal"
        >
          ×
        </button>
      </header>

      <div className="conversation-goal-panel__scroll">
        <div className={`conversation-goal-status is-${goal?.status ?? "empty"}`}>
          <span><ConversationIcon name="goal" size={17} /></span>
          <div>
            <strong>{goal ? STATUS_LABELS[goal.status] ?? "已设置" : "设置一个可验收的长期目标"}</strong>
            <small>
              {criteria.length
                ? `${passedCount}/${criteria.length} 条完成标准已有证据`
                : "目标与完成标准会持续绑定当前会话。"}
            </small>
          </div>
        </div>

        <label className="conversation-goal-field">
          <span>目标</span>
          <textarea
            data-testid="conversation-goal-objective"
            value={objectiveDraft}
            maxLength={4000}
            rows={5}
            placeholder="例如：将当前 Electron 项目推进到可稳定日常使用。"
            disabled={busy}
            onChange={(event) => setObjectiveDraft(event.target.value)}
          />
          <small>{objectiveDraft.length}/4000</small>
        </label>

        <label className="conversation-goal-field">
          <span>Done when</span>
          <textarea
            data-testid="conversation-goal-criteria"
            value={criteriaDraft}
            maxLength={6000}
            rows={6}
            placeholder={"每行一条完成标准，例如：\nnpm test 全部通过\nnpm run build 成功\n实际界面确认 Goal 面板可用"}
            disabled={busy}
            onChange={(event) => setCriteriaDraft(event.target.value)}
          />
          <small>最多 12 条；无法从工具结果判断的标准需要人工确认。</small>
        </label>

        <label className="conversation-goal-toggle-row">
          <input
            type="checkbox"
            data-testid="conversation-goal-auto-continue"
            checked={autoContinue}
            disabled={busy}
            onChange={(event) => setAutoContinue(event.target.checked)}
          />
          <span>
            <strong>自动继续</strong>
            <small>证据不足且仍有进展时，自动进入下一执行阶段。</small>
          </span>
        </label>

        {criteria.length > 0 && (
          <div className="conversation-goal-criteria-list" data-testid="conversation-goal-progress">
            {criteria.map((criterion) => (
              <div key={criterion.id} className={`is-${criterion.status}`}>
                <span className="conversation-goal-criterion-status" aria-hidden="true">
                  {criterion.status === "passed" ? "✓" : criterion.status === "failed" ? "!" : "·"}
                </span>
                <div>
                  <strong>{criterion.text}</strong>
                  <small>{KIND_LABELS[criterion.verificationKind] ?? "自动判断"}{criterion.detail ? ` · ${criterion.detail}` : ""}</small>
                  {developerMode && criterion.evidence?.length > 0 && (
                    <code>{criterion.evidence.join(" · ")}</code>
                  )}
                </div>
                <div className="conversation-goal-criterion-actions">
                  {developerMode && goal.status !== "completed" && (
                    <select
                      aria-label={`验证方式：${criterion.text}`}
                      value={criterion.verificationKind}
                      disabled={busy}
                      onChange={(event) => setCriterionKind(criterion, event.target.value)}
                    >
                      {Object.entries(KIND_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  )}
                  {criterion.verificationKind === "manual" && goal.status !== "completed" && (
                    <button
                      type="button"
                      data-testid="conversation-goal-manual-toggle"
                      disabled={busy}
                      onClick={() => toggleManual(criterion)}
                    >
                      {criterion.manualSatisfied ? "撤销确认" : "确认完成"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {goal?.lastVerification && (
          <p className={`conversation-goal-verification is-${goal.lastVerification.status}`}>
            {goal.lastVerification.verified
              ? "完成验证已通过。"
              : goal.lastVerification.reason || "仍缺少部分完成证据。"}
          </p>
        )}

        {error && <div className="conversation-goal-error">{error}</div>}

      </div>

      <div className="conversation-goal-actions conversation-goal-panel__footer">
        {goal && (
          <button
            type="button"
            className="is-secondary is-danger"
            data-testid="conversation-goal-clear"
            disabled={busy}
            onClick={() => { void save({ objective: "", nextCriteria: [] }); }}
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
            onClick={() => { void save({ status: "paused" }); }}
          >
            暂停
          </button>
        )}
        <button
          type="button"
          className="is-primary"
          data-testid="conversation-goal-save"
          disabled={busy || !objectiveDraft.trim()}
          onClick={() => { void save({ status: "active" }); }}
        >
          {goal?.status === "paused" || goal?.status === "completed"
            ? "恢复并保存"
            : goal ? "保存" : "设为 Goal"}
        </button>
      </div>
    </aside>
  );
}
