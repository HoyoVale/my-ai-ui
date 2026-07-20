import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createMcpInputSchema,
  createMcpLocalToolName,
  createMcpToolDefinition,
  normalizeMcpToolResult
} from "../../electron/mcp/mcpToolAdapter.js";

describe("MCP Tool adapter", () => {
  it("creates stable provider-safe local names", () => {
    const first = createMcpLocalToolName(
      "github-primary",
      "a very long remote tool name with spaces and punctuation/".repeat(3)
    );
    const second = createMcpLocalToolName(
      "github-primary",
      "a very long remote tool name with spaces and punctuation/".repeat(3)
    );

    assert.equal(first, second);
    assert.match(first, /^[a-zA-Z0-9_-]{1,64}$/u);
    assert.equal(first.length <= 64, true);
  });

  it("validates MCP JSON Schema through the Runtime schema contract", () => {
    const schema = createMcpInputSchema({
      type: "object",
      required: ["owner"],
      additionalProperties: false,
      properties: {
        owner: { type: "string", minLength: 1 }
      }
    });

    assert.equal(schema.safeParse({ owner: "openai" }).success, true);
    assert.equal(schema.safeParse({}).success, false);
    assert.equal(schema.safeParse({ owner: "openai", extra: true }).success, false);
  });

  it("maps read-only MCP tools to safe Runtime contracts", async () => {
    const calls = [];
    const definition = createMcpToolDefinition({
      manager: {
        async callTool(serverId, toolName, input) {
          calls.push({ serverId, toolName, input });
          return { ok: true, content: [{ type: "text", text: "ok" }] };
        }
      },
      server: {
        id: "github",
        name: "GitHub",
        readOnly: true,
        callTimeoutMs: 30000
      },
      tool: {
        name: "get_issue",
        title: "Get issue",
        description: "Reads one issue.",
        inputSchema: { type: "object" },
        annotations: { readOnlyHint: true }
      }
    });

    assert.equal(definition.source, "mcp.github");
    assert.deepEqual(definition.toolsets, ["mcp.github"]);
    assert.equal(definition.sideEffect, "read");
    assert.equal(definition.runtimeContract.effect, "read");
    assert.equal(definition.runtimeContract.retryMode, "safe");

    await definition.execute({ number: 1 }, {});
    assert.deepEqual(calls, [{
      serverId: "github",
      toolName: "get_issue",
      input: { number: 1 }
    }]);
  });

  it("bounds and normalizes remote MCP results", () => {
    const result = normalizeMcpToolResult({
      content: [
        { type: "text", text: "done" },
        { type: "image", mimeType: "image/png", data: "ignored" }
      ],
      structuredContent: { ok: true }
    }, {
      serverId: "fixture",
      toolName: "echo"
    });

    assert.equal(result.ok, true);
    assert.equal(result.content[0].text, "done");
    assert.equal(result.content[1].omitted, true);
    assert.deepEqual(result.structuredContent, { ok: true });
  });
});
