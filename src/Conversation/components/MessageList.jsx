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
  conversation
}) {
  if (loading) {
    return (
      <div className="conversation-state">
        正在读取会话…
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="conversation-state">
        <strong>
          还没有选中的会话
        </strong>

        <span>
          新建会话或从左侧选择历史记录。
        </span>
      </div>
    );
  }

  if (
    conversation.messages.length ===
    0
  ) {
    return (
      <div
        className="conversation-state"
        data-testid="conversation-empty"
      >
        <strong>
          这是一个新会话
        </strong>

        <span>
          点击“继续对话”打开输入框。
        </span>
      </div>
    );
  }

  return (
    <div
      className="conversation-messages"
      data-testid="conversation-message-list"
    >
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
            <div className="conversation-message__meta">
              <strong>
                {message.role ===
                "user"
                  ? "你"
                  : "Xixi"}
              </strong>

              <span>
                {formatTime(
                  message.createdAt
                )}
              </span>
            </div>

            <div className="conversation-message__body">
              {message.content}
            </div>

            {message.status ===
              "aborted" && (
              <small className="conversation-message__status">
                已中止
              </small>
            )}
          </article>
        )
      )}
    </div>
  );
}
