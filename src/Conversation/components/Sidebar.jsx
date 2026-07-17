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

function groupLabel(
  timestamp
) {
  const value =
    Number(timestamp);

  if (!value) {
    return "更早";
  }

  const now =
    new Date();
  const date =
    new Date(value);

  const today =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).getTime();

  const day =
    new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    ).getTime();

  const difference =
    Math.floor(
      (today - day) /
      86400000
    );

  if (difference <= 0) {
    return "今天";
  }

  if (difference === 1) {
    return "昨天";
  }

  if (difference <= 7) {
    return "最近 7 天";
  }

  return "更早";
}

function groupConversations(
  conversations
) {
  const groups = [];

  for (
    const conversation
    of conversations
  ) {
    const label =
      groupLabel(
        conversation.updatedAt
      );

    const group =
      groups.at(-1);

    if (
      !group ||
      group.label !== label
    ) {
      groups.push({
        label,
        conversations: [
          conversation
        ]
      });
    } else {
      group.conversations.push(
        conversation
      );
    }
  }

  return groups;
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
  const groups =
    groupConversations(
      conversations
    );

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
            size={16}
          />
          新建会话
        </button>

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
      </div>

      <div className="conversation-sidebar__summary">
        <span>会话</span>
        <small>
          {totalConversations}
        </small>
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
                ? "换个关键词试试。"
                : "发送消息后会自动保存。"}
            </span>
          </div>
        ) : (
          groups.map(
            (group) => (
              <section
                className="conversation-history-group"
                key={group.label}
              >
                <div className="conversation-history-group__label">
                  {group.label}
                </div>

                {group.conversations.map(
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
                )}
              </section>
            )
          )
        )}
      </div>
    </aside>
  );
}
