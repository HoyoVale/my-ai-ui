import {
  useEffect,
  useMemo,
  useState
} from "react";

import { ConversationIcon } from "./Icon.jsx";
import {
  groupSessionsByWorkspace,
  normalizeSessionMode,
  workspaceKey
} from "../../shared/sessionNavigation.js";

function buildWorkspaceGroups(conversations, workspaces, mode, query) {
  const grouped = groupSessionsByWorkspace(conversations, workspaces);
  const byKey = new Map(grouped.map((group) => [group.key, group]));

  if (!query && mode === "chat" && !byKey.has(workspaceKey(null))) {
    byKey.set(workspaceKey(null), {
      key: workspaceKey(null),
      workspaceId: null,
      label: "无工作区",
      missing: false,
      conversations: []
    });
  }

  if (!query) {
    for (const workspace of workspaces) {
      const key = workspaceKey(workspace.id);
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          workspaceId: workspace.id,
          label: workspace.name,
          missing: false,
          conversations: []
        });
      }
    }
  }

  return [...byKey.values()]
    .filter((group) => mode === "chat" || Boolean(group.workspaceId))
    .sort((left, right) => {
      if (left.workspaceId === null) return -1;
      if (right.workspaceId === null) return 1;
      return left.label.localeCompare(right.label, "zh-CN");
    });
}

export function ConversationSidebar({
  conversations,
  workspaces = [],
  activeMode = "chat",
  onModeChange,
  currentConversationId,
  busy,
  query,
  onQueryChange,
  onCreate,
  onSelect,
  onRename,
  onDelete
}) {
  const [editingId, setEditingId] = useState(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());

  const normalizedMode = normalizeSessionMode(activeMode, "chat");
  const normalizedQuery = String(query ?? "").trim().toLowerCase();
  const visibleConversations = useMemo(() => (
    Array.isArray(conversations) ? conversations : []
  ).filter((conversation) =>
    normalizeSessionMode(conversation?.mode) === normalizedMode
  ).filter((conversation) =>
    !normalizedQuery || String(conversation?.title ?? "").toLowerCase().includes(normalizedQuery)
  ), [conversations, normalizedMode, normalizedQuery]);

  const groups = useMemo(() => buildWorkspaceGroups(
    visibleConversations,
    Array.isArray(workspaces) ? workspaces : [],
    normalizedMode,
    normalizedQuery
  ), [visibleConversations, workspaces, normalizedMode, normalizedQuery]);

  useEffect(() => {
    if (editingId && !visibleConversations.some((item) => item.id === editingId)) {
      setEditingId(null);
      setDraftTitle("");
    }
  }, [visibleConversations, editingId]);

  useEffect(() => {
    setCollapsedGroups((current) => {
      const validKeys = new Set(groups.map((group) => group.key));
      const next = new Set([...current].filter((key) => validKeys.has(key)));
      const currentGroup = groups.find((group) =>
        group.conversations.some((conversation) => conversation.id === currentConversationId)
      );
      if (currentGroup) next.delete(currentGroup.key);
      return next;
    });
  }, [groups, currentConversationId]);

  const beginRename = (conversation) => {
    setEditingId(conversation.id);
    setDraftTitle(conversation.title);
  };

  const commitRename = (conversation) => {
    const title = draftTitle.replace(/\s+/g, " ").trim();
    setEditingId(null);
    if (title && title !== conversation.title) {
      void onRename?.(conversation.id, title);
    }
    setDraftTitle("");
  };

  const renderConversation = (conversation) => {
    const isCurrent = conversation.id === currentConversationId;
    const isEditing = editingId === conversation.id;
    return (
      <div
        className={`conversation-history-item${isCurrent ? " is-current" : ""}${isEditing ? " is-editing" : ""}`}
        data-testid="conversation-history-item"
        data-conversation-id={conversation.id}
        data-workspace-id={conversation.workspaceId ?? ""}
        data-mode={conversation.mode ?? "chat"}
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
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={() => commitRename(conversation)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
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
            onClick={() => onSelect(conversation.id)}
            onDoubleClick={() => beginRename(conversation)}
          >
            <span>{conversation.title}</span>
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
              onClick={() => beginRename(conversation)}
            >
              <ConversationIcon name="compose" size={13} />
            </button>
            <button
              type="button"
              className="conversation-history-item__action conversation-history-item__action--delete"
              aria-label={`删除 ${conversation.title}`}
              title="删除会话"
              disabled={busy}
              onClick={() => onDelete(conversation.id)}
            >
              <ConversationIcon name="trash" size={13} />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="conversation-sidebar">
      <div className="conversation-sidebar__heading">Conversation</div>
      <div className="conversation-mode-tabs" role="tablist" aria-label="会话模式">
        {[["chat", "Chat"], ["coding", "Coding"]].map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            role="tab"
            data-testid={`conversation-mode-${mode}`}
            aria-selected={normalizedMode === mode}
            className={normalizedMode === mode ? "is-active" : ""}
            disabled={busy}
            onClick={() => onModeChange?.(mode)}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="conversation-search">
        <ConversationIcon name="search" size={15} />
        <input
          type="search"
          value={query}
          placeholder="搜索会话"
          aria-label="搜索会话"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>

      <div className="conversation-sidebar__list">
        {groups.length === 0 ? (
          <div className="conversation-sidebar__empty">
            <strong>{query ? "没有匹配的会话" : "还没有可用工作区"}</strong>
            <span>{query ? "换个关键词试试。" : "先在设置或输入菜单中添加工作区。"}</span>
          </div>
        ) : groups.map((group) => {
          const expanded = !collapsedGroups.has(group.key);
          return (
            <section
              className={`conversation-workspace-group${expanded ? " is-expanded" : ""}`}
              data-workspace-group={group.key}
              key={group.key}
            >
              <div className="conversation-workspace-group__header">
                <button
                  type="button"
                  className="conversation-workspace-group__toggle"
                  aria-expanded={expanded}
                  onClick={() => {
                    setCollapsedGroups((current) => {
                      const next = new Set(current);
                      if (next.has(group.key)) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                    });
                  }}
                >
                  <ConversationIcon name="chevron" size={12} />
                  <span>{group.label}</span>
                  <small>{group.conversations.length}</small>
                </button>
                {!group.missing && (
                  <button
                    type="button"
                    className="conversation-workspace-group__create"
                    data-testid={`conversation-create-${group.workspaceId ?? "none"}`}
                    title={`在${group.label}中新建 ${normalizedMode === "coding" ? "Coding" : "Chat"} 会话`}
                    aria-label={`在${group.label}中新建会话`}
                    disabled={busy}
                    onClick={() => onCreate?.({
                      mode: normalizedMode,
                      workspaceId: group.workspaceId ?? null
                    })}
                  >
                    <ConversationIcon name="plus" size={13} />
                  </button>
                )}
              </div>
              {expanded && (
                <div className="conversation-workspace-group__sessions">
                  {group.conversations.length > 0
                    ? group.conversations.map(renderConversation)
                    : <span className="conversation-workspace-group__empty">暂无会话</span>}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
