import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  McpClientManager
} from "../../electron/mcp/McpClientManager.js";

const fixture = fileURLToPath(
  new URL("../fixtures/mcp-test-server.mjs", import.meta.url)
);

const managers = new Set();

afterEach(async () => {
  await Promise.allSettled([...managers].map((manager) => manager.closeAll()));
  managers.clear();
});

function createManager() {
  const manager = new McpClientManager({
    credentialProvider: async () => ({
      MCP_TEST_SECRET: "fixture-secret"
    })
  });
  managers.add(manager);
  manager.syncSettings({
    enabled: true,
    autoConnect: false,
    connectTimeoutMs: 10000,
    callTimeoutMs: 10000,
    maxToolsPerServer: 16,
    servers: [{
      id: "fixture",
      name: "Fixture MCP",
      enabled: true,
      autoConnect: false,
      transport: "stdio",
      command: process.execPath,
      args: [fixture],
      cwd: path.dirname(fixture),
      env: {},
      secretEnvKeys: ["MCP_TEST_SECRET"],
      readOnly: true,
      preset: "custom",
      connectTimeoutMs: 10000,
      callTimeoutMs: 10000
    }]
  });
  return manager;
}

describe("MCP stdio Client Manager", () => {
  it("connects, discovers, pings and invokes a local stdio server", async () => {
    const manager = createManager();
    const connected = await manager.connectServer("fixture");

    assert.equal(connected.state, "connected");
    assert.equal(connected.serverInfo.name, "my-ai-ui-mcp-fixture");
    assert.equal(connected.toolCount, 2);
    assert.equal(
      connected.logs.some((item) => item.text.includes("fixture-secret")),
      false
    );
    assert.equal(
      connected.logs.some((item) => item.text.includes("[REDACTED]")),
      true
    );
    assert.deepEqual(
      connected.tools.map((tool) => tool.name).sort(),
      ["echo", "read_marker"]
    );

    const ping = await manager.pingServer("fixture");
    assert.equal(ping.ok, true);
    assert.equal(Number.isFinite(ping.latencyMs), true);

    const echo = await manager.callTool("fixture", "echo", { text: "hello" });
    assert.equal(echo.ok, true);
    assert.equal(echo.content[0].text, "hello");
    assert.deepEqual(echo.structuredContent, { text: "hello" });

    const marker = await manager.callTool("fixture", "read_marker", {});
    assert.deepEqual(marker.structuredContent, { configured: true });
  });

  it("publishes discovered tools as Runtime definitions and disconnects cleanly", async () => {
    const manager = createManager();
    await manager.connectServer("fixture");

    const definitions = manager.getToolDefinitions();
    assert.equal(definitions.length, 2);
    assert.equal(definitions.every((tool) => tool.source === "mcp.fixture"), true);
    assert.equal(definitions.every((tool) => tool.runtimeContract.effect === "read"), true);

    const disconnected = await manager.disconnectServer("fixture");
    assert.equal(disconnected.state, "disconnected");
    assert.equal(manager.snapshot().connectedCount, 0);
  });

  it("does not emit a settings change for an identical configuration", () => {
    const manager = createManager();
    let changes = 0;
    manager.on("changed", () => {
      changes += 1;
    });
    const current = structuredClone(manager.settings);

    manager.syncSettings(current);
    manager.syncSettings(current);

    assert.equal(changes, 0);
  });
});
