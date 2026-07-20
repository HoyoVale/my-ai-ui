import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  exportMcpConfiguration,
  importMcpConfiguration
} from "../../electron/mcp/McpConfigPortability.js";

describe("MCP config portability", () => {
  it("imports a common mcpServers stdio config without retaining secret values", () => {
    const imported = importMcpConfiguration({
      mcpServers: {
        example: {
          command: "node",
          args: ["server.mjs"],
          env: {
            MODE: "readonly",
            API_TOKEN: "must-not-be-imported"
          }
        }
      }
    });

    assert.equal(imported.servers.length, 1);
    assert.equal(imported.servers[0].transport, "stdio");
    assert.deepEqual(imported.servers[0].env, { MODE: "readonly" });
    assert.deepEqual(imported.servers[0].secretEnvKeys, ["API_TOKEN"]);
    assert.equal(imported.servers[0].enabled, false);
    assert.equal(imported.warnings.length, 1);
  });

  it("exports the native backup without credential values", () => {
    const settings = {
      mcp: {
        enabled: true,
        servers: [{
          id: "example",
          name: "Example",
          transport: "stdio",
          command: "node",
          args: ["server.mjs"],
          env: { MODE: "readonly", API_TOKEN: "must-not-be-exported" },
          secretEnvKeys: ["API_TOKEN"],
          enabled: true,
          autoConnect: true,
          readOnly: true
        }]
      }
    };

    const native = exportMcpConfiguration(settings);
    const serialized = JSON.stringify(native);

    assert.equal(serialized.includes("API_TOKEN"), true);
    assert.equal(serialized.includes("must-not-be-exported"), false);
    assert.equal(native.mcp.servers[0].command, "node");
    assert.equal("mcpServers" in native, false);
  });
});
