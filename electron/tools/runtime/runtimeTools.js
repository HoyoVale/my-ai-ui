import {
  z
} from "zod";

import {
  createRuntimeSnapshot
} from "../../runtime/runtimeContextProvider.js";

import {
  getWorkspacePolicySummary
} from "../workspace/workspacePolicy.js";

import {
  resolveToolProfileId
} from "../toolCatalog.js";

export function createRuntimeToolDefinitions({
  activeModel = null,
  getAgentStatus = () => ({
    state: "unknown"
  }),
  settings = {}
} = {}) {
  const toolSettings =
    settings.tools ?? {};
  const workspaceSettings =
    toolSettings.workspace ?? {};

  return [
    {
      name: "get_runtime_info",
      title: "Get runtime info",
      description:
        "Get sanitized information about the current application, operating system, locale, runtime, model, and safe tool profile. It never returns environment variables or credentials.",
      inputSchema: z.object({}),
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
        "Get the current agent run state, selected model, context limit, enabled safe tool profile, and current plan without exposing prompts or credentials.",
      inputSchema: z.object({}),
      async execute(
        _input,
        context
      ) {
        const status =
          getAgentStatus();

        return {
          ...status,
          activeModel:
            activeModel
              ? {
                  providerId:
                    activeModel.providerId,
                  providerName:
                    activeModel.providerName,
                  modelName:
                    activeModel.modelName,
                  modelId:
                    activeModel.model,
                  contextTokenBudget:
                    activeModel
                      .contextTokenBudget,
                  maxOutputTokens:
                    activeModel
                      .maxOutputTokens
                }
              : null,
          plan:
            context.planStore
              ?.get() ?? [],
          toolProfile:
            resolveToolProfileId(
              toolSettings
            )
        };
      }
    },
    {
      name: "get_workspace_info",
      title: "Get workspace info",
      description:
        "Get the authorized read-only workspace roots and security restrictions. Does not enumerate files.",
      inputSchema: z.object({}),
      async execute() {
        return getWorkspacePolicySummary(
          workspaceSettings
        );
      }
    }
  ];
}
