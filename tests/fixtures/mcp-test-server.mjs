#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "my-ai-ui-mcp-fixture",
  version: "1.0.0"
});

server.registerTool(
  "echo",
  {
    title: "Echo",
    description: "Echoes a bounded text value.",
    inputSchema: {
      text: z.string().max(2000)
    },
    outputSchema: {
      text: z.string()
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true
    }
  },
  async ({ text }) => ({
    content: [{ type: "text", text }],
    structuredContent: { text }
  })
);

server.registerTool(
  "read_marker",
  {
    title: "Read marker",
    description: "Reads the test-only inherited secret marker.",
    inputSchema: {},
    outputSchema: {
      configured: z.boolean()
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true
    }
  },
  async () => ({
    content: [{
      type: "text",
      text: process.env.MCP_TEST_SECRET === "fixture-secret"
        ? "configured"
        : "missing"
    }],
    structuredContent: {
      configured: process.env.MCP_TEST_SECRET === "fixture-secret"
    }
  })
);

console.error(`fixture-token=${process.env.MCP_TEST_SECRET ?? "missing"}`);

const transport = new StdioServerTransport();
await server.connect(transport);
