export const SAFE_TOOL_CATALOG = Object.freeze([
  {
    name: "get_current_time",
    title: "Get current time",
    toolset: "core.runtime"
  },
  {
    name: "convert_time_zone",
    title: "Convert time zone",
    toolset: "core.runtime"
  },
  {
    name: "calculate_date",
    title: "Calculate date",
    toolset: "core.runtime"
  },
  {
    name: "calculator",
    title: "Calculator",
    toolset: "core.runtime"
  },
  {
    name: "get_runtime_info",
    title: "Get runtime info",
    toolset: "core.runtime"
  },
  {
    name: "get_agent_status",
    title: "Get agent status",
    toolset: "core.runtime"
  },
  {
    name: "get_workspace_info",
    title: "Get workspace info",
    toolset: "workspace.read"
  },
  {
    name: "list_directory",
    title: "List directory",
    toolset: "workspace.read"
  },
  {
    name: "stat_path",
    title: "Inspect path",
    toolset: "workspace.read"
  },
  {
    name: "read_text_file",
    title: "Read text file",
    toolset: "workspace.read"
  },
  {
    name: "search_files",
    title: "Search files",
    toolset: "workspace.read"
  },
  {
    name: "search_text",
    title: "Search text",
    toolset: "workspace.read"
  },
  {
    name: "detect_project",
    title: "Detect project",
    toolset: "workspace.read"
  },
  {
    name: "compute_file_hash",
    title: "Compute file hash",
    toolset: "workspace.read"
  },
  {
    name: "update_plan",
    title: "Update task plan",
    toolset: "agent.internal"
  },
  {
    name: "ask_user",
    title: "Ask user",
    toolset: "agent.internal"
  }
]);

export const TOOLSET_IDS = Object.freeze([
  "core.runtime",
  "workspace.read",
  "agent.internal"
]);

export const SAFE_TOOL_NAMES =
  Object.freeze(
    SAFE_TOOL_CATALOG.map(
      (tool) => tool.name
    )
  );

export function resolveEnabledToolCatalog(
  settings = {}
) {
  if (settings.enabled === false) {
    return [];
  }

  const toolsets =
    settings.toolsets ?? {};
  const overrides =
    settings.overrides ?? {};
  const workspaceEnabled =
    settings.workspace
      ?.enabled !== false;

  return SAFE_TOOL_CATALOG.filter(
    (item) => {
      if (
        item.toolset ===
          "workspace.read" &&
        !workspaceEnabled
      ) {
        return false;
      }

      return (
        toolsets[item.toolset] !==
          false &&
        overrides[item.name] !==
          false
      );
    }
  );
}

export function resolveToolProfileId(
  settings = {}
) {
  if (settings.enabled === false) {
    return "disabled";
  }

  const enabled =
    resolveEnabledToolCatalog(settings);

  if (
    enabled.length ===
    SAFE_TOOL_CATALOG.length
  ) {
    return "workspace";
  }

  const workspaceTools =
    enabled.filter(
      (item) =>
        item.toolset ===
        "workspace.read"
    );
  const nonWorkspaceCount =
    SAFE_TOOL_CATALOG.filter(
      (item) =>
        item.toolset !==
        "workspace.read"
    ).length;

  if (
    workspaceTools.length === 0 &&
    enabled.length ===
      nonWorkspaceCount
  ) {
    return "chat";
  }

  return "custom";
}
