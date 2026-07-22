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
  FinalDiffSummary
} from "./FileDiff.jsx";

import {
  AssistantActivity,
  LiveAgentActivity
} from "./ActivityTimeline.jsx";

import {
  EmptyState,
  MessageAction
} from "./MessagePrimitives.jsx";

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
        liveActivity?.liveStepRole ?? "none",
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

                  {isAssistant && message.status !== "running" && (
                    <FinalDiffSummary summary={message.diffSummary} />
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

