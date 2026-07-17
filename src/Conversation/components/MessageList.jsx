import {
  useEffect,
  useRef
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
  onOpenInput
}) {
  const endRef =
    useRef(null);

  useEffect(() => {
    endRef.current
      ?.scrollIntoView?.({
        block: "end"
      });
  }, [
    conversation?.id,
    conversation?.messages.length
  ]);

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
          (message) => (
            <article
              className={
                `conversation-message conversation-message--${message.role}`
              }
              data-testid="conversation-message"
              data-role={message.role}
              key={message.id}
            >
              {message.role ===
                "assistant" && (
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
                    {message.role ===
                    "user"
                      ? "你"
                      : "助手"}
                  </strong>

                  <time>
                    {formatTime(
                      message.createdAt
                    )}
                  </time>
                </div>

                <div className="conversation-message__body">
                  {message.content}
                </div>

                {message.status ===
                  "aborted" && (
                  <small className="conversation-message__status">
                    回复已中止
                  </small>
                )}
              </div>
            </article>
          )
        )}

        <div ref={endRef} />
      </div>
    </div>
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
