import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  McpClientManager
} from "../../electron/mcp/McpClientManager.js";
import {
  createAgentToolSession
} from "../../electron/tools/createAgentToolSession.js";
import {
  FALLBACK_SETTINGS
} from "../../src/shared/defaultSettings.js";

const fixture = fileURLToPath(
  new URL("../fixtures/mcp-test-server.mjs", import.meta.url)
);
const manager = new McpClientManager();

after(async () => {
  await manager.closeAll();
});

function configuredSettings() {
  const settings = structuredClone(FALLBACK_SETTINGS);
  settings.mcp = {
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
      secretEnvKeys: [],
      readOnly: true,
      preset: "custom",
      connectTimeoutMs: 10000,
      callTimeoutMs: 10000
    }]
  };
  settings.tools.mode = "chat";
  return settings;
}

describe("MCP Tool Runtime integration", () => {
  it("registers discovered external definitions in an ordinary agent Tool Session", async () => {
    const settings = configuredSettings();
    manager.syncSettings(settings);
    await manager.connectServer("fixture");
    const externalDefinitions = manager.getToolDefinitions();

    const session = createAgentToolSession({
      settings,
      externalDefinitions,
      getAgentStatus: () => ({ state: "running" })
    });
    const echoName = externalDefinitions.find(
      (definition) => definition.mcp.remoteName === "echo"
    ).name;

    assert.equal(echoName in session.tools, true);
    const result = await session.tools[echoName].execute(
      { text: "runtime" },
      { toolCallId: "mcp-runtime-call-1" }
    );
    assert.equal(result.ok, true);
    assert.equal(result.content[0].text, "runtime");

    await session.closePersistence();
  });
});
