import crypto from "node:crypto";
import { EventEmitter } from "node:events";

export function mcpServerConfigHash(config = {}) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      transport: config.transport,
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      env: config.env,
      url: config.url,
      authMode: config.authMode,
      apiKeyHeader: config.apiKeyHeader,
      oauthScopes: config.oauthScopes,
      headers: config.headers,
      secretEnvKeys: config.secretEnvKeys,
      readOnly: config.readOnly,
      permissions: config.permissions,
      recovery: config.recovery,
      connectTimeoutMs: config.connectTimeoutMs,
      callTimeoutMs: config.callTimeoutMs
    }))
    .digest("hex");
}

export function mcpSettingsConfigHash(settings = {}) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      enabled: settings.enabled,
      autoConnect: settings.autoConnect,
      connectTimeoutMs: settings.connectTimeoutMs,
      callTimeoutMs: settings.callTimeoutMs,
      maxToolsPerServer: settings.maxToolsPerServer,
      health: settings.health,
      recovery: settings.recovery,
      resultLimits: settings.resultLimits,
      logLevel: settings.logLevel,
      servers: (settings.servers ?? []).map((server) => ({
        id: server.id,
        name: server.name,
        enabled: server.enabled,
        autoConnect: server.autoConnect,
        hash: mcpServerConfigHash(server)
      }))
    }))
    .digest("hex");
}

export function normalizeMcpSettings(settings = {}) {
  return settings.mcp && typeof settings.mcp === "object"
    ? settings.mcp
    : settings;
}

export class McpRegistry extends EventEmitter {
  constructor(initialSettings = {}) {
    super();
    this.settings = {
      enabled: true,
      autoConnect: true,
      connectTimeoutMs: 15000,
      callTimeoutMs: 60000,
      maxToolsPerServer: 128,
      health: {
        enabled: true,
        intervalMs: 30000,
        timeoutMs: 8000,
        unhealthyThreshold: 2
      },
      recovery: {
        enabled: true,
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 15000
      },
      resultLimits: {
        maxTextBytes: 51200,
        maxStructuredBytes: 1048576,
        maxJsonFields: 10000,
        maxContentBlocks: 128,
        stripHtml: true
      },
      logLevel: "developer",
      servers: [],
      ...normalizeMcpSettings(initialSettings)
    };
    this.hash = mcpSettingsConfigHash(this.settings);
  }

  sync(settings = {}) {
    const source = normalizeMcpSettings(settings);
    const next = {
      ...this.settings,
      ...source,
      health: {
        ...this.settings.health,
        ...(source.health ?? {})
      },
      recovery: {
        ...this.settings.recovery,
        ...(source.recovery ?? {})
      },
      resultLimits: {
        ...this.settings.resultLimits,
        ...(source.resultLimits ?? {})
      },
      servers: Array.isArray(source.servers) ? source.servers : []
    };
    const nextHash = mcpSettingsConfigHash(next);
    if (nextHash === this.hash) {
      return {
        changed: false,
        settings: this.settings,
        removedIds: [],
        changedIds: []
      };
    }

    const previousById = new Map(
      (this.settings.servers ?? []).map((server) => [server.id, server])
    );
    const nextById = new Map((next.servers ?? []).map((server) => [server.id, server]));
    const removedIds = [...previousById.keys()].filter((id) => !nextById.has(id));
    const changedIds = [...nextById.entries()]
      .filter(([id, server]) => {
        const previous = previousById.get(id);
        return !previous || mcpServerConfigHash(previous) !== mcpServerConfigHash(server);
      })
      .map(([id]) => id);

    this.settings = next;
    this.hash = nextHash;
    const change = {
      changed: true,
      settings: this.settings,
      removedIds,
      changedIds
    };
    this.emit("changed", change);
    return change;
  }

  getServer(serverId) {
    return (this.settings.servers ?? []).find(
      (server) => server.id === String(serverId ?? "")
    ) ?? null;
  }

  listServers() {
    return [...(this.settings.servers ?? [])];
  }
}
