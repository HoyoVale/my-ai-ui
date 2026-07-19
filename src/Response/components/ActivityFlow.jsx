import {
  ConversationIcon
} from "../../Conversation/components/Icon.jsx";

import {
  MarkdownContent
} from "../../Conversation/components/MarkdownContent.jsx";

import {
  StreamingMarkdown
} from "./StreamingMarkdown.jsx";

import {
  createActivitySnapshot,
  describeToolBatch,
  getToolTitle,
  groupToolActivityEvents,
  isActivityEventVisible
} from "../../Conversation/utils/taskActivity.js";

function visibleEvents(snapshot) {
  return groupToolActivityEvents(
    snapshot.events.filter((event) => {
      if (!isActivityEventVisible(event)) {
        return false;
      }

      return [
        "commentary",
        "tool"
      ].includes(event.type);
    })
  ).slice(-5);
}

function statusClass(status) {
  if (["failed", "error"].includes(status)) {
    return "is-error";
  }

  if (["running", "queued", "retrying", "in_progress"].includes(status)) {
    return "is-running";
  }

  if (["cancelled", "aborted"].includes(status)) {
    return "is-cancelled";
  }

  return "is-complete";
}

function FlowEvent({ event }) {
  if (event.type === "commentary") {
    return (
      <div className="response-activity__event is-commentary">
        <span className="response-activity__mark">
          <ConversationIcon name="activity" size={13} />
        </span>
        <div className="response-activity__commentary">
          <MarkdownContent
            content={event.content}
            compact
          />
        </div>
      </div>
    );
  }

  if (event.type === "tool_batch") {
    return (
      <div className={`response-activity__event ${statusClass(event.status)}`}>
        <span className="response-activity__mark">
          <ConversationIcon name="tool" size={13} />
        </span>
        <strong>{describeToolBatch(event)}</strong>
      </div>
    );
  }

  const tool = event.tool;

  return (
    <div className={`response-activity__event ${statusClass(tool?.status ?? event.status)}`}>
      <span className="response-activity__mark">
        <ConversationIcon name="tool" size={13} />
      </span>
      <strong>{getToolTitle(tool)}</strong>
    </div>
  );
}

export function ResponseActivityFlow({
  status,
  streaming,
  liveText = ""
}) {
  if (!status?.runId) {
    return null;
  }

  const snapshot =
    createActivitySnapshot(
      status,
      {
        live: streaming
      }
    );

  const events = visibleEvents(snapshot);
  const hasPlan =
    snapshot.planStats.total > 0;
  const hasLiveText =
    Boolean(String(liveText).trim());

  if (
    events.length === 0 &&
    !hasPlan &&
    !hasLiveText
  ) {
    return (
      <section
        className="response-activity"
        data-testid="response-activity-flow"
      >
        <div className="response-activity__header">
          <span className="response-activity__pulse" />
          <strong>正在准备</strong>
        </div>
      </section>
    );
  }

  return (
    <section
      className="response-activity"
      data-testid="response-activity-flow"
    >
      <div className="response-activity__header">
        <span className={streaming ? "response-activity__pulse" : "response-activity__done"}>
          {!streaming && (
            <ConversationIcon name="check" size={11} />
          )}
        </span>
        <strong>
          {streaming ? "正在处理" : "处理完成"}
        </strong>
        {hasPlan && (
          <small>
            {snapshot.planStats.completed}/{snapshot.planStats.total}
          </small>
        )}
      </div>

      {hasPlan && (
        <div className="response-activity__progress" aria-hidden="true">
          <span
            style={{
              width: `${Math.round(snapshot.planStats.ratio * 100)}%`
            }}
          />
        </div>
      )}

      {events.length > 0 && (
        <div className="response-activity__events">
          {events.map((event) => (
            <FlowEvent
              event={event}
              key={event.id}
            />
          ))}
        </div>
      )}

      {hasLiveText && (
        <div
          className="response-activity__live"
          data-testid="response-live-step-text"
        >
          <StreamingMarkdown
            content={liveText}
            compact
            cursor={streaming}
          />
        </div>
      )}
    </section>
  );
}
