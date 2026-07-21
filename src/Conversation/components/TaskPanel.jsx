import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  ConversationIcon
} from "./Icon.jsx";

import {
  MarkdownContent
} from "./MarkdownContent.jsx";

import {
  createActivitySnapshot,
  createTaskSnapshot,
  describeToolBatch,
  describeToolTarget,
  formatTaskDuration,
  getToolTitle,
  groupToolActivityEvents,
  isActivityEventVisible,
  stopReasonLabel,
  stringifyTaskValue,
  toolStatusLabel,
  toolStatusMark
} from "../utils/taskActivity.js";

function planStatusMark(status) {
  if (status === "completed") {
    return "✓";
  }

  if (["blocked", "needs_input"].includes(status)) {
    return "!";
  }

  if (["skipped", "cancelled", "superseded"].includes(status)) {
    return "–";
  }

  return "";
}

function panelTimelineEvents(snapshot, developerMode = false) {
  return snapshot.events.filter((event) => {
    if (!isActivityEventVisible(event, { developerMode })) {
      return false;
    }

    if (["summary", "batch"].includes(event.type)) {
      return false;
    }

    if (event.type !== "status") {
      return true;
    }

    return developerMode ||
      ["failed", "cancelled", "interrupted", "attention"].includes(event.status);
  });
}

