import {
  ConversationIcon
} from "./Icon.jsx";

import {
  getToolTitle
} from "../utils/taskActivity.js";

const ACTION_LABELS = Object.freeze({
  recheck: "重新核验",
  confirm_applied: "确认已生效",
  confirm_not_applied: "确认未生效",
  abandon: "放弃操作"
});

function formatUpdatedAt(value) {
  const date = new Date(Number(value ?? 0));
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function recoveryLabel(call) {
  if (call.recovery === "needs_confirmation") {
    return "需要确认是否已生效";
  }
  if (call.recovery === "needs_reconciliation") {
    return "需要重新核验实际状态";
  }
  if (call.hasReceipt) {
    return "已有执行收据";
  }
  return call.publicStatus || call.state || "已处理";
}

export function ConversationRecoveryPanel({
  open,
  history,
  loading = false,
  busy = "",
  error = "",
  developerMode = false,
  onRefresh,
  onAction,
  onOpenTask,
  onClose
}) {
  if (!open || !developerMode) {
    return null;
  }

  const items = history?.items ?? [];
  const unresolved = items.filter(
    (item) => Number(item.recovery?.unresolvedCount ?? 0) > 0
  );
  const resolved = items.filter(
    (item) => Number(item.recovery?.unresolvedCount ?? 0) === 0
  );

  return (
    <aside
      className="conversation-recovery-panel"
      data-testid="conversation-recovery-panel"
    >
      <header className="conversation-recovery-panel__header">
        <div>
          <strong>Tool Runtime 恢复</strong>
          <span>
            {history?.unresolvedCount > 0
              ? `${history.unresolvedCount} 个状态不确定的操作待处理`
              : "开发者诊断 · 当前没有待处理操作"}
          </span>
        </div>
        <div>
          <button
            type="button"
            className="conversation-icon-button"
            title="刷新"
            aria-label="刷新恢复中心"
            disabled={loading}
            onClick={() => void onRefresh?.()}
          >
            <ConversationIcon name="activity" size={15} />
          </button>
          <button
            type="button"
            className="conversation-inspector__close"
            title="关闭"
            aria-label="关闭恢复中心"
            onClick={onClose}
          >
            <ConversationIcon name="close" size={17} />
          </button>
        </div>
      </header>

      <div className="conversation-recovery-panel__scroll">
        {loading && items.length === 0 && (
          <p className="conversation-recovery-panel__empty">正在读取恢复记录…</p>
        )}

        {!loading && unresolved.length === 0 && (
          <div className="conversation-recovery-panel__clear">
            <span><ConversationIcon name="check" size={17} /></span>
            <div>
              <strong>运行状态正常</strong>
              <small>没有需要人工核验或确认的工具操作。</small>
            </div>
          </div>
        )}

        {unresolved.map((item) => (
          <RecoveryHistoryItem
            key={item.taskId}
            item={item}
            busy={busy}
            developerMode={developerMode}
            onAction={onAction}
            onOpenTask={onOpenTask}
          />
        ))}

        {resolved.length > 0 && (
          <details className="conversation-recovery-panel__history">
            <summary>已处理记录 · {resolved.length}</summary>
            <div>
              {resolved.slice(0, 20).map((item) => (
                <RecoveryHistoryItem
                  key={item.taskId}
                  item={item}
                  busy={busy}
                  developerMode={developerMode}
                  onAction={onAction}
                  onOpenTask={onOpenTask}
                  resolved
                />
              ))}
            </div>
          </details>
        )}

        {error && (
          <p className="conversation-recovery-panel__error">{error}</p>
        )}
      </div>
    </aside>
  );
}

function RecoveryHistoryItem({
  item,
  busy,
  developerMode,
  onAction,
  onOpenTask,
  resolved = false
}) {
  const calls = item.recovery?.calls ?? [];
  const visibleCalls = resolved
    ? calls.slice(-4)
    : calls.filter((call) => [
        "needs_confirmation",
        "needs_reconciliation"
      ].includes(call.recovery));

  return (
    <article
      className={`conversation-recovery-item${resolved ? " is-resolved" : ""}`}
      data-task-id={developerMode ? item.taskId : undefined}
    >
      <header>
        <div>
          <strong>{item.conversationTitle || "会话任务"}</strong>
          <small>
            {item.mode === "coding" ? "Coding" : "Chat"}
            {item.workspaceName ? ` · ${item.workspaceName}` : ""}
            {formatUpdatedAt(item.updatedAt) ? ` · ${formatUpdatedAt(item.updatedAt)}` : ""}
          </small>
        </div>
        <button
          type="button"
          onClick={() => void onOpenTask?.(item)}
        >
          查看活动
        </button>
      </header>

      <div className="conversation-recovery-item__calls">
        {visibleCalls.map((call) => (
          <div
            className="conversation-recovery-item__call"
            key={call.callId || `${call.toolName}:${call.state}`}
          >
            <div>
              <strong>{getToolTitle(call.toolName)}</strong>
              <small>{recoveryLabel(call)}</small>
              {developerMode && call.callId && <code>{call.callId}</code>}
            </div>

            {!resolved && (call.actions ?? []).length > 0 && (
              <div className="conversation-recovery-item__actions">
                {(call.actions ?? []).map((action) => {
                  const token = `${item.taskId}:${call.callId}:${action}`;
                  return (
                    <button
                      type="button"
                      key={action}
                      disabled={Boolean(busy)}
                      data-testid={`recovery-history-${action}`}
                      onClick={() => void onAction?.({
                        taskId: item.taskId,
                        callId: call.callId,
                        action
                      })}
                    >
                      {busy === token
                        ? "处理中…"
                        : ACTION_LABELS[action] ?? action}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}
