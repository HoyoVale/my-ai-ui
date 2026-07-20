import crypto from "node:crypto";
import { EventEmitter } from "node:events";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import {
  createMcpToolDefinition,
  normalizeMcpToolResult
} from "./mcpToolAdapter.js";

const MAX_LOG_LINES = 120;
const MAX_LOG_LINE_LENGTH = 2000;
const MAX_TOOL_DESCRIPTION_LENGTH = 4000;
const MAX_TOOL_SCHEMA_BYTES = 512_000;
const MAX_SERVER_INSTRUCTIONS_LENGTH = 8000;

function configHash(config) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      transport: config.transport,
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      env: config.env,
      secretEnvKeys: config.secretEnvKeys,
      readOnly: config.readOnly,
      connectTimeoutMs: config.connectTimeoutMs,
      callTimeoutMs: config.callTimeoutMs
    }))
    .digest("hex");
}

function settingsConfigHash(settings) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      enabled: settings.enabled,
      autoConnect: settings.autoConnect,
      connectTimeoutMs: settings.connectTimeoutMs,
      callTimeoutMs: settings.callTimeoutMs,
      maxToolsPerServer: settings.maxToolsPerServer,
      servers: (settings.servers ?? []).map((server) => ({
        id: server.id,
        name: server.name,
        preset: server.preset,
        enabled: server.enabled,
        autoConnect: server.autoConnect,
        hash: configHash(server)
      }))
    }))
    .digest("hex");
}

function redactLogChunk(chunk, secretValues = []) {
  let text = String(chunk ?? "");
  for (const secret of secretValues) {
    if (secret.length >= 4) {
      text = text.split(secret).join("[REDACTED]");
    }
  }
  return text
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/giu, "$1[REDACTED]")
    .replace(/((?:token|api[_-]?key|secret|password)\s*[:=]\s*)[^\s]+/giu, "$1[REDACTED]");
}

function boundedJsonClone(value, maxBytes = MAX_TOOL_SCHEMA_BYTES) {
  if (value === undefined || value === null) {
    return null;
  }
  try {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
      return undefined;
    }
    return JSON.parse(serialized);
  } catch {
    return undefined;
  }
}

function normalizeDiscoveredTools(tools, maxTools) {
  return (tools ?? [])
    .slice(0, maxTools)
    .map(publicTool)
    .filter(Boolean);
}

function errorMessage(error) {
  return String(error?.message ?? error ?? "Unknown MCP error").slice(0, 2000);
}

function boundedLogLines(lines, chunk) {
  const text = String(chunk ?? "");
  for (const line of text.split(/\r?\n/u)) {
    const normalized = line.trim();
    if (!normalized) {
      continue;
    }
    lines.push({
      at: Date.now(),
      text: normalized.slice(0, MAX_LOG_LINE_LENGTH)
    });
  }
  if (lines.length > MAX_LOG_LINES) {
    lines.splice(0, lines.length - MAX_LOG_LINES);
  }
}

async function withTimeout(promise, timeoutMs, onTimeout) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          try {
            onTimeout?.();
          } catch {
            // Best-effort cleanup only.
          }
          const error = new Error(`MCP connection timed out after ${timeoutMs}ms.`);
          error.code = "MCP_CONNECT_TIMEOUT";
          reject(error);
        }, timeoutMs);
        timer.unref?.();
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function normalizeMcpSettings(settings = {}) {
  return settings.mcp && typeof settings.mcp === "object"
    ? settings.mcp
    : settings;
}

function publicTool(tool) {
  const name = String(tool?.name ?? "").trim().slice(0, 256);
  const inputSchema = boundedJsonClone(tool?.inputSchema ?? { type: "object" });
  if (!name || inputSchema === undefined) {
    return null;
  }
  return {
    name,
    title: String(tool?.title ?? name).slice(0, 200),
    description: String(tool?.description ?? "").slice(0, MAX_TOOL_DESCRIPTION_LENGTH),
    inputSchema,
    outputSchema: boundedJsonClone(tool?.outputSchema),
    annotations: boundedJsonClone(tool?.annotations ?? {}, 64_000) ?? {}
  };
}

export class McpClientManager extends EventEmitter {
  constructor({
    credentialProvider = async () => ({}),
    clientFactory = (info, options) => new Client(info, options),
    transportFactory = (params) => new StdioClientTransport(params)
  } = {}) {
    super();
    this.credentialProvider = credentialProvider;
    this.clientFactory = clientFactory;
    this.transportFactory = transportFactory;
    this.settings = {
      enabled: true,
      autoConnect: true,
      connectTimeoutMs: 15000,
      callTimeoutMs: 60000,
      maxToolsPerServer: 128,
      servers: []
    };
    this.entries = new Map();
    this.settingsHash = settingsConfigHash(this.settings);
  }

