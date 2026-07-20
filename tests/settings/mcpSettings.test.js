import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  sanitizeSettings
} from "../../electron/settings/validateSettings.js";

describe("MCP settings validation", () => {
  it("sanitizes stdio server configuration and keeps secrets out of settings", () => {
    const settings = sanitizeSettings({
      mcp: {
        enabled: true,
        autoConnect: false,
        connectTimeoutMs: 1,
        callTimeoutMs: 99999999,
        maxToolsPerServer: 9999,
        servers: [{
          id: " GitHub Main ",
          name: " GitHub ",
          enabled: true,
          transport: "unknown",
          command: "docker",
          args: ["run", "\u0000bad", "--rm"],
          cwd: "relative/path",
          env: {
            github_read_only: "1",
            BAD_NAME: "x".repeat(5000)
          },
          secretEnvKeys: [
            "github_personal_access_token",
            "github_personal_access_token",
            "bad-name"
          ],
          token: "must-not-survive",
          readOnly: true
        }]
      }
    });

    assert.equal(settings.mcp.connectTimeoutMs, 2000);
    assert.equal(settings.mcp.callTimeoutMs, 600000);
    assert.equal(settings.mcp.maxToolsPerServer, 512);
    assert.equal(settings.mcp.servers.length, 1);

    const server = settings.mcp.servers[0];
    assert.equal(server.id, "github-main");
    assert.equal(server.transport, "stdio");
    assert.deepEqual(server.args, ["run", "--rm"]);
    assert.equal(server.cwd, "");
    assert.deepEqual(server.env, { GITHUB_READ_ONLY: "1" });
    assert.deepEqual(server.secretEnvKeys, ["GITHUB_PERSONAL_ACCESS_TOKEN"]);
    assert.equal("token" in server, false);
  });

  it("deduplicates server ids and preserves external Tool overrides", () => {
    const settings = sanitizeSettings({
      mcp: {
        servers: [
          { id: "github", command: "node" },
          { id: "github", command: "node" }
        ]
      },
      tools: {
        developer: {
          toolsetOverrides: {
            "mcp.github": "disabled"
          },
          toolOverrides: {
            "mcp_github_get_issue_1234567": "enabled",
            [`mcp_${"x".repeat(52)}_1234567`]: "disabled"
          }
        }
      }
    });

    assert.deepEqual(
      settings.mcp.servers.map((server) => server.id),
      ["github", "github-2"]
    );
    assert.equal(
      settings.tools.developer.toolsetOverrides["mcp.github"],
      "disabled"
    );
    assert.equal(
      settings.tools.developer.toolOverrides.mcp_github_get_issue_1234567,
      "enabled"
    );
    assert.equal(
      settings.tools.developer.toolOverrides[`mcp_${"x".repeat(52)}_1234567`],
      "disabled"
    );
  });
});

it("moves secret-looking stdio environment names out of plain settings", () => {
  const settings = sanitizeSettings({
    mcp: {
      servers: [{
        id: "secret-env",
        transport: "stdio",
        command: "node",
        env: {
          MODE: "safe",
          API_TOKEN: "must-not-survive"
        }
      }]
    }
  });

  const server = settings.mcp.servers[0];
  assert.deepEqual(server.env, { MODE: "safe" });
  assert.deepEqual(server.secretEnvKeys, ["API_TOKEN"]);
});

it("sanitizes Streamable HTTP connections and remote authentication", () => {
  const settings = sanitizeSettings({
    mcp: {
      servers: [{
        id: "remote-main",
        name: "Remote",
        enabled: true,
        transport: "streamable-http",
        url: "https://mcp.example.com/mcp",
        authMode: "api-key",
        apiKeyHeader: "X-Service-Key",
        oauthScopes: ["repo:read", "repo:read", "bad scope"],
        headers: {
          "X-Client": "my-ai-ui",
          Authorization: "must-not-survive",
          "Bad Header": "x"
        },
        command: "must-not-survive",
        args: ["must-not-survive"],
        env: { SHOULD_NOT: "survive" },
        secretEnvKeys: []
      }]
    }
  });

  const server = settings.mcp.servers[0];
  assert.equal(server.transport, "streamable-http");
  assert.equal(server.url, "https://mcp.example.com/mcp");
  assert.equal(server.authMode, "api-key");
  assert.equal(server.apiKeyHeader, "X-Service-Key");
  assert.deepEqual(server.oauthScopes, ["repo:read"]);
  assert.deepEqual(server.headers, { "X-Client": "my-ai-ui" });
  assert.deepEqual(server.secretEnvKeys, ["MCP_REMOTE_TOKEN"]);
  assert.equal(server.command, "");
  assert.deepEqual(server.args, []);
  assert.deepEqual(server.env, {});
});

it("preserves an unfinished remote URL while editing", () => {
  const settings = sanitizeSettings({
    mcp: {
      servers: [{
        id: "draft",
        transport: "streamable-http",
        url: "https://mcp.examp"
      }]
    }
  });

  assert.equal(settings.mcp.servers[0].url, "https://mcp.examp/");
});
