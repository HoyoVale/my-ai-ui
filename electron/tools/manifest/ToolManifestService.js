import crypto from "node:crypto";

import {
  resolveActiveModelSettings
} from "../../settings/modelSettings.js";

import {
  getWorkspaceRoots
} from "../workspace/workspacePolicy.js";

import {
  baseToolsetEnabled,
  resolveEnabledToolCatalog,
  resolveToolMode
} from "../toolCatalog.js";

import {
  BUILTIN_TOOLSET_MANIFEST,
  getBuiltinToolsetManifest
} from "./builtinToolPresentation.js";

import {
  createBuiltinToolRegistry
} from "./createBuiltinToolRegistry.js";

const OVERRIDE_VALUES = new Set([
  "inherit",
  "enabled",
  "disabled"
]);

function overrideValue(value) {
  return OVERRIDE_VALUES.has(value) ? value : "inherit";
}

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 20);
}

function resolveActiveModel(settings) {
  try {
    return resolveActiveModelSettings(settings.model);
  } catch {
    return null;
  }
}

function toolAvailability(tool, settings) {
  const toolSettings = settings.tools ?? {};
  const workspaceSettings = toolSettings.workspace ?? {};
  const mode = resolveToolMode(toolSettings);
  const toolset = tool.toolsets?.[0] ?? "core.runtime";
  const roots = getWorkspaceRoots(workspaceSettings);

  if (toolset.startsWith("workspace.") && roots.length === 0) {
    return {
      available: false,
      reason: "当前没有绑定工作区。"
    };
  }

  if (toolset === "workspace.write" && mode !== "coding") {
    return {
      available: false,
      reason: "工作区写入仅在 Coding 模式可用。"
    };
  }

  if (toolset === "workspace.exec") {
    const toolsetOverride = overrideValue(
      toolSettings.developer?.toolsetOverrides?.[toolset]
    );
    if (toolsetOverride !== "enabled") {
      return {
        available: false,
        reason: "工作区进程工具需要开发者显式强制启用。"
      };
    }
  }

  if (
    tool.name === "run_workspace_command" &&
    (workspaceSettings.allowedCommands ?? []).length === 0
  ) {
    return {
      available: false,
      reason: "尚未配置允许执行的命令。"
    };
  }

  return {
    available: true,
    reason: ""
  };
}

function toolsetEffectiveState(toolsetId, settings) {
  const toolSettings = settings.tools ?? {};
  const mode = resolveToolMode(toolSettings);
  const override = overrideValue(
    toolSettings.developer?.toolsetOverrides?.[toolsetId]
  );
  let enabled = baseToolsetEnabled(mode, toolsetId);

  if (override === "enabled") {
    enabled = true;
  } else if (override === "disabled") {
    enabled = false;
  }

  if (toolsetId === "workspace.write" && mode !== "coding") {
    enabled = false;
  }
  if (toolsetId === "workspace.exec" && override !== "enabled") {
    enabled = false;
  }
  if (toolSettings.enabled === false) {
    enabled = false;
  }

  return {
    override,
    enabled
  };
}

export function getToolManifestSnapshot({ settings = {} } = {}) {
  const toolSettings = settings.tools ?? {};
  const registry = createBuiltinToolRegistry({
    activeModel: resolveActiveModel(settings),
    settings,
    workspaceSettings: toolSettings.workspace ?? {},
    includeWorkspaceDefinitions: true,
    includeWorkspaceInfo: true
  });
  const rawTools = registry.manifest();
  const enabledNames = new Set(
    resolveEnabledToolCatalog(toolSettings, rawTools).map((tool) => tool.name)
  );

  const tools = rawTools.map((tool) => {
    const toolsetId = tool.toolsets?.[0] ?? "core.runtime";
    const presentation = tool.presentation ?? {};
    const availability = toolAvailability(tool, settings);
    const override = overrideValue(
      toolSettings.developer?.toolOverrides?.[tool.name]
    );
    const effectiveEnabled = enabledNames.has(tool.name);

    return {
      ...tool,
      toolsetId,
      displayTitle: presentation.title || tool.title || tool.name,
      displayDescription: presentation.description || tool.description || "",
      sourceKind: tool.source?.startsWith("mcp.")
        ? "mcp"
        : tool.source?.startsWith("builtin.")
          ? "builtin"
          : "custom",
      builtIn: tool.source?.startsWith("builtin.") === true,
      override,
      effectiveEnabled,
      available: availability.available,
      availabilityReason: availability.reason,
      ready: effectiveEnabled && availability.available,
      editable: {
        implementation: false,
        schema: false,
        description: false,
        override: true
      }
    };
  });

  const toolsets = BUILTIN_TOOLSET_MANIFEST.map((item) => {
    const state = toolsetEffectiveState(item.id, settings);
    const members = tools.filter((tool) => tool.toolsetId === item.id);
    return {
      ...item,
      ...state,
      toolCount: members.length,
      enabledToolCount: members.filter((tool) => tool.ready).length,
      tools: members
    };
  });

  const unknownToolsets = [...new Set(
    tools.map((tool) => tool.toolsetId)
      .filter((id) => !getBuiltinToolsetManifest(id))
  )].map((id, index) => {
    const state = toolsetEffectiveState(id, settings);
    const members = tools.filter((tool) => tool.toolsetId === id);
    return {
      id,
      title: id,
      description: "外接工具组",
      riskLabel: "外接",
      userVisible: true,
      order: 1000 + index,
      ...state,
      toolCount: members.length,
      enabledToolCount: members.filter((tool) => tool.ready).length,
      tools: members
    };
  });

  const result = {
    schemaVersion: 1,
    generatedAt: Date.now(),
    mode: resolveToolMode(toolSettings),
    globalEnabled: toolSettings.enabled !== false,
    sourceSummary: {
      builtin: tools.filter((tool) => tool.sourceKind === "builtin").length,
      mcp: tools.filter((tool) => tool.sourceKind === "mcp").length,
      custom: tools.filter((tool) => tool.sourceKind === "custom").length
    },
    toolsets: [...toolsets, ...unknownToolsets]
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0)),
    tools
  };

  return {
    ...result,
    revision: stableHash({
      schemaVersion: result.schemaVersion,
      mode: result.mode,
      globalEnabled: result.globalEnabled,
      toolsets: result.toolsets,
      tools: result.tools
    })
  };
}
