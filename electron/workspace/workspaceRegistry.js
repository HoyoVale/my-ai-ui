import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  getSettings,
  updateSettings
} from "../settings/settingsStore.js";

function clone(value) {
  return structuredClone(value);
}

function normalizeComparablePath(value) {
  const normalized = path.normalize(
    String(value ?? "").trim()
  );

  return process.platform === "win32"
    ? normalized.toLowerCase()
    : normalized;
}

function workspaceName(rootPath) {
  return path.basename(rootPath) || rootPath;
}

function enrichWorkspace(entry) {
  if (!entry) {
    return null;
  }

  const rootPath = String(
    entry.rootPath ?? entry.canonicalPath ?? ""
  ).trim();

  if (!rootPath) {
    return null;
  }

  return {
    ...clone(entry),
    rootPath,
    canonicalPath:
      String(entry.canonicalPath ?? rootPath).trim() || rootPath,
    missing: !fs.existsSync(rootPath)
  };
}

export function listWorkspaces(
  settings = getSettings()
) {
  const entries = Array.isArray(
    settings?.workspaces?.items
  )
    ? settings.workspaces.items
    : [];

  return entries
    .map(enrichWorkspace)
    .filter(Boolean)
    .sort((left, right) => {
      const recent =
        Number(right.lastOpenedAt || 0) -
        Number(left.lastOpenedAt || 0);

      if (recent !== 0) {
        return recent;
      }

      return String(left.name).localeCompare(
        String(right.name),
        "zh-CN"
      );
    });
}

export function getWorkspaceById(
  workspaceId,
  settings = getSettings()
) {
  const id = String(workspaceId ?? "").trim();

  if (!id) {
    return null;
  }

  return listWorkspaces(settings).find(
    (workspace) => workspace.id === id
  ) ?? null;
}

export function createWorkspaceSnapshot(workspace) {
  if (!workspace) {
    return null;
  }

  return {
    id: String(workspace.id ?? ""),
    name: String(workspace.name ?? "工作区"),
    rootPath: String(workspace.rootPath ?? ""),
    canonicalPath: String(
      workspace.canonicalPath ?? workspace.rootPath ?? ""
    )
  };
}

export function registerWorkspace(
  rootPath,
  {
    now = () => Date.now(),
    createId = () => crypto.randomUUID()
  } = {}
) {
  const requested = String(rootPath ?? "").trim();

  if (!requested) {
    return {
      ok: false,
      code: "workspace-path-empty",
      message: "工作区路径不能为空。"
    };
  }

  const resolved = path.resolve(requested);

  if (!fs.existsSync(resolved)) {
    return {
      ok: false,
      code: "workspace-not-found",
      message: "选择的工作区不存在。"
    };
  }

  const stat = fs.statSync(resolved);

  if (!stat.isDirectory()) {
    return {
      ok: false,
      code: "workspace-not-directory",
      message: "工作区必须是目录。"
    };
  }

  const canonicalPath = fs.realpathSync(resolved);
  const settings = getSettings();
  const entries = listWorkspaces(settings);
  const comparable = normalizeComparablePath(canonicalPath);
  const duplicate = entries.find(
    (entry) =>
      normalizeComparablePath(entry.canonicalPath) === comparable
  );

  if (duplicate) {
    const updated = entries.map((entry) =>
      entry.id === duplicate.id
        ? {
            ...entry,
            lastOpenedAt: now()
          }
        : entry
    );

    const nextSettings = updateSettings({
      workspaces: { items: updated }
    });

    return {
      ok: true,
      duplicate: true,
      workspace: getWorkspaceById(duplicate.id, nextSettings),
      settings: nextSettings
    };
  }

  const timestamp = now();
  const workspace = {
    id: createId(),
    name: workspaceName(canonicalPath),
    rootPath: canonicalPath,
    canonicalPath,
    createdAt: timestamp,
    lastOpenedAt: timestamp
  };

  const nextSettings = updateSettings({
    workspaces: {
      items: [
        workspace,
        ...entries.map(({ missing: _missing, ...entry }) => entry)
      ]
    }
  });

  return {
    ok: true,
    duplicate: false,
    workspace: getWorkspaceById(workspace.id, nextSettings),
    settings: nextSettings
  };
}

export function removeWorkspace(workspaceId) {
  const id = String(workspaceId ?? "").trim();
  const settings = getSettings();
  const entries = listWorkspaces(settings);
  const exists = entries.some(
    (entry) => entry.id === id
  );

  if (!exists) {
    return {
      ok: false,
      code: "workspace-not-found",
      message: "工作区不存在。"
    };
  }

  const nextSettings = updateSettings({
    workspaces: {
      items: entries
        .filter((entry) => entry.id !== id)
        .map(({ missing: _missing, ...entry }) => entry)
    }
  });

  return {
    ok: true,
    workspaceId: id,
    settings: nextSettings
  };
}

export function touchWorkspace(workspaceId) {
  const id = String(workspaceId ?? "").trim();

  if (!id) {
    return null;
  }

  const settings = getSettings();
  const entries = listWorkspaces(settings);
  const workspace = entries.find(
    (entry) => entry.id === id
  );

  if (!workspace) {
    return null;
  }

  const updatedAt = Date.now();
  const nextSettings = updateSettings({
    workspaces: {
      items: entries.map(({ missing: _missing, ...entry }) =>
        entry.id === id
          ? {
              ...entry,
              lastOpenedAt: updatedAt
            }
          : entry
      )
    }
  });

  return getWorkspaceById(id, nextSettings);
}

export function bindSettingsToConversationWorkspace(
  settings,
  conversation
) {
  const source = clone(settings ?? getSettings());
  const workspace = getWorkspaceById(
    conversation?.workspaceId,
    source
  );
  const rootPath =
    workspace && !workspace.missing
      ? workspace.canonicalPath || workspace.rootPath
      : "";

  source.tools = {
    ...source.tools,
    workspace: {
      ...source.tools?.workspace,
      roots: rootPath ? [rootPath] : []
    }
  };

  source.activeWorkspace = workspace
    ? createWorkspaceSnapshot(workspace)
    : null;

  return {
    settings: source,
    workspace
  };
}
