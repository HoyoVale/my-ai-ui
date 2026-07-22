import {
  ConversationIcon
} from "./Icon.jsx";

import {
  MarkdownContent
} from "./MarkdownContent.jsx";

import {
  FileDiffPreview
} from "./FileDiff.jsx";

import {
  ToolCommandPreview
} from "./CommandOutput.jsx";

import {
  describeToolBatch,
  describeToolTarget,
  getToolTitle,
  stopReasonLabel
} from "../utils/taskActivity.js";

export function ActivityTimelineEvent({ event }) {
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
          <ToolCommandPreview tool={tool} compact />
          <FileDiffPreview
            change={tool?.result?.changePreview ? {
              id: tool.id,
              paths: tool.result.changePreview.paths?.length
                ? tool.result.changePreview.paths
                : tool.result.changePreview.path ? [tool.result.changePreview.path] : [],
              diff: tool.result.changePreview.diff,
              truncated: tool.result.changePreview.truncated
            } : null}
            compact
          />
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

