import {
  BUILTIN_TOOLSET_MANIFEST,
  BUILTIN_TOOL_PRESENTATION
} from "./manifest/builtinToolPresentation.js";

export const SAFE_TOOL_CATALOG = Object.freeze(
  Object.entries(BUILTIN_TOOL_PRESENTATION).map(([name, item]) => ({
    name,
    title: item.title,
    toolset: item.toolset
  }))
);

export const TOOLSET_IDS = Object.freeze(
  BUILTIN_TOOLSET_MANIFEST.map((toolset) => toolset.id)
);

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

export function baseToolsetEnabled(mode, toolset) {
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
  const hasModernOverrides =
    settings.developer &&
    typeof settings.developer === "object";
  const developer = settings.developer ?? {};
  const toolsetOverrides = developer.toolsetOverrides ?? {};
  const toolOverrides = developer.toolOverrides ?? {};
  const legacyToolsets = hasModernOverrides ? {} : (settings.toolsets ?? {});
  const legacyOverrides = hasModernOverrides ? {} : (settings.overrides ?? {});

  return catalog.filter((item) => {
    const toolset = item.toolset ?? item.toolsets?.[0] ?? "core.runtime";
    let toolsetEnabled = baseToolsetEnabled(mode, toolset);

    if (typeof legacyToolsets[toolset] === "boolean") {
      toolsetEnabled = legacyToolsets[toolset];
    }

    const toolsetOverride = overrideValue(toolsetOverrides[toolset]);

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

    const toolOverride = overrideValue(toolOverrides[item.name]);

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
