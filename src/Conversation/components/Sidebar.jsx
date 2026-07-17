import {
  ConversationIcon
} from "./Icon.jsx";

function formatUpdatedAt(
  timestamp
) {
  if (!timestamp) {
    return "";
  }

  const date =
    new Date(timestamp);

  const now =
    new Date();

  if (
    date.toDateString() ===
    now.toDateString()
  ) {
    return new Intl
      .DateTimeFormat(
        "zh-CN",
        {
          hour: "2-digit",
          minute: "2-digit"
        }
      )
      .format(date);
  }

  return new Intl
    .DateTimeFormat(
      "zh-CN",
      {
        month: "2-digit",
        day: "2-digit"
      }
    )
    .format(date);
}

export function ConversationSidebar({
  conversations,
  totalConversations,
  currentConversationId,
  busy,
  query,
  showPreview,
  onQueryChange,
  onCreate,
  onSelect,
  onDelete
}) {
  return (
    <aside className="conversation-sidebar">
      <div className="conversation-sidebar__top">
        <button
          type="button"
          className="conversation-new"
          data-testid="conversation-new"
          disabled={busy}
          onClick={onCreate}
        >
          <ConversationIcon
            name="plus"
            size={17}
          />
          新建会话
        </button>

        <label className="conversation-search">
          <ConversationIcon
            name="search"
            size={16}
          />
          <input
            type="search"
            value={query}
            placeholder="搜索会话"
            aria-label="搜索会话"
            onChange={(event) => {
              onQueryChange(
                event.target.value
              );
            }}
          />
        </label>
      </div>

      <div className="conversation-sidebar__heading">
        <span>历史记录</span>
        <small>{totalConversations}</small>
      </div>

      <div className="conversation-sidebar__list">
        {conversations.length === 0 ? (
          <div className="conversation-sidebar__empty">
            <ConversationIcon
              name="spark"
              size={22}
            />
            <strong>
              {query
                ? "没有匹配的会话"
                : "暂无会话"}
            </strong>
            <span>
              {query
                ? "尝试使用其他关键词。"
                : "发送消息后会自动保存在这里。"}
            </span>
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
                    <span className="conversation-history-item__title-row">
                      <strong>
                        {conversation.title}
                      </strong>
                      <time>
                        {formatUpdatedAt(
                          conversation.updatedAt
                        )}
                      </time>
                    </span>

                    {showPreview &&
                      conversation.preview && (
                      <small>
                        {conversation.preview}
                      </small>
                    )}

                    <span className="conversation-history-item__count">
                      {conversation.messageCount} 条消息
                    </span>
                  </button>

                  <button
                    type="button"
                    className="conversation-history-item__delete"
                    aria-label={`删除 ${conversation.title}`}
                    title="删除会话"
                    disabled={busy}
                    onClick={() => {
                      onDelete(
                        conversation.id
                      );
                    }}
                  >
                    <ConversationIcon
                      name="trash"
                      size={15}
                    />
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
