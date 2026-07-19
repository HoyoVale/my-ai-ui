export function normalizeSessionMode(
  value,
  fallback = "chat"
) {
  return value === "coding"
    ? "coding"
    : value === "chat"
      ? "chat"
      : fallback;
}

export function workspaceKey(
  workspaceId
) {
  const normalized = String(
    workspaceId ?? ""
  ).trim();

  return normalized || "__none__";
}

export function filterSessionsForContext(
  conversations,
  {
    mode = "chat",
    workspaceId = null
  } = {}
) {
  const normalizedMode = normalizeSessionMode(mode);
  const normalizedWorkspaceId = workspaceId === null
    ? null
    : String(workspaceId ?? "").trim() || null;

  return (Array.isArray(conversations) ? conversations : [])
    .filter((conversation) =>
      normalizeSessionMode(conversation?.mode) === normalizedMode &&
      (conversation?.workspaceId ?? null) === normalizedWorkspaceId
    )
    .sort(
      (left, right) =>
        Number(right?.updatedAt ?? 0) -
        Number(left?.updatedAt ?? 0)
    );
}

export function groupSessionsByWorkspace(
  conversations,
  workspaces = []
) {
  const workspaceMap = new Map(
    (Array.isArray(workspaces) ? workspaces : [])
      .map((workspace) => [
        workspace.id,
        workspace
      ])
  );
  const groups = new Map();

  for (const conversation of Array.isArray(conversations) ? conversations : []) {
    const key = workspaceKey(
      conversation?.workspaceId
    );
    const registered = conversation?.workspaceId
      ? workspaceMap.get(conversation.workspaceId)
      : null;
    const label = conversation?.workspaceId
      ? registered?.name ??
        conversation?.workspaceSnapshot?.name ??
        "已移除的工作区"
      : "无工作区";

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        workspaceId:
          conversation?.workspaceId ?? null,
        label,
        missing:
          Boolean(conversation?.workspaceId) &&
          !registered,
        conversations: []
      });
    }

    groups.get(key).conversations.push(
      conversation
    );
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      conversations: group.conversations.sort(
        (left, right) =>
          Number(right?.updatedAt ?? 0) -
          Number(left?.updatedAt ?? 0)
      )
    }))
    .sort((left, right) => {
      if (left.workspaceId === null) {
        return -1;
      }

      if (right.workspaceId === null) {
        return 1;
      }

      return left.label.localeCompare(
        right.label,
        "zh-CN"
      );
    });
}
