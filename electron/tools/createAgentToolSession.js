import {
  ToolExecutor
} from "./core/ToolExecutor.js";

import {
  ToolResultStore
} from "./core/ToolResultStore.js";

import {
  RunPlanStore,
  createAgentToolDefinitions
} from "./agent/agentTools.js";

import {
  createDateTimeToolDefinitions
} from "./runtime/dateTimeTools.js";

import {
  createRuntimeToolDefinitions
} from "./runtime/runtimeTools.js";

import {
  resolveEnabledToolCatalog
} from "./toolCatalog.js";

import {
  createWorkspaceToolDefinitions
} from "./workspace/workspaceTools.js";

export function createAgentToolSession({
  activeModel = null,
  getAgentStatus = null,
  abortSignal = null,
  onRecord = null,
  settings = {},
  initialPlan = []
} = {}) {
  const planStore =
    new RunPlanStore(
      initialPlan
    );
  const resultStore =
    new ToolResultStore();
  const toolSettings =
    settings.tools ?? {};
  const workspaceSettings =
    toolSettings.workspace ?? {};

  const definitions = [
    ...createDateTimeToolDefinitions(),
    ...createRuntimeToolDefinitions({
      activeModel,
      getAgentStatus,
      settings
    }),
    ...createWorkspaceToolDefinitions(
      workspaceSettings
    ),
    ...createAgentToolDefinitions({
      resultStore
    })
  ];

  const enabledNames = new Set(
    resolveEnabledToolCatalog(
      toolSettings
    ).map((item) => item.name)
  );

  const enabledDefinitions =
    definitions.filter(
      (definition) =>
        enabledNames.has(
          definition.name
        )
    );

  const executor =
    new ToolExecutor({
      context: {
        abortSignal,
        planStore
      },
      onRecord,
      defaultTimeoutMs:
        toolSettings.runtime
          ?.defaultTimeoutMs ??
        15000,
      maxToolCalls:
        toolSettings.runtime
          ?.maxToolCalls ??
        12,
      maxIdenticalCalls:
        toolSettings.runtime
          ?.maxIdenticalCalls ??
        2,
      runTimeoutMs:
        toolSettings.runtime
          ?.runTimeoutMs ??
        120000,
      resultStore
    });

  return {
    definitions:
      enabledDefinitions,
    tools:
      executor.buildToolSet(
        enabledDefinitions
      ),
    getRecords: () =>
      executor.getRecords(),
    getPlan: () =>
      planStore.get(),
    getPendingQuestion: () =>
      planStore
        .getPendingQuestion(),
    getResultEntries: () =>
      resultStore.list(),
    getCallCount: () =>
      executor.getCallCount()
  };
}
