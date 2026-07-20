import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  McpPermissionPolicy
} from "../../electron/mcp/McpPermissionPolicy.js";

describe("MCP permission policy", () => {
  const policy = new McpPermissionPolicy();

  it("blocks disabled connection capabilities", () => {
    assert.equal(policy.connectionDecision({
      transport: "stdio",
      permissions: { localProcess: false }
    }).allowed, false);

    assert.equal(policy.connectionDecision({
      transport: "streamable-http",
      authMode: "none",
      permissions: { network: false }
    }).allowed, false);
  });

  it("intersects per-tool rules with the server capability matrix", () => {
    const readTool = {
      name: "read_issue",
      annotations: { readOnlyHint: true }
    };
    const writeTool = {
      name: "create_issue",
      annotations: { readOnlyHint: false }
    };

    assert.equal(policy.toolDecision({
      readOnly: true,
      permissions: { tools: { read_issue: "allow" } }
    }, readTool).allowed, true);

    const denied = policy.toolDecision({
      readOnly: true,
      permissions: { tools: { create_issue: "allow" } }
    }, writeTool);
    assert.equal(denied.allowed, false);
    assert.equal(denied.code, "MCP_READ_ONLY_DENIED");
    assert.equal(denied.rule, "allow");
  });

  it("keeps legacy unannotated read-style tools compatible", () => {
    const decision = policy.toolDecision({
      readOnly: true
    }, {
      name: "search_remote",
      inputSchema: { type: "object" }
    });

    assert.equal(decision.allowed, true);
    assert.equal(decision.capabilities.readOnly, true);
    assert.equal(decision.capabilities.readOnlySource, "name");
  });

  it("always honors explicit per-tool deny", () => {
    const decision = policy.toolDecision({
      readOnly: false,
      permissions: {
        externalWrite: true,
        tools: { create_issue: "deny" }
      }
    }, {
      name: "create_issue",
      annotations: { readOnlyHint: false }
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.code, "MCP_TOOL_PERMISSION_DENIED");
    assert.equal(decision.rule, "deny");
  });
});
