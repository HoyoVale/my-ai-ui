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
  createTaskSnapshot,
  describeToolTarget,
  formatTaskDuration,
  getToolTitle,
  stopReasonLabel,
  stringifyTaskValue,
  toolStatusLabel,
  toolStatusMark
} from "../utils/taskActivity.js";

function planStatusMark(status) {
  if (status === "completed") {
    return "✓";
  }

  if (status === "blocked") {
    return "!";
  }

  if (status === "skipped") {
    return "–";
  }

  return "";
}

function panelTimelineEvents(snapshot) {
  return snapshot.events.filter((event) => {
    if (["summary", "batch"].includes(event.type)) {
      return false;
    }

    if (
      event.type === "tool" &&
      [
        "update_plan",
        "ask_user",
        "report_progress"
      ].includes(event.tool?.name)
    ) {
      return false;
    }

    if (event.type !== "status") {
      return true;
    }

    return ["failed", "cancelled"].includes(event.status);
  });
}

export function ConversationTaskPanel({
  open,
  conversation,
  liveActivity,
  targetMessageId,
  developerMode,
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
  const firstToolId =
    snapshot.toolCalls[0]?.activityId ??
    snapshot.toolCalls[0]?.id ??
    null;

  useEffect(() => {
    setSelectedToolId(firstToolId);
  }, [snapshot.messageId, snapshot.runId, firstToolId]);

  if (!open) {
    return null;
  }

  const selectedTool =
    snapshot.toolCalls.find(
      (toolCall) =>
        (toolCall.activityId ?? toolCall.id) === selectedToolId
    ) ??
    snapshot.toolCalls[0] ??
    null;

  const events = panelTimelineEvents(snapshot);

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
                    snapshot.failed
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
                  <strong>{item.title}</strong>
                </div>
              ))}
            </div>
          </section>
        )}

        {developerMode && (
          <DeveloperActivity
            snapshot={snapshot}
            selectedTool={selectedTool}
            selectedToolId={selectedToolId}
            onSelectTool={setSelectedToolId}
          />
        )}
      </div>
    </aside>
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

  if (event.type === "question") {
    return (
      <div className="conversation-activity-timeline__event is-question">
        <span>
          <ConversationIcon name="activity" size={15} />
        </span>
        <div className="conversation-activity-timeline__copy">
          <strong>{event.question?.question ?? "等待你的回答"}</strong>
        </div>
      </div>
    );
  }

  return (
    <div className="conversation-activity-timeline__event is-status">
      <span>
        <ConversationIcon name="warning" size={15} />
      </span>
      <div className="conversation-activity-timeline__copy">
        <strong>{stopReasonLabel(event.stopReason)}</strong>
      </div>
    </div>
  );
}

function DeveloperActivity({
  snapshot,
  selectedTool,
  selectedToolId,
  onSelectTool
}) {
  return (
    <section className="conversation-activity-section conversation-activity-developer">
      <header className="conversation-activity-section__header">
        <h2>开发者</h2>
        <span>{snapshot.toolCalls.length} 个工具</span>
      </header>

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

      {snapshot.reasoning && (
        <details className="conversation-task-reasoning">
          <summary>模型推理文本</summary>
          <MarkdownContent content={snapshot.reasoning} compact />
        </details>
      )}

      {snapshot.stopReason && (
        <div className="conversation-task-stop-reason">
          {stopReasonLabel(snapshot.stopReason)} · {snapshot.stopReason}
        </div>
      )}
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