  setCredentialProvider(provider) {
    if (typeof provider === "function") {
      this.credentialProvider = provider;
    }
  }

  getServerConfig(serverId) {
    return (this.settings.servers ?? []).find(
      (server) => server.id === String(serverId ?? "")
    ) ?? null;
  }

  syncSettings(settings = {}) {
    const next = normalizeMcpSettings(settings);
    const nextSettings = {
      ...this.settings,
      ...next,
      servers: Array.isArray(next.servers) ? next.servers : []
    };
    const nextSettingsHash = settingsConfigHash(nextSettings);
    if (nextSettingsHash === this.settingsHash) {
      return this.snapshot();
    }

    this.settings = nextSettings;
    this.settingsHash = nextSettingsHash;

    const configuredIds = new Set(this.settings.servers.map((server) => server.id));
    for (const [serverId, entry] of this.entries) {
      if (!configuredIds.has(serverId)) {
        void this.disconnectServer(serverId, { forgetTools: true });
        this.entries.delete(serverId);
        continue;
      }
      const config = this.getServerConfig(serverId);
      const nextHash = configHash(config);
      if (entry.configHash && entry.configHash !== nextHash) {
        void this.disconnectServer(serverId, { forgetTools: false });
      }
      entry.config = config;
      entry.configHash = nextHash;
    }

    this.emitChanged();
    return this.snapshot();
  }

  async applySettings(settings = {}, { connect = false } = {}) {
    this.syncSettings(settings);
    const tasks = [];

    for (const server of this.settings.servers) {
      if (!this.settings.enabled || !server.enabled) {
        tasks.push(this.disconnectServer(server.id, { forgetTools: false }));
        continue;
      }
      if (connect || (this.settings.autoConnect && server.autoConnect)) {
        tasks.push(this.connectServer(server.id).catch(() => null));
      }
    }

    await Promise.allSettled(tasks);
    return this.snapshot();
  }

  ensureEntry(server) {
    let entry = this.entries.get(server.id);
    if (!entry) {
      entry = {
        serverId: server.id,
        config: server,
        configHash: configHash(server),
        state: "disconnected",
        client: null,
        transport: null,
        connectingPromise: null,
        tools: [],
        serverInfo: null,
        capabilities: null,
        instructions: "",
        error: "",
        logs: [],
        connectedAt: null,
        lastDiscoveryAt: null,
        pid: null
      };
      this.entries.set(server.id, entry);
    }
    return entry;
  }

  async connectServer(serverId, { force = false } = {}) {
    const server = this.getServerConfig(serverId);
    if (!server) {
      throw new Error("MCP Server 不存在。");
    }
    if (!this.settings.enabled || !server.enabled) {
      throw new Error("MCP Server 当前未启用。");
    }
    if (server.transport !== "stdio") {
      throw new Error("当前版本仅支持 MCP stdio Transport。");
    }
    if (!server.command) {
      throw new Error("MCP Server 尚未配置启动命令。");
    }

    const entry = this.ensureEntry(server);
    const nextHash = configHash(server);
    if (!force && entry.state === "connected" && entry.configHash === nextHash) {
      return this.publicEntry(entry);
    }
    if (entry.connectingPromise) {
      return entry.connectingPromise;
    }

    entry.connectingPromise = this.doConnect(entry, server, nextHash)
      .finally(() => {
        entry.connectingPromise = null;
      });
    return entry.connectingPromise;
  }

