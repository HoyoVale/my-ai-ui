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
    useState(true);

  useEffect(() => {
    setCollapsed(true);
  }, [snapshot?.runId]);

  if (!snapshot?.planStats.total) {
    return null;
  }

  const activeItem =
    snapshot.planStats.active ??
    snapshot.plan.find((item) =>
      ![
        "completed",
        "skipped",
        "cancelled",
        "superseded"
      ].includes(item.status)
    ) ??
    snapshot.plan.at(-1);

  const progress =
    Math.round(
      snapshot.planStats.ratio * 100
    );

  return (
    <section
      className={`conversation-plan-dock${collapsed ? " is-collapsed" : ""}`}
      data-testid="conversation-plan-dock"
      data-run-id={snapshot.runId}
    >
      <button
        type="button"
        className="conversation-plan-dock__bar"
        aria-expanded={!collapsed}
        aria-controls="conversation-plan-dock-content"
        title={collapsed ? "展开计划" : "收起计划"}
        onClick={() => {
          setCollapsed((current) => !current);
        }}
      >
        <span className="conversation-plan-dock__leading">
          <ConversationIcon name="activity" size={14} />
        </span>

        <span className="conversation-plan-dock__summary">
          <strong>计划</strong>
          <span>{activeItem?.title || "正在执行任务"}</span>
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
        <div className="conversation-plan-dock__items">
          {snapshot.plan.map((item, index) => (
            <div
              className={`conversation-plan-dock__item is-${item.status}`}
              key={item.id ?? `${item.title}-${index}`}
            >
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
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
