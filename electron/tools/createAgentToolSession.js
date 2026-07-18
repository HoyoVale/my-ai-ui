import {
  ToolExecutor
} from "./core/ToolExecutor.js";

import {
  ToolResultStore
} from "./core/ToolResultStore.js";

import {
  ToolRegistry
} from "./core/ToolRegistry.js";

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
  onPlanChange = null,
  onQuestion = null,
  activityStore = null,
  settings = {},
  initialPlan = [],
  answeredQuestions = [],
  initialQuestionCount = 0,
  resultStoreDirectory = ""
} = {}) {
  const planStore =
    new RunPlanStore(
      initialPlan,
      {
        onChange: onPlanChange,
        onQuestion,
        answeredQuestions,
        initialQuestionCount,
        maxQuestions:
          settings.tools
            ?.runtime
            ?.maxAskUserCalls ??
          3
      }
    );
  const resultStore =
    new ToolResultStore({
      storageDirectory:
        resultStoreDirectory
    });
  const toolSettings =
    settings.tools ?? {};
  const workspaceSettings =
    toolSettings.workspace ?? {};

  const registry = new ToolRegistry()
    .registerMany(
      createDateTimeToolDefinitions(),
      {
        source: "builtin.datetime",
        sideEffect: "none",
        riskLevel: "none"
      }
    )
    .registerMany(
      createRuntimeToolDefinitions({
        activeModel,
        getAgentStatus,
        settings
      }),
      {
        source: "builtin.runtime",
        sideEffect: "none",
        riskLevel: "none"
      }
    )
    .registerMany(
      createWorkspaceToolDefinitions(
        workspaceSettings
      ),
      {
        source: "builtin.workspace",
        sideEffect: "read",
        riskLevel: "low"
      }
    )
    .registerMany(
      createAgentToolDefinitions({
        resultStore
      }),
      {
        source: "builtin.agent",
        sideEffect: "none",
        riskLevel: "none"
      }
    );

  const definitions = registry.list();

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
        planStore,
        activityStore,
        getActiveBatch: () =>
          activityStore?.getActiveBatch?.() ?? null
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
      resultStore,
      maxRetries:
        toolSettings.runtime
          ?.maxToolRetries ??
        1
    });

  return {
    definitions:
      enabledDefinitions,
    registryManifest:
      registry.manifest(),
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