  async doConnect(entry, server, nextHash) {
    await this.disconnectEntry(entry, { forgetTools: false });
    entry.config = server;
    entry.configHash = nextHash;
    entry.state = "connecting";
    entry.error = "";
    this.emitChanged();

    let transport = null;
    let client = null;
    try {
      const secretEnvironment = await this.credentialProvider(server);
      const env = {
        ...(server.env ?? {}),
        ...(secretEnvironment ?? {})
      };
      const secretValues = Object.values(secretEnvironment ?? {})
        .map((value) => String(value ?? ""))
        .filter(Boolean);
      client = this.clientFactory(
        {
          name: "xixi-desktop-mcp-client",
          version: "1.0.0"
        },
        {
          capabilities: {},
          listChanged: {
            tools: {
              onChanged: (error, tools) => {
                if (entry.client !== client) {
                  return;
                }
                if (error) {
                  entry.error = errorMessage(error);
                  boundedLogLines(entry.logs, `tool list refresh: ${entry.error}`);
                } else {
                  const maxTools = Math.max(
                    1,
                    this.settings.maxToolsPerServer ?? 128
                  );
                  entry.tools = normalizeDiscoveredTools(tools, maxTools);
                  entry.lastDiscoveryAt = Date.now();
                  entry.error = "";
                }
                this.emitChanged();
              }
            }
          }
        }
      );
      client.onclose = () => {
        if (entry.client !== client) {
          return;
        }
        entry.client = null;
        entry.transport = null;
        entry.pid = null;
        entry.state = "disconnected";
        if (!entry.error) {
          entry.error = "MCP Server 进程已退出。";
        }
        this.emitChanged();
      };
      client.onerror = (error) => {
        if (entry.client !== client) {
          return;
        }
        entry.error = errorMessage(error);
        boundedLogLines(entry.logs, `protocol: ${entry.error}`);
        this.emitChanged();
      };
      transport = this.transportFactory({
        command: server.command,
        args: server.args ?? [],
        cwd: server.cwd || undefined,
        env,
        stderr: "pipe"
      });

      transport.stderr?.on?.("data", (chunk) => {
        boundedLogLines(entry.logs, redactLogChunk(chunk, secretValues));
        this.emitChanged();
      });

      const timeoutMs = server.connectTimeoutMs ?? this.settings.connectTimeoutMs ?? 15000;
      await withTimeout(
        client.connect(transport),
        timeoutMs,
        () => {
          if (transport?.close) {
            void Promise.resolve(transport.close()).catch(() => {});
          }
        }
      );

      const currentConfig = this.getServerConfig(entry.serverId);
      if (
        !currentConfig ||
        currentConfig.enabled === false ||
        entry.configHash !== nextHash ||
        configHash(currentConfig) !== nextHash
      ) {
        const error = new Error(
          "MCP Server 配置在连接过程中发生变化，已放弃旧连接。"
        );
        error.code = "MCP_CONFIG_CHANGED";
        throw error;
      }

      entry.client = client;
      entry.transport = transport;
      entry.pid = transport.pid ?? null;
      entry.serverInfo = client.getServerVersion?.() ?? null;
      entry.capabilities = client.getServerCapabilities?.() ?? null;
      entry.instructions = String(client.getInstructions?.() ?? "")
        .slice(0, MAX_SERVER_INSTRUCTIONS_LENGTH);
      entry.state = "connected";
      entry.connectedAt = Date.now();
      entry.error = "";
      await this.discoverEntry(entry);
      this.emitChanged();
      return this.publicEntry(entry);
    } catch (error) {
      entry.error = errorMessage(error);
      entry.state = "error";
      entry.client = null;
      entry.transport = null;
      entry.pid = null;
      try {
        await client?.close?.();
      } catch {
        // Best effort; the transport is closed separately below.
      }
      try {
        await transport?.close?.();
      } catch {
        // Best effort.
      }
      this.emitChanged();
      throw error;
    }
  }

  async discoverEntry(entry) {
    if (!entry.client) {
      throw new Error("MCP Server 尚未连接。");
    }
    const result = await entry.client.listTools();
    const maxTools = Math.max(1, this.settings.maxToolsPerServer ?? 128);
    entry.tools = normalizeDiscoveredTools(result?.tools, maxTools);
    entry.lastDiscoveryAt = Date.now();
    return entry.tools;
  }

  async refreshServer(serverId) {
    const entry = this.entries.get(String(serverId ?? ""));
    if (!entry || entry.state !== "connected" || !entry.client) {
      await this.connectServer(serverId, { force: true });
    } else {
      await this.discoverEntry(entry);
      this.emitChanged();
    }
    return this.publicEntry(this.entries.get(String(serverId ?? "")));
  }

