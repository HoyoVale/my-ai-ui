function formatUpdatedAt(
  timestamp
) {
  if (!timestamp) {
    return "";
  }

  return new Intl
    .DateTimeFormat(
      "zh-CN",
      {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }
    )
    .format(
      new Date(timestamp)
    );
}

export function ConversationSidebar({
  conversations,
  currentConversationId,
  busy,
  onCreate,
  onSelect,
  onDelete
}) {
  return (
    <aside className="conversation-sidebar">
      <button
        type="button"
        className="conversation-new"
        data-testid="conversation-new"
        disabled={busy}
        onClick={onCreate}
      >
        <span aria-hidden="true">
          ＋
        </span>
        新建会话
      </button>

      <div className="conversation-sidebar__heading">
        历史记录
        <span>
          {conversations.length}
        </span>
      </div>

      <div className="conversation-sidebar__list">
        {conversations.length === 0 ? (
          <div className="conversation-sidebar__empty">
            暂无会话
          </div>
        ) : (
          conversations.map(
            (conversation) => {
              const isCurrent =
                conversation.id ===
                currentConversationId;

              return (
                <div
                  className={
                    `conversation-history-item${
                      isCurrent
                        ? " is-current"
                        : ""
                    }`
                  }
                  data-testid="conversation-history-item"
                  data-conversation-id={
                    conversation.id
                  }
                  key={conversation.id}
                >
                  <button
                    type="button"
                    className="conversation-history-item__main"
                    disabled={busy}
                    onClick={() => {
                      onSelect(
                        conversation.id
                      );
                    }}
                  >
                    <strong>
                      {conversation.title}
                    </strong>

                    <span>
                      {conversation.messageCount} 条
                      ·{" "}
                      {formatUpdatedAt(
                        conversation.updatedAt
                      )}
                    </span>

                    {conversation.preview && (
                      <small>
                        {conversation.preview}
                      </small>
                    )}
                  </button>

                  <button
                    type="button"
                    className="conversation-history-item__delete"
                    aria-label={`删除 ${conversation.title}`}
                    disabled={busy}
                    onClick={() => {
                      onDelete(
                        conversation.id
                      );
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            }
          )
        )}
      </div>
    </aside>
  );
}
