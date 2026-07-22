import {
  ConversationIcon
} from "./Icon.jsx";

import {
  FileDiffPreview
} from "./FileDiff.jsx";

import {
  ToolCommandPreview
} from "./CommandOutput.jsx";

import {
  createToolActivityView
} from "./toolActivityModel.js";

function ToolStatusMark({ view }) {
  return (
    <span
      className={`conversation-tool-card__status is-${view.status}`}
      aria-label={view.statusText}
    >
      {view.failed || view.attention
        ? "!"
        : view.aborted
          ? "–"
          : view.running
            ? ""
            : "✓"}
    </span>
  );
}

function ToolIcon({ kind }) {
  return (
    <ConversationIcon
      name={kind === "command" ? "terminal" : kind === "diff" ? "file" : "tool"}
      size={16}
    />
  );
}

function GenericToolCard({ view, compact = false }) {
  return (
    <div
      className={`conversation-tool-card is-generic is-${view.status}${compact ? " is-compact" : ""}`}
      data-testid="conversation-tool-card"
      data-tool-kind="tool"
    >
      <div className="conversation-tool-card__icon">
        <ToolIcon kind="tool" />
      </div>
      <div className="conversation-tool-card__copy">
        <strong>{view.title}</strong>
        {view.target && <code>{view.target}</code>}
        {view.summary && (
          <p className={view.error ? "is-error" : ""}>
            {view.summary}
          </p>
        )}
      </div>
      <div className="conversation-tool-card__meta">
        <ToolStatusMark view={view} />
        <small>{view.statusText}</small>
      </div>
    </div>
  );
}

export function ToolActivityCard({
  tool,
  compact = false,
  defaultOpen,
  developerMode = false
}) {
  const view = createToolActivityView(tool);
  const open = defaultOpen ?? view.defaultOpen;

  if (view.kind === "command") {
    return (
      <ToolCommandPreview
        tool={tool}
        compact={compact}
        defaultOpen={open}
        title={view.title}
        resultSummary={view.summary}
        showMetadata={developerMode}
      />
    );
  }

  if (view.kind === "diff") {
    return (
      <FileDiffPreview
        change={view.change}
        compact={compact}
        defaultOpen={open}
        label={view.title}
        description={view.summary || view.target}
        status={view.status}
        statusLabel={view.statusText}
      />
    );
  }

  return (
    <GenericToolCard
      view={view}
      compact={compact}
    />
  );
}