  async pingServer(serverId) {
    const entry = this.entries.get(String(serverId ?? ""));
    if (!entry || entry.state !== "connected" || !entry.client) {
      await this.connectServer(serverId);
    }
    const active = this.entries.get(String(serverId ?? ""));
    const startedAt = Date.now();
    await active.client.ping({
      timeout: Math.min(
        active.config?.callTimeoutMs ?? this.settings.callTimeoutMs ?? 60000,
        30000
      )
    });
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      server: this.publicEntry(active)
    };
  }

  async callTool(serverId, toolName, input, { signal, timeoutMs } = {}) {
    let entry = this.entries.get(String(serverId ?? ""));
    if (!entry || entry.state !== "connected" || !entry.client) {
      await this.connectServer(serverId);
      entry = this.entries.get(String(serverId ?? ""));
    }
    if (!entry?.client) {
      throw new Error("MCP Server 连接不可用。");
    }

    try {
      const result = await entry.client.callTool(
        {
          name: String(toolName ?? ""),
          arguments: input ?? {}
        },
        undefined,
        {
          signal,
          timeout: timeoutMs ?? entry.config?.callTimeoutMs ?? this.settings.callTimeoutMs ?? 60000,
          maxTotalTimeout: timeoutMs ?? entry.config?.callTimeoutMs ?? this.settings.callTimeoutMs ?? 60000
        }
      );
      entry.error = "";
      this.emitChanged();
      return normalizeMcpToolResult(result, {
        serverId: entry.serverId,
        toolName
      });
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      entry.error = errorMessage(error);
      boundedLogLines(entry.logs, `tool call: ${entry.error}`);
      this.emitChanged();
      throw error;
    }
  }

  getToolDefinitions(settings = null) {
    if (settings) {
      this.syncSettings(settings);
    }
    const definitions = [];
    if (!this.settings.enabled) {
      return definitions;
    }

    for (const server of this.settings.servers) {
      if (!server.enabled) {
        continue;
      }
      const entry = this.entries.get(server.id);
      for (const tool of entry?.tools ?? []) {
        definitions.push(createMcpToolDefinition({
          manager: this,
          server,
          tool
        }));
      }
    }
    return definitions;
  }

  async prepareForAgent(settings = this.settings) {
    this.syncSettings(settings);
    if (!this.settings.enabled) {
      return [];
    }
    const enabledServers = this.settings.servers.filter((server) => server.enabled);
    await Promise.allSettled(
      enabledServers.map((server) => this.connectServer(server.id))
    );
    return this.getToolDefinitions(this.settings);
  }

  async disconnectEntry(entry, { forgetTools = false, preserveState = false } = {}) {
    const client = entry.client;
    const transport = entry.transport;
    entry.client = null;
    entry.transport = null;
    entry.pid = null;

    try {
      await client?.close?.();
    } catch (error) {
      boundedLogLines(entry.logs, `client close: ${errorMessage(error)}`);
    }
    try {
      await transport?.close?.();
    } catch (error) {
      boundedLogLines(entry.logs, `transport close: ${errorMessage(error)}`);
    }

    if (forgetTools) {
      entry.tools = [];
      entry.lastDiscoveryAt = null;
    }
    if (!preserveState) {
      entry.state = "disconnected";
      entry.error = "";
    }
    this.emitChanged();
  }

  async disconnectServer(serverId, options = {}) {
    const entry = this.entries.get(String(serverId ?? ""));
    if (!entry) {
      return { ok: true, state: "disconnected" };
    }
    await this.disconnectEntry(entry, options);
    return this.publicEntry(entry);
  }

  async closeAll() {
    await Promise.allSettled(
      [...this.entries.values()].map((entry) =>
        this.disconnectEntry(entry, { forgetTools: false })
      )
    );
  }

  publicEntry(entry) {
    if (!entry) {
      return null;
    }
    return {
      serverId: entry.serverId,
      state: entry.state,
      error: entry.error,
      connectedAt: entry.connectedAt,
      lastDiscoveryAt: entry.lastDiscoveryAt,
      pid: entry.pid,
      serverInfo: structuredClone(entry.serverInfo),
      capabilities: structuredClone(entry.capabilities),
      instructions: entry.instructions,
      toolCount: entry.tools.length,
      tools: entry.tools.map(publicTool).filter(Boolean),
      logs: entry.logs.slice(-MAX_LOG_LINES)
    };
  }

  snapshot() {
    const servers = (this.settings.servers ?? []).map((server) => {
      const entry = this.entries.get(server.id);
      return {
        id: server.id,
        name: server.name,
        enabled: server.enabled,
        autoConnect: server.autoConnect,
        transport: server.transport,
        preset: server.preset,
        readOnly: server.readOnly,
        commandConfigured: Boolean(server.command),
        secretEnvKeys: [...(server.secretEnvKeys ?? [])],
        ...(entry ? this.publicEntry(entry) : {
          serverId: server.id,
          state: "disconnected",
          error: "",
          connectedAt: null,
          lastDiscoveryAt: null,
          pid: null,
          serverInfo: null,
          capabilities: null,
          instructions: "",
          toolCount: 0,
          tools: [],
          logs: []
        })
      };
    });

    return {
      enabled: this.settings.enabled !== false,
      autoConnect: this.settings.autoConnect !== false,
      serverCount: servers.length,
      connectedCount: servers.filter((server) => server.state === "connected").length,
      toolCount: servers.reduce((sum, server) => sum + (server.toolCount ?? 0), 0),
      servers
    };
  }

  emitChanged() {
    this.emit("changed", this.snapshot());
  }
}

export const mcpClientManager = new McpClientManager();
