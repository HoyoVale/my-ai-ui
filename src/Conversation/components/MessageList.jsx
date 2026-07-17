import {
  useEffect,
  useRef,
  useState
} from "react";

import {
  ConversationIcon
} from "./Icon.jsx";

function formatTime(
  timestamp
) {
  if (!timestamp) {
    return "";
  }

  return new Intl
    .DateTimeFormat(
      "zh-CN",
      {
        hour: "2-digit",
        minute: "2-digit"
      }
    )
    .format(
      new Date(timestamp)
    );
}

export function ConversationMessageList({
  loading,
  conversation,
  assistantName = "Xixi",
  onOpenInput,
  onUpdateMessageContext
}) {
  const endRef =
    useRef(null);

  const [copiedId, setCopiedId] =
    useState(null);

  useEffect(() => {
    endRef.current
      ?.scrollIntoView?.({
        block: "end"
      });
  }, [
    conversation?.id,
    conversation?.messages.length
  ]);

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
        description="从左侧打开历史记录，或新建一个会话。"
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
        description="这里会展示你和助手的完整消息记录。"
        onOpenInput={onOpenInput}
        testId="conversation-empty"
      />
    );
  }

  return (
    <div
      className="conversation-messages"
      data-testid="conversation-message-list"
    >
      <div className="conversation-messages__canvas">
        {conversation.messages.map(
          (message) => {
            const isAssistant =
              message.role ===
                "assistant";

            const copied =
              copiedId === message.id;

            const included =
              message.includeInContext !==
                false;

            const pinned =
              message.pinnedToContext ===
                true;

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
                data-context-included={
                  included
                }
                data-context-pinned={pinned}
                key={message.id}
              >
                {isAssistant && (
                  <div className="conversation-message__avatar">
                    <ConversationIcon
                      name="spark"
                      size={16}
                    />
                  </div>
                )}

                <div className="conversation-message__content">
                  <div className="conversation-message__meta">
                    <strong>
                      {isAssistant
                        ? assistantName
                        : "你"}
                    </strong>

                    <div className="conversation-message__badges">
                      {pinned && (
                        <span>
                          <ConversationIcon
                            name="pin"
                            size={11}
                          />
                          已固定
                        </span>
                      )}

                      {!included && (
                        <span>
                          不加入上下文
                        </span>
                      )}

                      <time>
                        {formatTime(
                          message.createdAt
                        )}
                      </time>
                    </div>
                  </div>

                  <div className="conversation-message__body">
                    {message.content}
                  </div>

                  <div className="conversation-message__actions">
                    {message.status ===
                      "aborted" && (
                      <small className="conversation-message__status">
                        回复已中止
                      </small>
                    )}

                    <div className="conversation-message__action-group">
                      <MessageAction
                        label={
                          included
                            ? "不加入上下文"
                            : "重新加入上下文"
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
                    </div>
                  </div>
                </div>
              </article>
            );
          }
        )}

        <div ref={endRef} />
      </div>
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
        `conversation-message__copy${
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
      <div className="conversation-state__icon">
        <ConversationIcon
          name="spark"
          size={24}
        />
      </div>

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
