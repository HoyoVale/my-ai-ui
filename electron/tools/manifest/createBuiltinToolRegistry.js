import {
  ToolRegistry
} from "../core/ToolRegistry.js";

import {
  RunPlanStore,
  createAgentToolDefinitions
} from "../../agent/orchestration/agentTools.js";

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
    getPlan = null,
    settings = {},
    workspaceSettings = settings.tools?.workspace ?? {},
    includeWorkspaceDefinitions = false,
    includeWorkspaceInfo = includeWorkspaceDefinitions,
    resultStore = null,
    planStore = null
  } = {}
) {
  const target = registry ?? new ToolRegistry();
  const effectivePlanStore = planStore ?? new RunPlanStore();

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
        getPlan: getPlan ?? (() => effectivePlanStore.get()),
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
        ? withPresentation(createWorkspaceToolDefinitions(workspaceSettings))
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
      withPresentation(createAgentToolDefinitions({
        resultStore,
        planStore: effectivePlanStore
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