export function ConversationTaskPanel({
  open,
  conversation,
  liveActivity,
  targetMessageId,
  developerMode,
  onLoadRecovery,
  onLoadDeveloperDetails,
  onRecoveryAction,
  onClose
}) {
  const snapshot = useMemo(
    () =>
      createTaskSnapshot({
        conversation,
        liveActivity,
        targetMessageId
      }),
    [conversation, liveActivity, targetMessageId]
  );

  const [selectedToolId, setSelectedToolId] = useState(null);
  const [runtimeRecovery, setRuntimeRecovery] = useState(null);
  const [recoveryBusy, setRecoveryBusy] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [developerDetails, setDeveloperDetails] = useState(null);
  const [developerLoading, setDeveloperLoading] = useState(false);
  const [developerError, setDeveloperError] = useState("");
  const firstToolId =
    snapshot.toolCalls[0]?.activityId ??
    snapshot.toolCalls[0]?.id ??
    null;

  useEffect(() => {
    setSelectedToolId(firstToolId);
  }, [snapshot.messageId, snapshot.runId, firstToolId]);

  useEffect(() => {
    setRuntimeRecovery(snapshot.runtimeRecovery ?? null);
    setRecoveryBusy("");
    setRecoveryError("");
  }, [snapshot.taskId, snapshot.messageId, snapshot.runtimeRecovery]);

  useEffect(() => {
    setDeveloperDetails(null);
    setDeveloperLoading(false);
    setDeveloperError("");
  }, [snapshot.taskId, snapshot.runId, snapshot.messageId, developerMode]);

  useEffect(() => {
    if (!open || !snapshot.taskId || !snapshot.runtimeRecovery?.unresolvedCount) {
      return undefined;
    }

    let disposed = false;
    const request = onLoadRecovery?.(snapshot.taskId);
    if (!request || typeof request.then !== "function") {
      return undefined;
    }
    request.then((result) => {
        if (!disposed && result?.ok && result.recovery) {
          setRuntimeRecovery(result.recovery);
        }
      })
      .catch((error) => {
        if (!disposed) {
          setRecoveryError(
            error instanceof Error ? error.message : String(error)
          );
        }
      });

    return () => {
      disposed = true;
    };
  }, [
    open,
    onLoadRecovery,
    snapshot.taskId,
    snapshot.runtimeRecovery?.unresolvedCount
  ]);

  const handleRecoveryAction = async (call, action) => {
    if (!snapshot.taskId || !call?.callId || !action || recoveryBusy) {
      return;
    }

    const confirmations = {
      confirm_applied: "确认该工具操作已经生效？确认后不会再次执行。",
      confirm_not_applied: "确认该工具操作没有生效？之后继续任务时允许重新执行。",
      abandon: "放弃该工具操作？该调用会被记为已取消。"
    };
    if (confirmations[action] && !window.confirm(confirmations[action])) {
      return;
    }

    setRecoveryBusy(`${call.callId}:${action}`);
    setRecoveryError("");
    try {
      const result = await onRecoveryAction?.({
        taskId: snapshot.taskId,
        callId: call.callId,
        action
      });
      if (!result?.ok) {
        throw new Error(result?.message ?? "恢复操作失败。请稍后重试。");
      }
      if (result.recovery) {
        setRuntimeRecovery(result.recovery);
      }
    } catch (error) {
      setRecoveryError(
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setRecoveryBusy("");
    }
  };


  const loadDeveloperDetails = async () => {
    if (
      !developerMode ||
      developerLoading ||
      (!snapshot.taskId && !snapshot.runId)
    ) {
      return;
    }

    setDeveloperLoading(true);
    setDeveloperError("");
    try {
      const result = await onLoadDeveloperDetails?.({
        taskId: snapshot.taskId,
        runId: snapshot.runId
      });
      if (!result?.ok || !result.details) {
        throw new Error(result?.message ?? "读取运行诊断失败。");
      }
      setDeveloperDetails(result.details);
    } catch (error) {
      setDeveloperError(
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setDeveloperLoading(false);
    }
  };

  if (!open) {
    return null;
  }

  const developerSnapshot = developerDetails
    ? createActivitySnapshot(developerDetails, {
        conversation,
        live: developerDetails.state !== "historical"
      })
    : null;
  const developerToolCalls = developerSnapshot?.toolCalls ?? snapshot.toolCalls;
  const selectedTool =
    developerToolCalls.find(
      (toolCall) =>
        (toolCall.activityId ?? toolCall.id) === selectedToolId
    ) ??
    developerToolCalls[0] ??
    null;

  const events = groupToolActivityEvents(
    panelTimelineEvents(snapshot, developerMode)
  );

  return (
    <aside
      className="conversation-task-panel conversation-activity-panel"
      data-testid="conversation-task-panel"
      data-developer-mode={developerMode}
      data-message-id={snapshot.messageId}
      data-run-id={snapshot.runId}
    >
      <header className="conversation-activity-panel__header">
        <div>
          <strong>活动</strong>
          {snapshot.durationMs > 0 && (
            <span>· {formatTaskDuration(snapshot.durationMs)}</span>
          )}
        </div>

        <button
          type="button"
          className="conversation-inspector__close"
          aria-label="关闭活动面板"
          title="关闭"
          onClick={onClose}
        >
          <ConversationIcon name="close" size={17} />
        </button>
      </header>

      <div className="conversation-task-panel__scroll conversation-activity-panel__scroll">
        {runtimeRecovery?.unresolvedCount > 0 && (
          <RecoveryCenter
            recovery={runtimeRecovery}
            busy={recoveryBusy}
            error={recoveryError}
            developerMode={developerMode}
            onAction={handleRecoveryAction}
          />
        )}

        <section className="conversation-activity-section">
          <h2>思考</h2>

          <div className="conversation-activity-timeline">
            {events.map((event) => (
              <ActivityTimelineEvent
                event={event}
                key={event.id}
              />
            ))}

            <div className="conversation-activity-timeline__end">
              <span>
                <ConversationIcon
                  name={
                    snapshot.failed || snapshot.interrupted
                      ? "warning"
                      : snapshot.aborted
                        ? "minus"
                        : "check"
                  }
                  size={15}
                />
              </span>
              <div>
                <strong>
                  {snapshot.running
                    ? "正在思考"
                    : snapshot.interrupted
                      ? "上次执行被中断"
                      : snapshot.durationMs > 0
                        ? `思考了 ${formatTaskDuration(snapshot.durationMs)}`
                        : stopReasonLabel(snapshot.stopReason)}
                </strong>
                {snapshot.failed && (
                  <small>{stopReasonLabel(snapshot.stopReason)}</small>
                )}
              </div>
            </div>
          </div>
        </section>

        {snapshot.plan.length > 0 && (
          <section className="conversation-activity-section">
            <header className="conversation-activity-section__header">
              <h2>计划</h2>
              <span>
                {snapshot.planStats.completed}/{snapshot.planStats.total}
              </span>
            </header>

            <div className="conversation-activity-plan">
              {snapshot.plan.map((item, index) => (
                <div
                  className={`conversation-activity-plan__row is-${item.status}`}
                  key={item.id ?? `${item.title}-${index}`}
                >
                  <span>{planStatusMark(item.status)}</span>
                  <div>
                    <strong>{item.title}</strong>
                    {item.reason && <small>{item.reason}</small>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {developerMode && (
          <DeveloperActivity
            snapshot={developerSnapshot ?? snapshot}
            detailsLoaded={Boolean(developerSnapshot)}
            loading={developerLoading}
            error={developerError}
            selectedTool={selectedTool}
            selectedToolId={selectedToolId}
            onLoad={() => void loadDeveloperDetails()}
            onSelectTool={setSelectedToolId}
          />
        )}
      </div>
    </aside>
  );
}

const RECOVERY_ACTION_LABELS = Object.freeze({
  recheck: "重新核验",
  confirm_applied: "确认已生效",
  confirm_not_applied: "确认未生效",
  abandon: "放弃操作"
});

function RecoveryCenter({
  recovery,
  busy,
  error,
  developerMode,
  onAction
}) {
  const unresolvedCalls = (recovery.calls ?? []).filter((call) =>
    ["needs_confirmation", "needs_reconciliation"].includes(call.recovery)
  );

  return (
    <section
      className="conversation-runtime-recovery"
      data-testid="tool-runtime-recovery"
    >
      <header className="conversation-runtime-recovery__header">
        <span>
          <ConversationIcon name="warning" size={15} />
        </span>
        <div>
          <strong>
            {recovery.needsConfirmation > 0
              ? "有工具操作需要确认"
              : "有工具操作需要核验"}
          </strong>
          <small>
            先处理这些不确定操作，再继续任务，避免重复写入。
          </small>
        </div>
      </header>

      <div className="conversation-runtime-recovery__calls">
        {unresolvedCalls.map((call) => (
          <article
            className="conversation-runtime-recovery__call"
            key={call.callId}
            data-call-id={developerMode ? call.callId : undefined}
          >
            <div className="conversation-runtime-recovery__copy">
              <strong>{getToolTitle(call.toolName)}</strong>
              <small>
                {call.recovery === "needs_confirmation"
                  ? "无法自动判断该操作是否已经生效。"
                  : "需要查询实际状态后才能安全继续。"}
              </small>
              {developerMode && (
                <code>{call.callId}</code>
              )}
            </div>

            <div className="conversation-runtime-recovery__actions">
              {(call.actions ?? []).map((action) => (
                <button
                  type="button"
                  key={action}
                  disabled={Boolean(busy)}
                  data-testid={`runtime-recovery-${action}`}
                  onClick={() => {
                    void onAction(call, action);
                  }}
                >
                  {busy === `${call.callId}:${action}`
                    ? "处理中…"
                    : RECOVERY_ACTION_LABELS[action] ?? action}
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>

      {error && (
        <p className="conversation-runtime-recovery__error">{error}</p>
      )}
    </section>
  );
}

function ActivityTimelineEvent({ event }) {
  if (event.type === "commentary") {
    return (
      <div
        className="conversation-activity-timeline__event is-commentary"
        data-batch-id={event.batchId || undefined}
      >
        <span>
          <ConversationIcon name="activity" size={15} />
        </span>
        <div className="conversation-activity-timeline__copy">
          <MarkdownContent content={event.content} compact />
        </div>
      </div>
    );
  }

  if (event.type === "skill") {
    const skill = event.skill ?? {};
    const detail = skill.missingRequired?.length
      ? `缺少能力：${skill.missingRequired.join("、")}`
      : skill.selectedToolNames?.length
        ? `实际工具：${skill.selectedToolNames.join("、")}`
        : `版本 ${skill.version || "-"}`;
    return (
      <div className={`conversation-activity-timeline__event is-skill is-${event.status ?? "running"}`}>
        <span><ConversationIcon name="activity" size={15} /></span>
        <div className="conversation-activity-timeline__copy">
          <strong>{event.title || `Skill · ${skill.name ?? skill.id}`}</strong>
          <small>{detail}</small>
        </div>
      </div>
    );
  }

  if (event.type === "tool_batch") {
    return (
      <details
        className={`conversation-activity-tool-batch is-${event.status}`}
        data-batch-id={event.batchId || undefined}
      >
        <summary>
          <span>
            <ConversationIcon name="tool" size={15} />
          </span>
          <strong>{describeToolBatch(event)}</strong>
          <ConversationIcon name="chevron" size={13} />
        </summary>
        <div className="conversation-activity-tool-batch__items">
          {event.events.map((toolEvent) => (
            <ActivityTimelineEvent
              event={toolEvent}
              key={toolEvent.id}
            />
          ))}
        </div>
      </details>
    );
  }

  if (event.type === "tool") {
    const tool = event.tool;
    const target = describeToolTarget(tool);
    const summary = tool?.result?.summary;

    return (
      <div
        className={`conversation-activity-timeline__event is-tool is-${tool?.status ?? event.status}`}
        data-batch-id={event.batchId || tool?.batchId || undefined}
      >
        <span>
          <ConversationIcon name="tool" size={15} />
        </span>
        <div className="conversation-activity-timeline__copy">
          <strong>{getToolTitle(tool)}</strong>
          {(summary || target) && (
            <small>{summary || target}</small>
          )}
        </div>
      </div>
    );
  }

  if (event.type === "plan") {
    return (
      <div
        className="conversation-activity-timeline__event is-plan"
        data-batch-id={event.batchId || undefined}
      >
        <span>
          <ConversationIcon name="activity" size={15} />
        </span>
        <div className="conversation-activity-timeline__copy">
          <strong>{event.title || "更新了任务计划"}</strong>
        </div>
      </div>
    );
  }

  return (
    <div className="conversation-activity-timeline__event is-status">
      <span>
        <ConversationIcon
          name={
            ["failed", "interrupted"].includes(event.status)
              ? "warning"
              : event.status === "cancelled"
                ? "minus"
                : "activity"
          }
          size={15}
        />
      </span>
      <div className="conversation-activity-timeline__copy">
        <strong>{event.title || stopReasonLabel(event.stopReason)}</strong>
      </div>
    </div>
  );
}

function DeveloperActivity({
  snapshot,
  detailsLoaded,
  loading,
  error,
  selectedTool,
  selectedToolId,
  onLoad,
  onSelectTool
}) {
  return (
    <section className="conversation-activity-section conversation-activity-developer">
      <header className="conversation-activity-section__header">
        <h2>开发者</h2>
        <span>{detailsLoaded ? `${snapshot.toolCalls.length} 个工具` : "按需加载"}</span>
      </header>

      {!detailsLoaded && (
        <div className="conversation-activity-developer__loader">
          <div>
            <strong>运行诊断尚未载入</strong>
            <small>原始工具输入、结果、内部 ID 与 Runtime 诊断只在请求后读取。</small>
          </div>
          <button
            type="button"
            data-testid="conversation-load-run-details"
            disabled={loading}
            onClick={onLoad}
          >
            {loading ? "读取中…" : "加载诊断详情"}
          </button>
          {error && <p>{error}</p>}
        </div>
      )}

      {detailsLoaded && (<>
      <dl className="conversation-activity-identifiers">
        <div>
          <dt>Message</dt>
          <dd>{snapshot.messageId || "live"}</dd>
        </div>
        <div>
          <dt>Run</dt>
          <dd>{snapshot.runId || "unknown"}</dd>
        </div>
        <div>
          <dt>Task</dt>
          <dd>{snapshot.taskId || "unknown"}</dd>
        </div>
      </dl>

      {snapshot.runtimeDiagnostics?.calls?.length > 0 && (
        <RawDetail
          title="Runtime recovery"
          value={stringifyTaskValue(snapshot.runtimeDiagnostics)}
          code
        />
      )}

      {snapshot.providerRuntimeDiagnostics && (
        <RawDetail
          title="Provider / Tool circuit breakers"
          value={stringifyTaskValue(snapshot.providerRuntimeDiagnostics)}
          code
        />
      )}

      {snapshot.toolCalls.length > 0 && (
        <div className="conversation-developer-tool-list">
          {snapshot.toolCalls.map((toolCall) => {
            const id = toolCall.activityId ?? toolCall.id;

            return (
              <button
                type="button"
                className={selectedToolId === id ? "is-selected" : ""}
                key={id}
                onClick={() => onSelectTool(id)}
              >
                <span className={`conversation-tool-mark is-${toolCall.status}`}>
                  {toolStatusMark(toolCall.status)}
                </span>
                <span>
                  <strong>{getToolTitle(toolCall)}</strong>
                  <small>{toolCall.name}</small>
                </span>
                <em>
                  {toolCall.durationMs
                    ? formatTaskDuration(toolCall.durationMs)
                    : toolStatusLabel(toolCall.status)}
                </em>
              </button>
            );
          })}
        </div>
      )}

      {selectedTool && <ToolDetails toolCall={selectedTool} />}

      {snapshot.stopReason && (
        <div className="conversation-task-stop-reason">
          {stopReasonLabel(snapshot.stopReason)} · {snapshot.stopReason}
        </div>
      )}
      </>)}
    </section>
  );
}

function ToolDetails({ toolCall }) {
  const target = describeToolTarget(toolCall);

  return (
    <section className="conversation-task-tool-detail">
      <div className="conversation-task-section__title">
        <strong>工具详情</strong>
        <span>{toolStatusLabel(toolCall.status)}</span>
      </div>

      <div className="conversation-task-tool-detail__summary">
        <strong>{getToolTitle(toolCall)}</strong>
        {target && <code>{target}</code>}
        {toolCall.batchObjective && (
          <p>工具批次：{toolCall.batchObjective}</p>
        )}
        {toolCall.planStep?.title && (
          <p>计划步骤：{toolCall.planStep.title}</p>
        )}
        {toolCall.result?.summary && (
          <p className="conversation-task-tool-result-summary">
            {toolCall.result.summary}
          </p>
        )}
        {toolCall.result?.truncated && (
          <span className="conversation-task-tool-result-note">
            结果已截断
            {toolCall.result.originalBytes
              ? ` · 原始 ${toolCall.result.originalBytes} bytes`
              : ""}
          </span>
        )}
      </div>

      <div className="conversation-task-raw-details">
        <RawDetail title="Tool" value={toolCall.name} />
        <RawDetail title="Batch" value={toolCall.batchId || "none"} />

        {toolCall.runtime !== undefined && (
          <RawDetail
            title="Runtime state"
            value={stringifyTaskValue(toolCall.runtime)}
            code
          />
        )}

        {toolCall.runtimeContract !== undefined && (
          <RawDetail
            title="Runtime contract"
            value={stringifyTaskValue(toolCall.runtimeContract)}
            code
          />
        )}

        {toolCall.input !== undefined && (
          <RawDetail
            title="Input"
            value={stringifyTaskValue(toolCall.input)}
            code
          />
        )}

        {toolCall.result !== undefined && (
          <RawDetail
            title="Result"
            value={stringifyTaskValue(toolCall.result)}
            code
          />
        )}

        {toolCall.output !== undefined && (
          <RawDetail
            title="Model output"
            value={stringifyTaskValue(toolCall.output)}
            code
          />
        )}
      </div>
    </section>
  );
}

function RawDetail({ title, value, code = false }) {
  return (
    <details className="conversation-task-raw-detail">
      <summary>
        <span>{title}</span>
        <ConversationIcon name="chevron" size={13} />
      </summary>

      {code ? <pre>{value}</pre> : <code>{value}</code>}
    </details>
  );
}
