import {
  ConversationIcon
} from "./Icon.jsx";

import {
  MarkdownContent
} from "./MarkdownContent.jsx";

import {
  ToolActivityCard
} from "./ToolActivityCard.jsx";

import {
  createUserTaskViewModel
} from "./userTaskViewModel.js";

import {
  createActivitySnapshot,
  describeToolBatch,
  groupToolActivityEvents,
  isActivityEventVisible,
  stopReasonLabel
} from "../utils/taskActivity.js";

function visibleTimelineEvents(snapshot, developerMode = false) {
  return snapshot.events.filter((event) => {
    if (!isActivityEventVisible(event, { developerMode })) {
      return false;
    }

    if (["batch", "plan"].includes(event.type)) {
      return false;
    }

    if (event.type !== "status") {
      return true;
    }

    return developerMode ||
      ["failed", "cancelled", "interrupted"].includes(event.status);
  });
}

function TaskStateMark({ state }) {
  const icon = state === "failed"
    ? "warning"
    : state === "cancelled"
      ? "minus"
      : state === "completed"
        ? "check"
        : null;

  return (
    <span className={`conversation-task-state-mark is-${state}`}>
      {icon
        ? <ConversationIcon name={icon} size={12} />
        : <span />}
    </span>
  );
}

function ThinkingTimeline({
  snapshot,
  live = false,
  stopping = false,
  liveText = "",
  onOpenTaskPanel,
  developerMode = false
}) {
  const events = groupToolActivityEvents(
    visibleTimelineEvents(snapshot, developerMode)
  );
  const view = createUserTaskViewModel(snapshot, {
    live,
    stopping
  });

  if (!live && events.length === 0 && !String(liveText).trim()) {
    return null;
  }

  return (
    <details
      className={[
        "conversation-thinking-timeline",
        live ? "is-live" : "",
        snapshot.failed ? "is-error" : "",
        snapshot.aborted ? "is-aborted" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      open={live || undefined}
      data-testid="conversation-thinking-timeline"
      data-message-id={snapshot.messageId}
      data-run-id={snapshot.runId}
      data-task-state={view.state}
    >
      <summary>
        <TaskStateMark state={view.state} />
        <span className="conversation-thinking-timeline__summary-copy">
          <strong>{view.label}</strong>
          {view.detail && <small>{view.detail}</small>}
        </span>
        <ConversationIcon name="chevron" size={13} />
      </summary>

      <div className="conversation-thinking-timeline__content">
        {events.length === 0 && !String(liveText).trim() ? (
          <div className="conversation-thinking-timeline__pending">
            <span />
            <strong>
              {stopping ? "正在保存当前进度" : "正在准备下一步"}
            </strong>
          </div>
        ) : (
          <>
            {events.map((event) => (
              <TimelineEvent
                event={event}
                key={event.id}
                onOpenTaskPanel={onOpenTaskPanel}
                developerMode={developerMode}
              />
            ))}
            {String(liveText).trim() && (
              <div
                className="conversation-thinking-event conversation-thinking-event--commentary is-streaming"
                data-testid="conversation-live-step-text"
              >
                <MarkdownContent content={liveText} compact />
              </div>
            )}
          </>
        )}

        {developerMode && onOpenTaskPanel && (
          <button
            type="button"
            className="conversation-thinking-timeline__panel-link"
            onClick={onOpenTaskPanel}
          >
            查看开发者详情
            <ConversationIcon name="chevronRight" size={12} />
          </button>
        )}
      </div>
    </details>
  );
}

function TimelineEvent({
  event,
  onOpenTaskPanel,
  developerMode = false
}) {
  if (event.type === "commentary") {
    return (
      <div
        className={`conversation-thinking-event conversation-thinking-event--commentary is-${event.phase ?? "between_tools"}`}
        data-batch-id={event.batchId || undefined}
      >
        <MarkdownContent content={event.content} compact />
      </div>
    );
  }

  if (event.type === "skill") {
    const skill = event.skill ?? {};
    const detail = skill.missingRequired?.length
      ? `缺少 ${skill.missingRequired.length} 项能力`
      : skill.selectedToolNames?.length
        ? `使用 ${skill.selectedToolNames.length} 个工具`
        : `v${skill.version || ""}`;

    return (
      <button
        type="button"
        className={`conversation-thinking-event conversation-thinking-event--skill is-${event.status ?? "running"}`}
        onClick={developerMode ? onOpenTaskPanel : undefined}
      >
        <ConversationIcon name="activity" size={16} />
        <span>
          <strong>{event.title || `Skill · ${skill.name ?? skill.id}`}</strong>
          <small>{detail}</small>
        </span>
      </button>
    );
  }

  if (event.type === "tool_batch") {
    const expanded = ["running", "queued", "error", "attention"].includes(event.status);

    return (
      <details
        className={`conversation-thinking-tool-batch is-${event.status}`}
        data-batch-id={event.batchId || undefined}
        open={expanded || undefined}
      >
        <summary>
          <ConversationIcon name="tool" size={16} />
          <strong>{describeToolBatch(event)}</strong>
          <ConversationIcon name="chevron" size={13} />
        </summary>
        <div className="conversation-thinking-tool-batch__items">
          {event.events.map((toolEvent) => (
            <TimelineEvent
              event={toolEvent}
              key={toolEvent.id}
              onOpenTaskPanel={onOpenTaskPanel}
              developerMode={developerMode}
            />
          ))}
        </div>
      </details>
    );
  }

  if (event.type === "tool") {
    return (
      <ToolActivityCard
        tool={event.tool}
        compact
        developerMode={developerMode}
      />
    );
  }

  if (event.type === "plan") {
    return (
      <button
        type="button"
        className="conversation-thinking-event conversation-thinking-event--plan"
        data-batch-id={event.batchId || undefined}
        onClick={onOpenTaskPanel}
      >
        <ConversationIcon name="activity" size={16} />
        <strong>{event.title || "更新了任务计划"}</strong>
      </button>
    );
  }

  return (
    <div className="conversation-thinking-event conversation-thinking-event--status">
      <span>{event.title || stopReasonLabel(event.stopReason)}</span>
    </div>
  );
}

export function LiveAgentActivity({
  activity,
  developerMode,
  onOpenTaskPanel
}) {
  const snapshot = createActivitySnapshot(activity, { live: true });
  const finalCandidateText = activity.liveStepRole === "final_candidate"
    ? String(activity.liveStepText ?? "")
    : "";
  const displayedFinalText = String(activity.finalText ?? "").trim()
    ? String(activity.finalText ?? "")
    : finalCandidateText;

  return (
    <article
      className="conversation-message conversation-message--assistant conversation-message--live"
      data-testid="conversation-live-agent-activity"
      data-developer-mode={developerMode}
    >
      <div className="conversation-message__content">
        <div className="conversation-agent-activity is-live">
          <ThinkingTimeline
            snapshot={snapshot}
            live
            liveText={
              activity.liveStepRole === "final_candidate"
                ? ""
                : activity.liveStepText ?? ""
            }
            stopping={["stopping", "cancelling"].includes(activity.state)}
            onOpenTaskPanel={onOpenTaskPanel}
            developerMode={developerMode}
          />

          {String(displayedFinalText).trim() && (
            <div className="conversation-message__body conversation-message__body--live">
              <MarkdownContent content={displayedFinalText} />
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function AssistantActivity({
  message,
  developerMode,
  onOpenTaskPanel
}) {
  const snapshot = createActivitySnapshot(message);

  if (visibleTimelineEvents(snapshot, developerMode).length === 0) {
    return null;
  }

  return (
    <div
      className="conversation-agent-activity"
      data-developer-mode={developerMode}
    >
      <ThinkingTimeline
        snapshot={snapshot}
        developerMode={developerMode}
        onOpenTaskPanel={onOpenTaskPanel}
      />
    </div>
  );
}
