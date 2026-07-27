import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ToolRegistry } from "../../electron/tools/core/ToolRegistry.js";
import { createRuntimeToolDefinitions } from "../../electron/tools/runtime/runtimeTools.js";

describe("runtime tool hardening", () => {
  it("returns a compact agent status without raw activity or diagnostics", async () => {
    const tool = createRuntimeToolDefinitions({
      activeModel: {
        providerId: "ollama",
        providerName: "Ollama",
        modelName: "demo",
        model: "demo:latest",
        contextTokenBudget: 4096,
        maxOutputTokens: 1024
      },
      getAgentStatus: () => ({
        state: "running",
        phase: "executing",
        outcome: "running",
        taskId: "task-1",
        runId: "run-1",
        activity: { events: Array.from({ length: 100 }, () => ({ type: "tool" })) },
        activeToolCalls: [{ input: { secret: "value" } }],
        toolRuntimeDiagnostics: { leaseOwner: "secret-owner" },
        checkpoint: { raw: true }
      }),
      settings: { tools: { mode: "chat" } }
    }).find((definition) => definition.name === "get_agent_status");

    const result = await tool.execute({});
    assert.equal(result.state, "running");
    assert.equal("plan" in result, false);
    assert.equal("planTruncated" in result, false);
    assert.equal("activity" in result, false);
    assert.equal("activeToolCalls" in result, false);
    assert.equal("toolRuntimeDiagnostics" in result, false);
    assert.equal("checkpoint" in result, false);
  });

  it("classifies workspace metadata as a workspace read tool", () => {
    const definitions = createRuntimeToolDefinitions({
      settings: {
        tools: {
          workspace: { roots: [process.cwd()] }
        }
      }
    });
    const registry = new ToolRegistry();
    registry.registerMany(definitions, {
      source: "builtin.runtime",
      toolset: "core.runtime",
      sideEffect: "none",
      riskLevel: "none"
    });

    const workspace = registry.manifest().find(
      (definition) => definition.name === "get_workspace_info"
    );
    assert.deepEqual(workspace.toolsets, ["workspace.read"]);
    assert.equal(workspace.sideEffect, "read");
    assert.equal(workspace.runtimeContract.effect, "read");
  });
});
