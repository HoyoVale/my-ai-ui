import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  ConversationIcon
} from "./Icon.jsx";

import {
  createActivitySnapshot
} from "../utils/taskActivity.js";

const TERMINAL_STATUSES = new Set([
  "completed",
  "skipped",
  "cancelled",
  "superseded",
  "needs_input",
  "blocked"
]);

function planStateIcon(status) {
  if (status === "completed") {
    return <ConversationIcon name="check" size={11} />;
  }

  if (["blocked", "needs_input"].includes(status)) {
    return <ConversationIcon name="warning" size={11} />;
  }

  if (["skipped", "cancelled", "superseded"].includes(status)) {
    return <ConversationIcon name="minus" size={11} />;
  }

  return null;
}

function planStatusLabel(status) {
  const labels = {
    completed: "已完成",
    in_progress: "进行中",
    blocked: "已阻塞",
    needs_input: "待确认",
    skipped: "已跳过",
    cancelled: "已取消",
    superseded: "已调整",
    pending: "待执行"
  };

  return labels[status] ?? "待执行";
}

export function ConversationPlanDock({
  activity
}) {
  const snapshot = useMemo(
    () =>
      activity?.runId
        ? createActivitySnapshot(
            activity,
            {
              live: true
            }
          )
        : null,
    [activity]
  );

  const [collapsed, setCollapsed] =
    useState(false);

  useEffect(() => {
    setCollapsed(false);
  }, [snapshot?.runId]);

  useEffect(() => {
    if (snapshot?.planAdjusted) {
      setCollapsed(false);
    }
  }, [snapshot?.planAdjusted, snapshot?.planRevision]);

  if (!snapshot?.planStats.total) {
    return null;
  }

  const activeItem =
    snapshot.planStats.active ??
    snapshot.plan.find((item) =>
      !TERMINAL_STATUSES.has(item.status)
    ) ??
    snapshot.plan.at(-1);

  const progress =
    Math.round(
      snapshot.planStats.ratio * 100
    );

  return (
    <section
      className={`conversation-plan-dock${collapsed ? " is-collapsed" : ""}${snapshot.planAdjusted ? " is-adjusted" : ""}`}
      data-testid="conversation-plan-dock"
      data-run-id={snapshot.runId}
      data-plan-revision={snapshot.planRevision}
    >
      <button
        type="button"
        className="conversation-plan-dock__bar"
        aria-expanded={!collapsed}
        aria-controls="conversation-plan-dock-content"
        title={collapsed ? "展开执行计划" : "收起执行计划"}
        onClick={() => {
          setCollapsed((current) => !current);
        }}
      >
        <span className="conversation-plan-dock__leading">
          <ConversationIcon name="activity" size={14} />
        </span>

        <span className="conversation-plan-dock__summary">
          <span className="conversation-plan-dock__title-line">
            <strong>执行计划</strong>
            {snapshot.planAdjusted && (
              <em data-testid="conversation-plan-adjusted">计划已调整</em>
            )}
          </span>
          <span aria-live="polite">
            {activeItem?.title || "正在执行任务"}
          </span>
        </span>

        <span className="conversation-plan-dock__count">
          {snapshot.planStats.completed}/{snapshot.planStats.total}
        </span>

        <span className="conversation-plan-dock__chevron">
          <ConversationIcon name="chevron" size={14} />
        </span>
      </button>

      <div
        className="conversation-plan-dock__progress"
        aria-label={`计划进度 ${progress}%`}
      >
        <span
          style={{
            width: `${progress}%`
          }}
        />
      </div>

      <div
        id="conversation-plan-dock-content"
        className="conversation-plan-dock__content"
        aria-hidden={collapsed}
      >
        {snapshot.planAdjusted && (
          <div className="conversation-plan-dock__adjustment">
            <span>
              <ConversationIcon name="activity" size={13} />
            </span>
            <div>
              <strong>计划已调整</strong>
              <small>
                {snapshot.planAdjustmentReason ||
                  "执行过程中根据新信息更新了总计划。"}
              </small>
            </div>
          </div>
        )}

        <ol className="conversation-plan-dock__items">
          {snapshot.plan.map((item, index) => (
            <li
              className={`conversation-plan-dock__item is-${item.status}`}
              key={item.id ?? `${item.title}-${index}`}
              data-plan-step-id={item.id || undefined}
            >
              <span className="conversation-plan-dock__rail" aria-hidden="true" />
              <span className="conversation-plan-dock__mark">
                {planStateIcon(item.status)}
                {item.status === "in_progress" && <span />}
              </span>
              <div>
                <strong>{item.title}</strong>
                {item.reason && (
                  <small>{item.reason}</small>
                )}
              </div>
              <span className="conversation-plan-dock__status">
                {planStatusLabel(item.status)}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
