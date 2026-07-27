import { z } from "zod";

import {
  createRuntimeSnapshot
} from "../../runtime/runtimeContextProvider.js";

import {
  getWorkspacePolicySummary
} from "../workspace/workspacePolicy.js";

import {
  resolveEnabledToolCatalog,
  resolveToolProfileId
} from "../toolCatalog.js";

const MAX_OBJECTIVE_LENGTH = 500;

function compactAgentStatus(status, { activeModel, toolProfile }) {
  const source = status && typeof status === "object" ? status : {};
  const objective = String(
    source.objective ?? source.currentObjective ?? ""
  ).trim();

  return {
    state: String(source.state ?? "unknown"),
    phase: String(source.phase ?? "idle"),
    outcome: String(source.outcome ?? "idle"),
    publicStatus: String(source.publicStatus ?? ""),
    runId: source.runId ? String(source.runId) : null,
    taskId: source.taskId ? String(source.taskId) : null,
    conversationId: source.conversationId
      ? String(source.conversationId)
      : null,
    startedAt: Number.isFinite(Number(source.startedAt))
      ? Number(source.startedAt)
      : null,
    stepNumber: Math.max(0, Number(source.stepNumber) || 0),
    resumable: source.resumable === true,
    stopReason: source.stopReason
      ? String(source.stopReason).slice(0, 200)
      : null,
    executionStopReason: source.executionStopReason
      ? String(source.executionStopReason).slice(0, 200)
      : null,
    lastError: source.lastError
      ? String(
          typeof source.lastError === "object"
            ? source.lastError.message ?? ""
            : source.lastError
        ).slice(0, 400)
      : null,
    objective: objective
      ? objective.slice(0, MAX_OBJECTIVE_LENGTH)
      : "",
    activeModel: activeModel
      ? {
          providerId: activeModel.providerId,
          providerName: activeModel.providerName,
          modelName: activeModel.modelName,
          modelId: activeModel.model,
          contextTokenBudget: activeModel.contextTokenBudget,
          maxOutputTokens: activeModel.maxOutputTokens
        }
      : null,
    toolProfile
  };
}

const agentStatusOutputSchema = z.object({
  state: z.string(),
  phase: z.string(),
  outcome: z.string(),
  publicStatus: z.string(),
  runId: z.string().nullable(),
  taskId: z.string().nullable(),
  conversationId: z.string().nullable(),
  startedAt: z.number().nullable(),
  stepNumber: z.number().nonnegative(),
  resumable: z.boolean(),
  stopReason: z.string().nullable(),
  executionStopReason: z.string().nullable(),
  lastError: z.string().nullable(),
  objective: z.string(),
  activeModel: z.object({
    providerId: z.string().optional(),
    providerName: z.string().optional(),
    modelName: z.string().optional(),
    modelId: z.string().optional(),
    contextTokenBudget: z.number().optional(),
    maxOutputTokens: z.number().optional()
  }).nullable(),
  toolProfile: z.string()
});

export function createRuntimeToolDefinitions({
  activeModel = null,
  getAgentStatus = () => ({
    state: "unknown"
  }),
  settings = {},
  includeWorkspaceInfo = null
} = {}) {
  const toolSettings = settings.tools ?? {};
  const workspaceSettings = toolSettings.workspace ?? {};

  const enabledCatalog = resolveEnabledToolCatalog(toolSettings);
  const workspaceSummary = getWorkspacePolicySummary(
    workspaceSettings,
    {
      writeEnabled: enabledCatalog.some(
        (item) => item.toolset === "workspace.write"
      ),
      processEnabled: enabledCatalog.some(
        (item) => item.name === "run_workspace_command"
      )
    }
  );

  const definitions = [
    {
      name: "get_runtime_info",
      title: "Get runtime info",
      description:
        "Get bounded, sanitized information about the application, operating system, locale, runtime, selected model, and safe tool profile. It never returns environment variables, credentials, prompts, or raw agent history.",
      inputSchema: z.object({}),
      outputSchema: z.object({}).passthrough(),
      async execute() {
        return createRuntimeSnapshot({
          activeModel,
          toolSettings,
          workspaceSettings
        });
      }
    },
    {
      name: "get_agent_status",
      title: "Get agent status",
      description:
        "Get a compact public summary of the current agent run, selected model, and stop state. Raw activity events, tool inputs and outputs, prompts, checkpoints, and runtime diagnostics are intentionally omitted.",
      inputSchema: z.object({}),
      outputSchema: agentStatusOutputSchema,
      async execute() {
        const status = typeof getAgentStatus === "function"
          ? getAgentStatus()
          : { state: "unknown" };
        return compactAgentStatus(status, {
          activeModel,
          toolProfile: resolveToolProfileId(toolSettings)
        });
      }
    }
  ];

  const shouldIncludeWorkspaceInfo =
    includeWorkspaceInfo === null
      ? Boolean(workspaceSummary)
      : includeWorkspaceInfo === true;

  if (shouldIncludeWorkspaceInfo) {
    definitions.push({
      name: "get_workspace_info",
      title: "Get workspace info",
      description:
        "Get the authorized workspace roots and enforced path, size, exclusion, read, write, and process restrictions without enumerating files or reading their contents.",
      inputSchema: z.object({}),
      outputSchema: z.object({}).passthrough(),
      toolsets: ["workspace.read"],
      sideEffect: "read",
      riskLevel: "low",
      runtimeContract: {
        effect: "read",
        retryMode: "safe",
        supportsAbort: false,
        supportsResume: true
      },
      async execute() {
        return workspaceSummary ?? {
          enabled: false,
          roots: [],
          mode: "unbound",
          excludes: [],
          sensitiveFilesBlocked: true,
          symlinkEscapeBlocked: true
        };
      }
    });
  }

  return definitions;
}
