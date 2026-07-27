import path from "node:path";

import {
  ToolExecutor
} from "./core/ToolExecutor.js";

import {
  ToolResultStore
} from "./core/ToolResultStore.js";

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
  resolveEnabledToolCatalog,
  resolveToolMode
} from "./toolCatalog.js";

import {
  createBuiltinToolRegistry
} from "./manifest/createBuiltinToolRegistry.js";

import {
  getWorkspaceRoots
} from "./workspace/workspacePolicy.js";

import {
  resolveCapabilitySet
} from "./capabilities/CapabilityResolver.js";

export function createAgentToolSession({
  activeModel = null,
  getAgentStatus = null,
  getSegmentId = null,
  abortSignal = null,
  onRecord = null,
  activityStore = null,
  settings = {},
  resultStoreDirectory = "",
  taskId = "",
  runId = "",
  workspaceId = "",
  mode = null,
  segmentId = "",
  faultInjector = null,
  externalDefinitions = [],
  authorizeTool = null,
  capabilityRequest = null,
  onFileMutation = null
} = {}) {
  const runtimePartitionId = String(
    segmentId || runId || ""
  ).trim();

  const resultStore =
    new ToolResultStore({
      storageDirectory:
        resultStoreDirectory,
      taskId,
      workspaceId,
      segmentId: getSegmentId ? "" : runtimePartitionId
    });
  const runtimeDirectory = resultStoreDirectory
    ? path.join(resultStoreDirectory, "runtime")
    : "";
  const executionLedger = new ToolExecutionLedger({
    directory: runtimeDirectory,
    taskId,
    runId,
    workspaceId,
    ownerId: runId || undefined,
    journalOptions: {
      maxFileBytes:
        settings.tools?.runtime?.journalMaxFileBytes ?? 8_000_000,
      maxArchiveFiles:
        settings.tools?.runtime?.journalMaxArchives ?? 6,
      maxTotalBytes:
        settings.tools?.runtime?.journalMaxTotalBytes ?? 48_000_000
    }
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
  const sessionMode = ["chat", "coding"].includes(mode)
    ? mode
    : resolveToolMode(toolSettings);
  const hasWorkspace =
    getWorkspaceRoots(
      workspaceSettings
    ).length > 0;

  const registry = createBuiltinToolRegistry({
    activeModel,
    getAgentStatus,
    settings,
    workspaceSettings,
    includeWorkspaceDefinitions: hasWorkspace,
    includeWorkspaceInfo: hasWorkspace,
    continuityReadCacheDirectory: resultStoreDirectory
      ? path.join(resultStoreDirectory, "continuity-read-cache")
      : "",
    resultStore
  });

  registry.registerMany(externalDefinitions);

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

  const capabilityResolution = resolveCapabilitySet({
    tools: enabledDefinitions,
    mode: sessionMode,
    workspaceAvailable: hasWorkspace,
    settings,
    request: capabilityRequest ?? {}
  });
  const enforceCapabilityApproval = Boolean(
    capabilityRequest &&
    typeof capabilityRequest === "object" &&
    Object.keys(capabilityRequest).length > 0
  );
  const capabilitySelectedNames = new Set(
    capabilityResolution.selectedToolNames
  );
  const capabilityDefinitions = enabledDefinitions.filter((definition) =>
    capabilitySelectedNames.has(definition.name) &&
    capabilityResolution.toolDecisions[definition.name]?.allowed !== false
  );

  const executor =
    new ToolExecutor({
      context: {
        abortSignal,
        taskId,
        workspaceId,
        segmentId: runtimePartitionId,
        mode: sessionMode,
        subprocessSupervisor,
        onFileMutation
      },
      policyEngine: new ToolPolicyEngine({
        authorize: async (request) => {
          const capabilityDecision = enforceCapabilityApproval
            ? capabilityResolution.toolDecisions[request.definition.name] ?? null
            : null;
          return typeof authorizeTool === "function"
            ? await authorizeTool({
                ...request,
                capabilityDecision
              })
            : { decision: "allow" };
        }
      }),
      getRecordMetadata: ({ definition } = {}) => {
        let batch = activityStore?.getActiveBatch?.() ?? null;

        if (!batch) {
          batch = activityStore?.beginBatch?.(
            definition?.title ??
            definition?.name ??
            "工具执行"
          ) ?? null;
        }

        return { batch };
      },
      eventStore: new ToolEventStore({
        storageFile:
          toolSettings.runtime?.saveToolHistory !== false &&
          resultStoreDirectory &&
          runtimePartitionId
            ? path.join(
                resultStoreDirectory,
                `tool-events-${runtimePartitionId.replace(/[^a-zA-Z0-9_-]/g, "_")}.jsonl`
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
      circuitBreakers: toolCircuitBreakers,
      faultInjector
    });
  const runtime = new ToolRuntime({
    definitions: capabilityDefinitions,
    executor
  });

  return {
    definitions:
      runtime.list(),
    registryManifest:
      registry.manifest(),
    capabilityResolution:
      structuredClone(capabilityResolution),
    tools:
      createAiSdkToolSet(
        runtime.list(),
        (definition, input, options) =>
          runtime.invoke(
            definition.name,
            input,
            {
              ...(options ?? {}),
              segmentId: getSegmentId?.() || runtimePartitionId
            }
          ),
        {
          supportsStrictSchemas:
            supportsStrictToolSchemas(activeModel ?? {})
        }
      ),
    getRecords: () =>
      runtime.getRecords(),
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
    getRuntimeCursor: () =>
      executionLedger.recoveryCursor(),
    getRuntimeDiagnostics: () => ({
      ...executionLedger.developerSnapshot(),
      circuitBreakers: toolCircuitBreakers.snapshot(),
      subprocesses: subprocessSupervisor.snapshot(),
      scheduler: executor.scheduler?.snapshot?.() ?? null
    }),
    reconcileRuntime: (options = {}) =>
      executionLedger.reconcile(capabilityDefinitions, options),
    resolveRuntimeRecovery: (request = {}) =>
      executionLedger.resolveRecovery({
        ...request,
        definitions: capabilityDefinitions
      }),
    recordRuntimeEvent: (type, payload, options) =>
      executionLedger.recordRuntimeEvent(type, payload, options),
    storeRuntimeCheckpoint: (checkpoint, options) =>
      executionLedger.storeCheckpoint(checkpoint, options),
    getPersistedRuntimeCheckpoint: () =>
      executionLedger.loadCheckpoint(),
    recoverRuntimeCheckpoint: () =>
      executionLedger.recoverCheckpoint(),
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
