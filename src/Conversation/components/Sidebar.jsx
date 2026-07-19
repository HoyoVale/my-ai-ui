import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  ConversationIcon
} from "./Icon.jsx";

function workspaceLabel(
  conversation,
  workspaceMap
) {
  if (!conversation.workspaceId) {
    return {
      key: "none",
      label: "无工作区",
      removed: false
    };
  }

  const current = workspaceMap.get(
    conversation.workspaceId
  );

  if (current) {
    return {
      key: conversation.workspaceId,
      label: current.name,
      removed: false
    };
  }

  return {
    key: conversation.workspaceId,
    label:
      conversation.workspaceSnapshot?.name ||
      "已移除的工作区",
    removed: true
  };
}

function buildGroups(
  conversations,
  workspaces
) {
  const workspaceMap = new Map(
    workspaces.map((workspace) => [
      workspace.id,
      workspace
    ])
  );
  const groups = [];
  const indexes = new Map();

  for (const conversation of conversations) {
    const workspace = workspaceLabel(
      conversation,
      workspaceMap
    );
    let index = indexes.get(workspace.key);

    if (index === undefined) {
      index = groups.length;
      indexes.set(workspace.key, index);
      groups.push({
        ...workspace,
        conversations: []
      });
    }

    groups[index].conversations.push(
      conversation
    );
  }

  return groups;
}

export function ConversationSidebar({
  conversations,
  workspaces = [],
  workspaceScope = "all",
  onWorkspaceScopeChange,
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
  const groups = useMemo(
    () => buildGroups(
      conversations,
      workspaces
    ),
    [conversations, workspaces]
  );

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

  const renderConversation = (
    conversation
  ) => {
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
        data-workspace-id={conversation.workspaceId ?? ""}
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
  };

  return (
    <aside className="conversation-sidebar">
      <div className="conversation-sidebar__heading">
        Conversation
      </div>

      <label className="conversation-workspace-select">
        <span>工作区</span>
        <select
          data-testid="conversation-workspace-select"
          value={workspaceScope}
          disabled={busy}
          onChange={(event) => {
            onWorkspaceScopeChange?.(
              event.target.value
            );
          }}
        >
          <option value="all">
            全部工作区
          </option>
          <option value="none">
            无工作区
          </option>
          {workspaces.map((workspace) => (
            <option
              key={workspace.id}
              value={workspace.id}
            >
              {workspace.name}
            </option>
          ))}
        </select>
        <small>
          选择具体工作区会创建一个绑定的新会话
        </small>
      </label>

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
          groups.map((group) => (
            <section
              className="conversation-workspace-group"
              data-workspace-group={group.key}
              key={group.key}
            >
              {(workspaceScope === "all" || group.removed) && (
                <div className="conversation-workspace-group__title">
                  <span>{group.label}</span>
                  {group.removed && (
                    <small>已移除</small>
                  )}
                </div>
              )}

              {group.conversations.map(
                renderConversation
              )}
            </section>
          ))
        )}
      </div>
    </aside>
  );
}
