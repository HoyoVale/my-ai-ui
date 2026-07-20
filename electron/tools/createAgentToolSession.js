import path from "node:path";

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
  ToolPolicyEngine
} from "./core/ToolPolicyEngine.js";

import {
  ToolRuntime
} from "./core/ToolRuntime.js";

import {
  ToolEventStore
} from "./core/ToolEventStore.js";

import {
  ToolExecutionLedger
} from "./runtime-state/ToolExecutionLedger.js";

import {
  SubprocessSupervisor
} from "./process/SubprocessSupervisor.js";

import {
  createAiSdkToolSet,
  supportsStrictToolSchemas
} from "./adapters/aiSdkToolAdapter.js";

import {
  toolCircuitBreakers
} from "../runtime/runtimeCircuitBreakers.js";

import {
  RunPlanStore,
  createAgentToolDefinitions
} from "../agent/orchestration/agentTools.js";

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

import {
  getWorkspaceRoots
} from "./workspace/workspacePolicy.js";

export function createAgentToolSession({
  activeModel = null,
  getAgentStatus = null,
  getSegmentId = null,
  abortSignal = null,
  onRecord = null,
  onPlanChange = null,
  activityStore = null,
  settings = {},
  initialPlan = [],
  resultStoreDirectory = "",
  taskId = "",
  runId = "",
  workspaceId = "",
  segmentId = ""
} = {}) {
  const planStore =
    new RunPlanStore(
      initialPlan,
      {
        onChange: onPlanChange
      }
    );
  const resultStore =
    new ToolResultStore({
      storageDirectory:
        resultStoreDirectory,
      taskId,
      workspaceId,
      segmentId: getSegmentId ? "" : segmentId
    });
  const runtimeDirectory = resultStoreDirectory
    ? path.join(resultStoreDirectory, "runtime")
    : "";
  const executionLedger = new ToolExecutionLedger({
    directory: runtimeDirectory,
    taskId,
    runId,
    workspaceId,
    ownerId: runId || undefined
  });
  const subprocessSupervisor = new SubprocessSupervisor({
    defaultTimeoutMs:
      settings.tools?.runtime?.defaultTimeoutMs ?? 15_000,
    terminationGraceMs: 2_000
  });
  const toolSettings =
    settings.tools ?? {};
  const workspaceSettings =
    toolSettings.workspace ?? {};
  const hasWorkspace =
    getWorkspaceRoots(
      workspaceSettings
    ).length > 0;

  const registry = new ToolRegistry()
    .registerMany(
      createDateTimeToolDefinitions(),
      {
        source: "builtin.datetime",
        toolset: "core.runtime",
        sideEffect: "none",
        riskLevel: "none"
      }
    )
    .registerMany(
      createRuntimeToolDefinitions({
        activeModel,
        getAgentStatus,
        getPlan: () => planStore.get(),
        settings
      }),
      {
        source: "builtin.runtime",
        toolset: "core.runtime",
        sideEffect: "none",
        riskLevel: "none"
      }
    )
    .registerMany(
      hasWorkspace
        ? createWorkspaceToolDefinitions(
            workspaceSettings
          )
        : [],
      {
        source: "builtin.workspace",
        toolset: "workspace.read",
        sideEffect: "read",
        riskLevel: "low"
      }
    )
    .registerMany(
      createAgentToolDefinitions({
        resultStore,
        planStore
      }),
      {
        source: "builtin.agent",
        toolset: "agent.internal",
        sideEffect: "none",
        riskLevel: "none"
      }
    );

  const definitions = registry.list();

  const enabledNames = new Set(
    resolveEnabledToolCatalog(
      toolSettings,
      registry.manifest()
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
        taskId,
        workspaceId,
        segmentId,
        mode: "interactive",
        subprocessSupervisor
      },
      policyEngine: new ToolPolicyEngine({
        authorize: ({ definition, input }) => {
          const permission = planStore.canRunTool(
            definition.name,
            input
          );
          return permission?.ok === false
            ? {
                decision: "deny",
                code: permission.code,
                message: permission.message,
                details: permission.details
              }
            : { decision: "allow" };
        }
      }),
      getRecordMetadata: ({ definition } = {}) => {
        const active = planStore.getExecutionState().active;
        let batch = activityStore?.getActiveBatch?.() ?? null;

        if (!batch) {
          batch = activityStore?.beginBatch?.(
            active?.title ??
            definition?.title ??
            definition?.name ??
            "工具执行"
          ) ?? null;
        }

        return {
          batch,
          planStep: active
            ? { id: active.id, title: active.title }
            : null
        };
      },
      eventStore: new ToolEventStore({
        storageFile:
          toolSettings.runtime?.saveToolHistory !== false &&
          resultStoreDirectory &&
          segmentId
            ? path.join(
                resultStoreDirectory,
                `tool-events-${String(segmentId).replace(/[^a-zA-Z0-9_-]/g, "_")}.jsonl`
              )
            : ""
      }),
      onRecord,
      defaultTimeoutMs:
        toolSettings.runtime
          ?.defaultTimeoutMs ??
        15000,
      maxToolCalls:
        toolSettings.runtime
          ?.maxToolCalls ??
        100,
      maxTotalToolCalls:
        toolSettings.runtime
          ?.maxTotalToolCalls ??
        2000,
      maxIdenticalCalls:
        toolSettings.runtime
          ?.maxIdenticalCalls ??
        3,
      maxToolCallsPerStep:
        toolSettings.runtime
          ?.maxToolCallsPerStep ??
        16,
      maxToolCallsPerBatch:
        toolSettings.runtime
          ?.maxToolCallsPerBatch ??
        24,
      runTimeoutMs:
        toolSettings.runtime
          ?.runTimeoutMs ??
        1800000,
      resultStore,
      maxRetries:
        toolSettings.runtime
          ?.maxToolRetries ??
        1,
      maxConcurrent:
        toolSettings.runtime
          ?.maxConcurrent ??
        4,
      executionLedger,
      circuitBreakers: toolCircuitBreakers
    });
  const runtime = new ToolRuntime({
    definitions: enabledDefinitions,
    executor
  });

  return {
    definitions:
      runtime.list(),
    registryManifest:
      registry.manifest(),
    tools:
      createAiSdkToolSet(
        runtime.list(),
        (definition, input, options) =>
          runtime.invoke(
            definition.name,
            input,
            {
              ...(options ?? {}),
              segmentId: getSegmentId?.() || segmentId
            }
          ),
        {
          supportsStrictSchemas:
            supportsStrictToolSchemas(activeModel ?? {})
        }
      ),
    getRecords: () =>
      runtime.getRecords(),
    getPlan: () =>
      planStore.get(),
    getResultEntries: () =>
      resultStore.list(),
    getCallCount: () =>
      runtime.getCallCount(),
    getBudget: () =>
      runtime.getBudget(),
    getEvents: () =>
      runtime.getEvents(),
    getRuntimeRecovery: () =>
      executionLedger.publicSnapshot(),
    getRuntimeDiagnostics: () => ({
      ...executionLedger.developerSnapshot(),
      circuitBreakers: toolCircuitBreakers.snapshot(),
      subprocesses: subprocessSupervisor.snapshot()
    }),
    reconcileRuntime: (options = {}) =>
      executionLedger.reconcile(enabledDefinitions, options),
    resolveRuntimeRecovery: (request = {}) =>
      executionLedger.resolveRecovery({
        ...request,
        definitions: enabledDefinitions
      }),
    recordRuntimeEvent: (type, payload, options) =>
      executionLedger.recordRuntimeEvent(type, payload, options),
    storeRuntimeCheckpoint: (checkpoint, options) =>
      executionLedger.storeCheckpoint(checkpoint, options),
    getPersistedRuntimeCheckpoint: () =>
      executionLedger.loadCheckpoint(),
    beginStep: (scope) =>
      executor.beginStep(scope),
    endStep: (stepId) =>
      executor.endStep(stepId),
    flushPersistence: async () => {
      await Promise.all([
        executor.eventStore.flush(),
        executionLedger.flush()
      ]);
      return true;
    },
    closePersistence: async () => {
      await subprocessSupervisor.terminateAll("session-close");
      const results = await Promise.all([
        executor.eventStore.close(),
        executionLedger.close()
      ]);
      return results.every((result) => result !== false);
    }
  };
}
