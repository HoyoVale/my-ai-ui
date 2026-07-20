export const SAFE_TOOL_CATALOG = Object.freeze([
  { name: "get_current_time", title: "Get current time", toolset: "core.runtime" },
  { name: "convert_time_zone", title: "Convert time zone", toolset: "core.runtime" },
  { name: "calculate_date", title: "Calculate date", toolset: "core.runtime" },
  { name: "calculator", title: "Calculator", toolset: "core.runtime" },
  { name: "get_runtime_info", title: "Get runtime info", toolset: "core.runtime" },
  { name: "get_agent_status", title: "Get agent status", toolset: "core.runtime" },
  { name: "get_workspace_info", title: "Get workspace info", toolset: "workspace.read" },
  { name: "list_directory", title: "List directory", toolset: "workspace.read" },
  { name: "stat_path", title: "Inspect path", toolset: "workspace.read" },
  { name: "read_text_file", title: "Read text file", toolset: "workspace.read" },
  { name: "search_files", title: "Search files", toolset: "workspace.read" },
  { name: "search_text", title: "Search text", toolset: "workspace.read" },
  { name: "detect_project", title: "Detect project", toolset: "workspace.read" },
  { name: "compute_file_hash", title: "Compute file hash", toolset: "workspace.read" },
  { name: "write_text_file", title: "Write text file", toolset: "workspace.write" },
  { name: "git_inspect", title: "Inspect Git repository", toolset: "workspace.exec" },
  { name: "run_workspace_command", title: "Run workspace command", toolset: "workspace.exec" },
  { name: "update_plan", title: "Update task plan", toolset: "agent.internal" },
  { name: "read_tool_result", title: "Read tool result", toolset: "agent.internal" }
]);

export const TOOLSET_IDS = Object.freeze([
  "core.runtime",
  "workspace.read",
  "workspace.write",
  "workspace.exec",
  "agent.internal"
]);

export const SAFE_TOOL_NAMES = Object.freeze(
  SAFE_TOOL_CATALOG.map((tool) => tool.name)
);

const OVERRIDE_VALUES = new Set([
  "inherit",
  "enabled",
  "disabled"
]);

function normalizeMode(settings = {}) {
  if (settings.mode === "coding") {
    return "coding";
  }

  if (settings.mode === "chat") {
    return "chat";
  }

  return settings.profile === "workspace"
    ? "coding"
    : "chat";
}

function overrideValue(value) {
  return OVERRIDE_VALUES.has(value)
    ? value
    : "inherit";
}

function baseToolsetEnabled(mode, toolset) {
  if (toolset === "workspace.read") {
    return true;
  }

  if (toolset === "workspace.write") {
    return mode === "coding";
  }

  // Process execution is intentionally opt-in through a developer override.
  if (toolset === "workspace.exec") {
    return false;
  }

  return true;
}

export function resolveEnabledToolCatalog(
  settings = {},
  catalog = SAFE_TOOL_CATALOG
) {
  if (settings.enabled === false) {
    return [];
  }

  const mode = normalizeMode(settings);
  const developer = settings.developer ?? {};
  const toolsetOverrides = developer.toolsetOverrides ?? {};
  const toolOverrides = developer.toolOverrides ?? {};
  const legacyToolsets = settings.toolsets ?? {};
  const legacyOverrides = settings.overrides ?? {};

  return catalog.filter((item) => {
    const toolset = item.toolset ?? item.toolsets?.[0] ?? "core.runtime";
    let toolsetEnabled = baseToolsetEnabled(mode, toolset);

    if (typeof legacyToolsets[toolset] === "boolean") {
      toolsetEnabled = legacyToolsets[toolset];
    }

    const toolsetOverride = overrideValue(
      toolsetOverrides[toolset]
    );

    if (toolsetOverride === "enabled") {
      toolsetEnabled = true;
    } else if (toolsetOverride === "disabled") {
      toolsetEnabled = false;
    }

    // Fixed safety boundaries cannot be relaxed by legacy toggles.
    if (toolset === "workspace.write" && mode !== "coding") {
      return false;
    }
    if (toolset === "workspace.exec" && toolsetOverride !== "enabled") {
      return false;
    }

    if (!toolsetEnabled) {
      return false;
    }

    const toolOverride = overrideValue(
      toolOverrides[item.name]
    );

    if (toolOverride === "enabled") {
      return true;
    }

    if (toolOverride === "disabled") {
      return false;
    }

    if (typeof legacyOverrides[item.name] === "boolean") {
      return legacyOverrides[item.name];
    }

    return true;
  });
}

export function resolveToolMode(settings = {}) {
  return normalizeMode(settings);
}

export function hasDeveloperToolOverrides(settings = {}) {
  const developer = settings.developer ?? {};

  return [
    ...Object.values(developer.toolsetOverrides ?? {}),
    ...Object.values(developer.toolOverrides ?? {})
  ].some((value) => overrideValue(value) !== "inherit");
}

export function resolveToolProfileId(settings = {}) {
  if (settings.enabled === false) {
    return "disabled";
  }

  const mode = normalizeMode(settings);

  return hasDeveloperToolOverrides(settings)
    ? `${mode}-custom`
    : mode;
}
