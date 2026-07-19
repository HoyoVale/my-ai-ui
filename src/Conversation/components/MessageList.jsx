import {
  useEffect,
  useMemo,
  useRef,
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
  describeToolBatch,
  formatTaskDuration,
  getToolTitle,
  groupToolActivityEvents,
  isActivityEventVisible,
  stopReasonLabel
} from "../utils/taskActivity.js";

const TIME_FORMATTER =
  new Intl.DateTimeFormat(
    "zh-CN",
    {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }
  );

const FULL_TIME_FORMATTER =
  new Intl.DateTimeFormat(
    "zh-CN",
    {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }
  );

function formatMessageTime(
  timestamp
) {
  const date =
    new Date(
      Number(timestamp) || 0
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return {
      short: "",
      full: ""
    };
  }

  return {
    short:
      TIME_FORMATTER.format(
        date
      ),
    full:
      FULL_TIME_FORMATTER.format(
        date
      )
  };
}

export function ConversationMessageList({
  loading,
  conversation,
  liveActivity = null,
  busy = false,
  developerMode = false,
  onOpenTaskPanel,
  onOpenInput,
  onUpdateMessageContext,
  onRegenerate
}) {
  const endRef =
    useRef(null);
  const listRef =
    useRef(null);
  const followLiveRef =
    useRef(true);

  const [copiedId, setCopiedId] =
    useState(null);
  const [showReturnToCurrent, setShowReturnToCurrent] =
    useState(false);

  const liveRevision =
    useMemo(() => {
      const events =
        liveActivity?.activity?.events ?? [];
      const lastEvent =
        events.at?.(-1) ?? null;
      const plan =
        liveActivity?.plan ?? [];

      return [
        liveActivity?.runId ?? "",
        liveActivity?.state ?? "",
        events.length,
        lastEvent?.updatedAt ?? "",
        lastEvent?.status ?? "",
        plan
          .map((item) =>
            `${item.id}:${item.status}`
          )
          .join("|"),
        String(
          liveActivity?.liveStepText ?? ""
        ).length,
        String(
          liveActivity?.finalText ?? ""
        ).length
      ].join(":");
    }, [liveActivity]);

  useEffect(() => {
    followLiveRef.current = true;
    setShowReturnToCurrent(false);
  }, [conversation?.id]);

  useEffect(() => {
    if (!followLiveRef.current) {
      return;
    }

    const frame =
      requestAnimationFrame(() => {
        endRef.current
          ?.scrollIntoView?.({
            block: "end"
          });
      });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [
    conversation?.id,
    conversation?.messages.length,
    liveRevision
  ]);

  useEffect(() => {
    if (
      liveActivity &&
      !followLiveRef.current
    ) {
      setShowReturnToCurrent(true);
    }
  }, [liveActivity, liveRevision]);

  const lastAssistantId =
    useMemo(() => {
      return conversation
        ?.messages
        ?.findLast?.(
          (message) =>
            message.role ===
              "assistant"
        )
        ?.id ?? null;
    }, [conversation]);

  const copyMessage =
    async (message) => {
      try {
        await navigator.clipboard
          .writeText(
            message.content
          );
        setCopiedId(message.id);
        setTimeout(() => {
          setCopiedId((current) =>
            current === message.id
              ? null
              : current
          );
        }, 1400);
      } catch {
        // 剪贴板权限不可用时保持界面安静。
      }
    };

  if (loading) {
    return (
      <div className="conversation-state">
        <span className="conversation-state__spinner" />
        <strong>正在读取会话</strong>
      </div>
    );
  }

  if (!conversation) {
    return (
      <EmptyState
        title="选择一个会话"
        description="从左侧打开历史记录，或创建一个新会话。"
        onOpenInput={onOpenInput}
      />
    );
  }

  if (
    conversation.messages.length ===
    0
  ) {
    return (
      <EmptyState
        title="开始新的对话"
        description="打开输入框，第一条消息会自动保存在这里。"
        onOpenInput={onOpenInput}
        testId="conversation-empty"
      />
    );
  }

  return (
    <div
      ref={listRef}
      className="conversation-messages"
      data-testid="conversation-message-list"
      onScroll={() => {
        const element = listRef.current;

        if (!element) {
          return;
        }

        const remaining =
          element.scrollHeight -
          element.scrollTop -
          element.clientHeight;

        followLiveRef.current =
          remaining < 140;
        if (followLiveRef.current) {
          setShowReturnToCurrent(false);
        }
      }}
    >
      <div className="conversation-messages__canvas">
        {conversation.messages.map(
          (message) => {
            const isAssistant =
              message.role ===
                "assistant";
            const replacedByLiveRun =
              isAssistant &&
              Boolean(
                liveActivity
                  ?.replaceMessageId
              ) &&
              liveActivity
                .replaceMessageId ===
                message.id;

            if (replacedByLiveRun) {
              return null;
            }

            const copied =
              copiedId === message.id;

            const included =
              message.includeInContext !==
                false;

            const pinned =
              message.pinnedToContext ===
                true;

            const messageTime =
              formatMessageTime(
                message.createdAt
              );

            return (
              <article
                className={[
                  "conversation-message",
                  `conversation-message--${message.role}`,
                  included
                    ? ""
                    : "is-context-excluded",
                  pinned
                    ? "is-context-pinned"
                    : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-testid="conversation-message"
                data-message-id={message.id}
                data-role={message.role}
                data-context-included={included}
                data-context-pinned={pinned}
                key={message.id}
              >
                <div className="conversation-message__content">
                  {!isAssistant &&
                    messageTime.short && (
                    <time
                      className="conversation-message__time"
                      dateTime={
                        new Date(
                          Number(
                            message.createdAt
                          ) || 0
                        ).toISOString()
                      }
                      title={messageTime.full}
                    >
                      {messageTime.short}
                    </time>
                  )}

                  {isAssistant && (
                    <AssistantActivity
                      message={message}
                      developerMode={developerMode}
                      onOpenTaskPanel={() => {
                        onOpenTaskPanel?.(
                          message.id
                        );
                      }}
                    />
                  )}

                  {String(
                    message.content ?? ""
                  ).trim() && (
                    <div className="conversation-message__body">
                      <MarkdownContent
                        content={message.content}
                        compact={!isAssistant}
                      />
                    </div>
                  )}

                  <div className="conversation-message__actions">
                    <div className="conversation-message__status-group">
                      {isAssistant &&
                        pinned && (
                        <span className="conversation-message__status-chip">
                          已固定
                        </span>
                      )}

                      {isAssistant &&
                        !included && (
                        <span className="conversation-message__status-chip">
                          已排除上下文
                        </span>
                      )}

                      {message.status ===
                        "aborted" && (
                        <span className="conversation-message__status-chip">
                          回复已中止
                        </span>
                      )}

                      {message.status ===
                        "interrupted" && (
                        <span className="conversation-message__status-chip">
                          上次执行被中断
                        </span>
                      )}
                    </div>

                    <div className="conversation-message__action-group">
                      <MessageAction
                        label={
                          copied
                            ? "已复制"
                            : "复制"
                        }
                        onClick={() => {
                          void copyMessage(
                            message
                          );
                        }}
                        icon={
                          copied
                            ? "check"
                            : "copy"
                        }
                      />

                      {isAssistant && (
                        <>
                          {message.id ===
                            lastAssistantId && (
                            <MessageAction
                              label="重新生成"
                              testId="message-regenerate"
                              disabled={busy}
                              onClick={() => {
                                void onRegenerate?.(
                                  message.id
                                );
                              }}
                              icon="refresh"
                            />
                          )}

                          <MessageAction
                            label={
                              pinned
                                ? "取消固定"
                                : "固定到本会话"
                            }
                            testId="message-pin-toggle"
                            active={pinned}
                            disabled={!included}
                            onClick={() => {
                              onUpdateMessageContext?.(
                                message.id,
                                {
                                  pinnedToContext:
                                    !pinned
                                }
                              );
                            }}
                            icon="pin"
                          />

                          <MessageAction
                            label={
                              included
                                ? "排除上下文"
                                : "加入上下文"
                            }
                            testId="message-context-toggle"
                            active={!included}
                            onClick={() => {
                              onUpdateMessageContext?.(
                                message.id,
                                {
                                  includeInContext:
                                    !included
                                }
                              );
                            }}
                            icon={
                              included
                                ? "eyeOff"
                                : "eye"
                            }
                          />
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          }
        )}

        {liveActivity && (
          <LiveAgentActivity
            activity={liveActivity}
            developerMode={developerMode}
            onOpenTaskPanel={() => {
              onOpenTaskPanel?.("live");
            }}
          />
        )}

        {liveActivity && showReturnToCurrent && (
          <button
            type="button"
            className="conversation-return-to-current"
            data-testid="conversation-return-to-current"
            onClick={() => {
              followLiveRef.current = true;
              setShowReturnToCurrent(false);
              endRef.current
                ?.scrollIntoView?.({
                  block: "end",
                  behavior: "smooth"
                });
            }}
          >
            <ConversationIcon name="chevron" size={13} />
            返回当前活动
          </button>
        )}

        <div ref={endRef} />
      </div>
    </div>
  );
}

function visibleTimelineEvents(snapshot, developerMode = false) {
  return snapshot.events.filter((event) => {
    if (!isActivityEventVisible(event, { developerMode })) {
      return false;
    }

    if ([
      "batch",
      "plan"
    ].includes(event.type)) {
      return false;
    }

    if (event.type !== "status") {
      return true;
    }

    return developerMode ||
      ["failed", "cancelled", "interrupted"].includes(event.status);
  });
}

function timelineTitle(snapshot, live, stopping) {
  if (live) {
    return stopping ? "正在停止…" : "思考中";
  }

  return snapshot.durationMs > 0
    ? `思考了 ${formatTaskDuration(snapshot.durationMs)}`
    : "思考过程";
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

  if (
    !live &&
    events.length === 0 &&
    !String(liveText).trim()
  ) {
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
    >
      <summary>
        <span>{timelineTitle(snapshot, live, stopping)}</span>
        <ConversationIcon name="chevron" size={13} />
      </summary>

      <div className="conversation-thinking-timeline__content">
        {events.length === 0 &&
        !String(liveText).trim() ? (
          <div className="conversation-thinking-timeline__pending">
            <span />
            <strong>
              {stopping ? "正在保存当前执行记录" : "正在准备下一步"}
            </strong>
          </div>
        ) : (
          <>
            {events.map((event) => (
              <TimelineEvent
                event={event}
                key={event.id}
                onOpenTaskPanel={onOpenTaskPanel}
              />
            ))}
            {String(liveText).trim() && (
              <div
                className="conversation-thinking-event conversation-thinking-event--commentary is-streaming"
                data-testid="conversation-live-step-text"
              >
                <MarkdownContent
                  content={liveText}
                  compact
                />
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
}

function TimelineEvent({ event, onOpenTaskPanel }) {
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

  if (event.type === "tool_batch") {
    return (
      <details
        className={`conversation-thinking-tool-batch is-${event.status}`}
        data-batch-id={event.batchId || undefined}
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
            />
          ))}
        </div>
      </details>
    );
  }

  if (event.type === "tool") {
    const tool = event.tool;

    return (
      <button
        type="button"
        className={`conversation-thinking-event conversation-thinking-event--tool is-${tool?.status ?? event.status}`}
        data-batch-id={event.batchId || tool?.batchId || undefined}
        onClick={onOpenTaskPanel}
      >
        <ConversationIcon name="tool" size={16} />
        <strong>{getToolTitle(tool)}</strong>
      </button>
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

function LiveAgentActivity({
  activity,
  developerMode,
  onOpenTaskPanel
}) {
  const snapshot =
    createActivitySnapshot(
      activity,
      {
        live: true
      }
    );
  const [planDismissed, setPlanDismissed] =
    useState(false);

  useEffect(() => {
    setPlanDismissed(false);
  }, [snapshot.runId]);

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
              activity.liveStepText ??
              ""
            }
            stopping={
              ["stopping", "cancelling"].includes(
                activity.state
              )
            }
            onOpenTaskPanel={
              onOpenTaskPanel
            }
            developerMode={developerMode}
          />

          {String(
            activity.finalText ?? ""
          ).trim() && (
            <div className="conversation-message__body conversation-message__body--live">
              <MarkdownContent
                content={activity.finalText}
              />
            </div>
          )}

          {snapshot.plan.length > 0 &&
            !planDismissed && (
            <PlanDashboard
              snapshot={snapshot}
              onClose={() => {
                setPlanDismissed(true);
              }}
            />
          )}
        </div>
      </div>
    </article>
  );
}

function PlanDashboard({
  snapshot,
  onClose
}) {
  return (
    <section
      className="conversation-plan-dashboard"
      data-testid="conversation-plan-dashboard"
      data-run-id={snapshot.runId}
    >
      <header>
        <div>
          <strong>计划</strong>
          <span>
            {snapshot.planStats.completed}/
            {snapshot.planStats.total}
          </span>
        </div>
        <button
          type="button"
          aria-label="收起计划"
          title="收起计划"
          onClick={onClose}
        >
          <ConversationIcon name="close" size={14} />
        </button>
      </header>

      <div className="conversation-plan-dashboard__progress">
        <span
          style={{
            width: `${Math.round(
              snapshot.planStats.ratio * 100
            )}%`
          }}
        />
      </div>

      <div className="conversation-plan-dashboard__items">
        {snapshot.plan.map((item, index) => (
          <div
            className={`conversation-plan-dashboard__item is-${item.status}`}
            key={item.id ?? `${item.title}-${index}`}
          >
            <span className="conversation-plan-dashboard__mark">
              {item.status === "completed" && (
                <ConversationIcon name="check" size={12} />
              )}
              {["blocked", "needs_input"].includes(item.status) && (
                <ConversationIcon name="warning" size={12} />
              )}
              {item.status === "in_progress" && <span />}
              {["skipped", "cancelled", "superseded"].includes(item.status) && (
                <ConversationIcon name="minus" size={12} />
              )}
            </span>
            <strong>{item.title}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function AssistantActivity({
  message,
  developerMode,
  onOpenTaskPanel
}) {
  const snapshot =
    createActivitySnapshot(
      message
    );

  if (
    visibleTimelineEvents(snapshot, developerMode).length === 0
  ) {
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
        onOpenTaskPanel={
          onOpenTaskPanel
        }
      />
    </div>
  );
}

function MessageAction({
  label,
  icon,
  active = false,
  disabled = false,
  testId,
  onClick
}) {
  return (
    <button
      type="button"
      className={
        `conversation-message-action${
          active
            ? " is-active"
            : ""
        }`
      }
      data-testid={testId}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <ConversationIcon
        name={icon}
        size={14}
      />
      <span>{label}</span>
    </button>
  );
}

function EmptyState({
  title,
  description,
  onOpenInput,
  testId
}) {
  return (
    <div
      className="conversation-state conversation-state--empty"
      data-testid={testId}
    >
      <strong>{title}</strong>
      <span>{description}</span>

      <button
        type="button"
        onClick={onOpenInput}
      >
        打开输入框
      </button>
    </div>
  );
}
