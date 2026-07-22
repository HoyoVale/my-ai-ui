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
  planStatusMark
} from "./taskPanelModel.js";

import {
  describeToolTarget,
  formatTaskDuration,
  getPlanStats,
  getToolTitle,
  stringifyTaskValue,
  stopReasonLabel,
  toolStatusLabel,
  toolStatusMark
} from "../utils/taskActivity.js";

function DeveloperPlanInspector({ snapshot }) {
  const subplans = Array.isArray(snapshot?.planState?.subplans)
    ? snapshot.planState.subplans
    : [];

  if (!subplans.length) {
    return null;
  }

  const roots = new Map(
    (snapshot.plan ?? []).map((item) => [String(item.id ?? ""), item])
  );

  return (
    <section
      className="conversation-developer-subplans"
      data-testid="conversation-developer-subplans"
    >
      <header>
        <div>
          <strong>内部子计划</strong>
          <small>仅开发者可见，不计入用户总计划进度。</small>
        </div>
        <span>{subplans.length}</span>
      </header>

      <div className="conversation-developer-subplans__list">
        {subplans.map((entry) => {
          const root = roots.get(entry.rootStepId);
          const stats = getPlanStats(entry.items);
          const open = root?.status === "in_progress";

          return (
            <details
              className="conversation-developer-subplan"
              key={entry.rootStepId}
              open={open}
            >
              <summary>
                <span className={`conversation-developer-subplan__mark is-${root?.status ?? "pending"}`} />
                <div>
                  <strong>{root?.title || entry.rootStepId}</strong>
                  <small>
                    {stats.completed}/{stats.total} · revision {entry.revision}
                  </small>
                </div>
                <ConversationIcon name="chevron" size={13} />
              </summary>

              <div className="conversation-developer-subplan__items">
                {stats.plan.map((item, index) => (
                  <div
                    className={`conversation-developer-subplan__item is-${item.status}`}
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
            </details>
          );
        })}
      </div>
    </section>
  );
}

export function DeveloperActivity({
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

      <DeveloperPlanInspector snapshot={snapshot} />

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

      {snapshot.threadRouting && (
        <RawDetail
          title="Thread routing rollout"
          value={stringifyTaskValue(snapshot.threadRouting)}
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
        <ToolCommandPreview tool={toolCall} defaultOpen showMetadata />
        {toolCall.result?.changePreview && (
          <FileDiffPreview
            change={{
              id: toolCall.id,
              paths: toolCall.result.changePreview.paths?.length
                ? toolCall.result.changePreview.paths
                : toolCall.result.changePreview.path ? [toolCall.result.changePreview.path] : [],
              diff: toolCall.result.changePreview.diff,
              truncated: toolCall.result.changePreview.truncated
            }}
            defaultOpen
          />
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
