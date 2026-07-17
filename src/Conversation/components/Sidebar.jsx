import {
  ConversationIcon
} from "./Icon.jsx";

export function ConversationSidebar({
  conversations,
  currentConversationId,
  busy,
  query,
  onQueryChange,
  onSelect,
  onDelete
}) {
  return (
    <aside className="conversation-sidebar">
      <div className="conversation-sidebar__heading">
        Conversation
      </div>

      <label className="conversation-search">
        <ConversationIcon
          name="search"
          size={15}
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

      <div className="conversation-sidebar__list">
        {conversations.length === 0 ? (
          <div className="conversation-sidebar__empty">
            <strong>
              {query
                ? "没有匹配的会话"
                : "暂无会话"}
            </strong>
            <span>
              {query
                ? "换个关键词试试。"
                : "新会话会显示在这里。"}
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
                  data-conversation-id={conversation.id}
                  key={conversation.id}
                >
                  <button
                    type="button"
                    className="conversation-history-item__main"
                    disabled={busy}
                    title={conversation.title}
                    onClick={() => {
                      onSelect(
                        conversation.id
                      );
                    }}
                  >
                    <span>
                      {conversation.title}
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
                      size={14}
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
