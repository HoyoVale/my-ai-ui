import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  ConversationIcon
} from "./Icon.jsx";

import {
  ActivityTimelineEvent
} from "./TaskActivityTimeline.jsx";

import {
  DeveloperActivity
} from "./DeveloperActivityPanel.jsx";

import {
  panelTimelineEvents
} from "./taskPanelModel.js";

import {
  createActivitySnapshot,
  createTaskSnapshot,
  formatTaskDuration,
  groupToolActivityEvents,
  stopReasonLabel
} from "../utils/taskActivity.js";

export function ConversationTaskPanel({
  open,
  conversation,
  liveActivity,
  targetMessageId,
  developerMode,
  onLoadDeveloperDetails,
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
    setDeveloperDetails(null);
    setDeveloperLoading(false);
    setDeveloperError("");
  }, [snapshot.taskId, snapshot.runId, snapshot.messageId, developerMode]);

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
              <div className="conversation-activity-section__title-row">
                <h2>计划</h2>
                {snapshot.planAdjusted && (
                  <em className="conversation-plan-adjusted-badge">计划已调整</em>
                )}
              </div>
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

