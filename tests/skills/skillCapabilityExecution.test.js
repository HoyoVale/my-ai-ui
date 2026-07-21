import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SETTINGS } from "../../electron/settings/defaultSettings.js";
import { createAgentToolSession } from "../../electron/tools/createAgentToolSession.js";

test("Skill capability requests restrict the Tool set and propagate ask decisions", async () => {
  const approvals = [];
  const session = createAgentToolSession({
    settings: structuredClone(DEFAULT_SETTINGS),
    mode: "chat",
    taskId: "skill-capability",
    runId: "run",
    capabilityRequest: {
      requiredCapabilities: ["runtime.info"],
      optionalCapabilities: [],
      permissions: {
        runtime: "ask",
        workspaceRead: "deny",
        workspaceWrite: "deny",
        process: "deny",
        network: "deny",
        externalRead: "deny",
        externalWrite: "deny",
        destructive: "deny",
        credential: "deny",
        account: "deny",
        agentInternal: "deny"
      }
    },
    authorizeTool: async (request) => {
      approvals.push(request.capabilityDecision);
      return { decision: "allow" };
    }
  });

  try {
    assert.equal(session.capabilityResolution.satisfied, true);
    assert.ok(session.definitions.length > 0);
    assert.ok(session.definitions.every((tool) => tool.capabilities.includes("runtime.info")));
    const timeTool = session.definitions.find((tool) => tool.name === "get_current_time");
    assert.ok(timeTool);
    const result = await session.tools.get_current_time.execute({}, { toolCallId: "time" });
    assert.equal(result.ok, true);
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0].requiresApproval, true);
    assert.deepEqual(approvals[0].approvalPermissions, ["runtime"]);
  } finally {
    await session.closePersistence();
  }
});

test("Skill capability requests retain bounded Agent support tools", async () => {
  const session = createAgentToolSession({
    settings: structuredClone(DEFAULT_SETTINGS),
    mode: "chat",
    taskId: "skill-support-tools",
    runId: "run",
    capabilityRequest: {
      requiredCapabilities: ["runtime.info"],
      optionalCapabilities: [],
      permissions: {
        runtime: "allow",
        workspaceRead: "deny",
        workspaceWrite: "deny",
        process: "deny",
        network: "deny",
        externalRead: "deny",
        externalWrite: "deny",
        destructive: "deny",
        credential: "deny",
        account: "deny",
        agentInternal: "allow"
      }
    }
  });

  try {
    assert.equal(session.capabilityResolution.satisfied, true);
    assert.ok(session.capabilityResolution.supportingCapabilities.includes("agent.plan"));
    assert.ok(session.capabilityResolution.supportingCapabilities.includes("agent.result.page"));
    assert.ok(session.capabilityResolution.supportToolNames.includes("update_plan"));
    assert.ok(session.capabilityResolution.supportToolNames.includes("read_tool_result"));
    assert.ok(session.definitions.some((tool) => tool.name === "update_plan"));
    assert.ok(session.definitions.some((tool) => tool.name === "read_tool_result"));
  } finally {
    await session.closePersistence();
  }
});
