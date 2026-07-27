import {
  ToolRegistry
} from "../core/ToolRegistry.js";

import {
  createAgentUtilityToolDefinitions
} from "../runtime/agentUtilityTools.js";

import {
  createDateTimeToolDefinitions
} from "../runtime/dateTimeTools.js";

import {
  createRuntimeToolDefinitions
} from "../runtime/runtimeTools.js";

import {
  createWorkspaceToolDefinitions
} from "../workspace/workspaceTools.js";

import {
  createWorkspaceGitReadToolDefinitions
} from "../workspace/workspaceGitReadTools.js";

import {
  createWorkspaceWriteToolDefinitions
} from "../workspace/workspaceWriteTools.js";

import {
  createWorkspaceProcessToolDefinitions
} from "../workspace/workspaceProcessTools.js";

import {
  getBuiltinToolPresentation
} from "./builtinToolPresentation.js";

function withPresentation(definitions = []) {
  return definitions.map((definition) => ({
    ...definition,
    presentation: {
      ...(definition.presentation ?? {}),
      ...(getBuiltinToolPresentation(definition.name) ?? {})
    }
  }));
}

export function registerBuiltinToolDefinitions(
  registry,
  {
    activeModel = null,
    getAgentStatus = null,
    settings = {},
    workspaceSettings = settings.tools?.workspace ?? {},
    includeWorkspaceDefinitions = false,
    includeWorkspaceInfo = includeWorkspaceDefinitions,
    continuityReadCacheDirectory = "",
    resultStore = null
  } = {}
) {
  const target = registry ?? new ToolRegistry();
  target
    .registerMany(
      withPresentation(createDateTimeToolDefinitions()),
      {
        source: "builtin.datetime",
        toolset: "core.runtime",
        sideEffect: "none",
        riskLevel: "none"
      }
    )
    .registerMany(
      withPresentation(createRuntimeToolDefinitions({
        activeModel,
        getAgentStatus,
        settings,
        includeWorkspaceInfo
      })),
      {
        source: "builtin.runtime",
        toolset: "core.runtime",
        sideEffect: "none",
        riskLevel: "none"
      }
    )
    .registerMany(
      includeWorkspaceDefinitions
        ? withPresentation(createWorkspaceToolDefinitions({
            ...workspaceSettings,
            continuityReadCacheDirectory
          }))
        : [],
      {
        source: "builtin.workspace",
        toolset: "workspace.read",
        sideEffect: "read",
        riskLevel: "low"
      }
    )
    .registerMany(
      includeWorkspaceDefinitions
        ? withPresentation(createWorkspaceGitReadToolDefinitions(workspaceSettings))
        : [],
      {
        source: "builtin.workspace.git",
        toolset: "workspace.read",
        sideEffect: "read",
        riskLevel: "low"
      }
    )
    .registerMany(
      includeWorkspaceDefinitions
        ? withPresentation(createWorkspaceWriteToolDefinitions(workspaceSettings))
        : [],
      {
        source: "builtin.workspace",
        toolset: "workspace.write",
        sideEffect: "write",
        riskLevel: "medium"
      }
    )
    .registerMany(
      includeWorkspaceDefinitions
        ? withPresentation(createWorkspaceProcessToolDefinitions(workspaceSettings))
        : [],
      {
        source: "builtin.workspace",
        toolset: "workspace.exec",
        sideEffect: "external",
        riskLevel: "high"
      }
    )
    .registerMany(
      withPresentation(createAgentUtilityToolDefinitions({
        resultStore
      })),
      {
        source: "builtin.agent",
        toolset: "agent.internal",
        sideEffect: "none",
        riskLevel: "none"
      }
    );

  return target;
}

export function createBuiltinToolRegistry(options = {}) {
  return registerBuiltinToolDefinitions(new ToolRegistry(), options);
}
