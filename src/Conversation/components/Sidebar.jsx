import {
  useEffect,
  useState
} from "react";

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
  onRename,
  onDelete
}) {
  const [editingId, setEditingId] =
    useState(null);
  const [draftTitle, setDraftTitle] =
    useState("");

  useEffect(() => {
    if (
      editingId &&
      !conversations.some(
        (conversation) =>
          conversation.id === editingId
      )
    ) {
      setEditingId(null);
      setDraftTitle("");
    }
  }, [
    conversations,
    editingId
  ]);

  const beginRename = (
    conversation
  ) => {
    setEditingId(
      conversation.id
    );
    setDraftTitle(
      conversation.title
    );
  };

  const commitRename = (
    conversation
  ) => {
    const title =
      draftTitle
        .replace(/\s+/g, " ")
        .trim();

    setEditingId(null);

    if (
      !title ||
      title === conversation.title
    ) {
      setDraftTitle("");
      return;
    }

    void onRename?.(
      conversation.id,
      title
    );

    setDraftTitle("");
  };

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

              const isEditing =
                editingId ===
                  conversation.id;

              return (
                <div
                  className={
                    `conversation-history-item${
                      isCurrent
                        ? " is-current"
                        : ""
                    }${
                      isEditing
                        ? " is-editing"
                        : ""
                    }`
                  }
                  data-testid="conversation-history-item"
                  data-conversation-id={conversation.id}
                  key={conversation.id}
                >
                  {isEditing ? (
                    <input
                      className="conversation-history-item__rename-input"
                      data-testid="conversation-rename-input"
                      value={draftTitle}
                      maxLength={80}
                      autoFocus
                      aria-label="会话名称"
                      onChange={(event) => {
                        setDraftTitle(
                          event.target.value
                        );
                      }}
                      onBlur={() => {
                        commitRename(
                          conversation
                        );
                      }}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter"
                        ) {
                          event.preventDefault();
                          event.currentTarget
                            .blur();
                        }

                        if (
                          event.key === "Escape"
                        ) {
                          event.preventDefault();
                          setEditingId(null);
                          setDraftTitle("");
                        }
                      }}
                    />
                  ) : (
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
                      onDoubleClick={() => {
                        beginRename(
                          conversation
                        );
                      }}
                    >
                      <span>
                        {conversation.title}
                      </span>
                    </button>
                  )}

                  {!isEditing && (
                    <div className="conversation-history-item__actions">
                      <button
                        type="button"
                        className="conversation-history-item__action"
                        data-testid="conversation-rename"
                        aria-label={`重命名 ${conversation.title}`}
                        title="重命名会话"
                        disabled={busy}
                        onClick={() => {
                          beginRename(
                            conversation
                          );
                        }}
                      >
                        <ConversationIcon
                          name="compose"
                          size={13}
                        />
                      </button>

                      <button
                        type="button"
                        className="conversation-history-item__action conversation-history-item__action--delete"
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
                          size={13}
                        />
                      </button>
                    </div>
                  )}
                </div>
              );
            }
          )
        )}
      </div>
    </aside>
  );
}
