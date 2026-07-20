import { EventEmitter } from "node:events";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";

import {
  createMcpToolDefinition,
  normalizeMcpToolResult
} from "./mcpToolAdapter.js";

import {
  McpRegistry,
  mcpServerConfigHash as configHash
} from "./McpRegistry.js";
import { McpJournal, redactMcpLogChunk } from "./McpJournal.js";
import { McpPermissionPolicy } from "./McpPermissionPolicy.js";
import { McpToolManifestTracker } from "./McpToolManifestTracker.js";
import { McpHealthMonitor } from "./McpHealthMonitor.js";
import { McpRecoveryManager } from "./McpRecoveryManager.js";

const MAX_TOOL_DESCRIPTION_LENGTH = 4000;
const MAX_TOOL_SCHEMA_BYTES = 512_000;
const MAX_SERVER_INSTRUCTIONS_LENGTH = 8000;

function createSecurityDiagnostics() {
  return {
    calls: 0,
    failures: 0,
    suspiciousResults: 0,
    truncatedResults: 0,
    binaryBlocksOmitted: 0,
    lastDurationMs: null,
    lastToolName: "",
    lastSuspiciousAt: null,
    lastSignals: []
  };
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



function parseRemoteMcpUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value ?? ""));
  } catch {
    const error = new Error("远程 MCP Server 地址无效。");
    error.code = "MCP_INVALID_URL";
    throw error;
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    const error = new Error("远程 MCP 仅支持 HTTPS；本机服务可使用 HTTP。");
    error.code = "MCP_INVALID_URL";
    throw error;
  }
  if (parsed.username || parsed.password || parsed.hash) {
    const error = new Error("MCP Server 地址不能包含账号、密码或片段。");
    error.code = "MCP_INVALID_URL";
    throw error;
  }
  const hostname = parsed.hostname.toLowerCase();
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (parsed.protocol === "http:" && !local) {
    const error = new Error("远程 MCP 必须使用 HTTPS；HTTP 仅允许本机地址。");
    error.code = "MCP_INSECURE_URL";
    throw error;
  }
  return parsed;
}

function remoteRequestInit(server, secrets = {}) {
  const headers = new Headers(server.headers ?? {});
  const token = String(secrets.MCP_REMOTE_TOKEN ?? "").trim();
  if (server.authMode === "bearer") {
    if (!token) {
      const error = new Error("该远程 MCP 连接尚未配置访问令牌。");
      error.code = "MCP_AUTH_REQUIRED";
      throw error;
    }
    headers.set("Authorization", `Bearer ${token}`);
  } else if (server.authMode === "api-key") {
    if (!token) {
      const error = new Error("该远程 MCP 连接尚未配置 API Key。");
      error.code = "MCP_AUTH_REQUIRED";
      throw error;
    }
    headers.set(server.apiKeyHeader || "X-API-Key", token);
  }
  return { headers };
}

function createDefaultTransport({ server, env, authProvider }) {
  if (server.transport === "stdio") {
    return new StdioClientTransport({
      command: server.command,
      args: server.args ?? [],
      cwd: server.cwd || undefined,
      env,
      stderr: "pipe"
    });
  }
  if (server.transport === "streamable-http") {
    return new StreamableHTTPClientTransport(parseRemoteMcpUrl(server.url), {
      authProvider,
      requestInit: remoteRequestInit(server, env),
      reconnectionOptions: {
        initialReconnectionDelay: 800,
        maxReconnectionDelay: 15000,
        reconnectionDelayGrowFactor: 1.8,
        maxRetries: 3
      }
    });
  }
  throw new Error(`不支持的 MCP Transport：${server.transport}`);
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

export class McpConnectionManager extends EventEmitter {
  constructor({
    credentialProvider = async () => ({}),
    clientFactory = (info, options) => new Client(info, options),
    transportFactory = createDefaultTransport,
    oauthFlowFactory = null,
    openExternal = async (url) => {
      const { shell } = await import("electron");
      await shell.openExternal(String(url));
    }
  } = {}) {
    super();
    this.credentialProvider = credentialProvider;
    this.clientFactory = clientFactory;
    this.transportFactory = transportFactory;
    this.oauthFlowFactory = oauthFlowFactory;
    this.openExternal = openExternal;
    this.registry = new McpRegistry();
    this.settings = this.registry.settings;
    this.entries = new Map();
    this.journal = new McpJournal();
    this.permissionPolicy = new McpPermissionPolicy();
    this.manifestTracker = new McpToolManifestTracker({ journal: this.journal });
    this.healthMonitor = new McpHealthMonitor({ manager: this });
    this.recoveryManager = new McpRecoveryManager({ manager: this });
  }

  setCredentialProvider(provider) {
    if (typeof provider === "function") {
      this.credentialProvider = provider;
    }
  }

  setOAuthFlowFactory(factory) {
    if (typeof factory === "function") {
      this.oauthFlowFactory = factory;
    }
  }

  getServerConfig(serverId) {
    return this.registry.getServer(serverId);
  }

  syncSettings(settings = {}) {
    const change = this.registry.sync(settings);
    if (!change.changed) {
      return this.snapshot();
    }

    this.settings = this.registry.settings;
    const configuredIds = new Set(this.settings.servers.map((server) => server.id));
    for (const [serverId, entry] of this.entries) {
      if (!configuredIds.has(serverId)) {
        void this.disconnectServer(serverId, { forgetTools: true, manual: true });
        this.entries.delete(serverId);
        this.manifestTracker.forget(serverId);
        this.recoveryManager.reset(serverId);
        continue;
      }
      const config = this.getServerConfig(serverId);
      const nextHash = configHash(config);
      if (entry.configHash && entry.configHash !== nextHash) {
        void this.disconnectServer(serverId, { forgetTools: false, manual: true });
      }
      entry.config = config;
      entry.configHash = nextHash;
    }

    this.healthMonitor.sync(this.settings);
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
        connectingConfigHash: "",
        disconnectingPromise: null,
        connectionGeneration: 0,
        tools: [],
        serverInfo: null,
        capabilities: null,
        instructions: "",
        error: "",
        connectedAt: null,
        lastDiscoveryAt: null,
        pid: null,
        manifestRevision: 0,
        manifestHash: "",
        health: {
          state: "unknown",
          latencyMs: null,
          checkedAt: null,
          consecutiveFailures: 0
        },
        recovery: {
          attempt: 0,
          nextRetryAt: null,
          reason: ""
        },
        security: createSecurityDiagnostics(),
        suppressRecovery: false
      };
      this.entries.set(server.id, entry);
    }
    return entry;
  }

  async connectServer(serverId, { force = false, recovery = false } = {}) {
    const server = this.getServerConfig(serverId);
    if (!server) {
      throw new Error("MCP Server 不存在。");
    }
    if (!this.settings.enabled || !server.enabled) {
      throw new Error("MCP Server 当前未启用。");
    }
    if (!["stdio", "streamable-http"].includes(server.transport)) {
      throw new Error("MCP Server 使用了不受支持的 Transport。");
    }
    if (server.transport === "stdio" && !server.command) {
      throw new Error("本地 MCP Server 尚未配置启动命令。");
    }
    if (server.transport === "streamable-http") {
      if (!server.url) {
        throw new Error("远程 MCP Server 尚未配置有效地址。");
      }
      parseRemoteMcpUrl(server.url);
    }
    if (
      server.transport === "streamable-http" &&
      server.authMode === "oauth" &&
      typeof this.oauthFlowFactory !== "function"
    ) {
      throw new Error("当前运行环境未启用 MCP OAuth 登录支持。");
    }

    const connectionDecision = this.permissionPolicy.connectionDecision(server);
    if (!connectionDecision.allowed) {
      const error = new Error(connectionDecision.reason);
      error.code = connectionDecision.code;
      throw error;
    }

    const entry = this.ensureEntry(server);
    if (!recovery) {
      this.recoveryManager.reset(server.id);
    }
    const nextHash = configHash(server);
    if (!force && entry.state === "connected" && entry.configHash === nextHash) {
      return this.publicEntry(entry);
    }
    if (entry.connectingPromise) {
      if (!force && entry.connectingConfigHash === nextHash) {
        return entry.connectingPromise;
      }
      await entry.connectingPromise.catch(() => null);
      return this.connectServer(serverId, { force, recovery });
    }

    const generation = entry.connectionGeneration + 1;
    entry.connectionGeneration = generation;
    entry.connectingConfigHash = nextHash;
    let connectingPromise = null;
    connectingPromise = this.doConnect(entry, server, nextHash, generation)
      .finally(() => {
        if (entry.connectingPromise === connectingPromise) {
          entry.connectingPromise = null;
          entry.connectingConfigHash = "";
        }
      });
    entry.connectingPromise = connectingPromise;
    return connectingPromise;
  }

  async doConnect(entry, server, nextHash, generation) {
    await this.disconnectEntry(entry, {
      forgetTools: false,
      manual: false,
      invalidateConnection: false
    });
    if (entry.connectionGeneration !== generation) {
      const error = new Error("MCP 连接请求已被更新的配置或断开操作取消。");
      error.code = "MCP_CONNECTION_CANCELLED";
      throw error;
    }
    entry.config = server;
    entry.configHash = nextHash;
    entry.state = "connecting";
    entry.error = "";
    this.emitChanged();

    let transport = null;
    let client = null;
    let oauthFlow = null;
    try {
      const secretEnvironment = await this.credentialProvider(server);
      const env = {
        ...(server.transport === "stdio" ? (server.env ?? {}) : {}),
        ...(secretEnvironment ?? {})
      };
      const secretValues = Object.values(secretEnvironment ?? {})
        .map((value) => String(value ?? ""))
        .filter(Boolean);

      if (server.transport === "streamable-http" && server.authMode === "oauth") {
        oauthFlow = await this.oauthFlowFactory({
          server,
          openExternal: this.openExternal,
          timeoutMs: Math.max(120000, server.connectTimeoutMs * 6)
        });
      }

      const createClient = () => {
        const nextClient = this.clientFactory(
          {
            name: "xixi-desktop-mcp-client",
            version: "1.0.0"
          },
          {
            capabilities: {},
            listChanged: {
              tools: {
                onChanged: (error, tools) => {
                  if (entry.client !== nextClient) {
                    return;
                  }
                  if (error) {
                    entry.error = errorMessage(error);
                    this.journal.append(entry.serverId, `tool list refresh: ${entry.error}`, { level: "developer", event: "MCP_TOOL_DISCOVERY_FAILED" });
                  } else {
                    const maxTools = Math.max(
                      1,
                      this.settings.maxToolsPerServer ?? 128
                    );
                    this.applyDiscoveredTools(entry, normalizeDiscoveredTools(tools, maxTools));
                    entry.error = "";
                  }
                  this.emitChanged();
                }
              }
            }
          }
        );
        nextClient.onclose = () => {
          if (entry.client !== nextClient) {
            return;
          }
          entry.client = null;
          entry.transport = null;
          entry.pid = null;
          entry.state = "disconnected";
          entry.health = {
            ...entry.health,
            state: "offline",
            checkedAt: Date.now()
          };
          if (!entry.error) {
            entry.error = server.transport === "stdio"
              ? "MCP Server 进程已退出。"
              : "远程 MCP 连接已关闭。";
          }
          this.journal.append(entry.serverId, entry.error, {
            level: "user",
            event: "MCP_CONNECTION_CLOSED"
          });
          this.emitChanged();
          if (!entry.suppressRecovery) {
            this.recoveryManager.schedule(entry.serverId, "connection-closed");
          }
        };
        nextClient.onerror = (error) => {
          if (entry.client !== nextClient) {
            return;
          }
          entry.error = errorMessage(error);
          this.journal.append(entry.serverId, `protocol: ${entry.error}`, { level: "developer", event: "MCP_PROTOCOL_ERROR" });
          this.emitChanged();
        };
        return nextClient;
      };

      const createTransport = () => {
        const nextTransport = this.transportFactory({
          server,
          command: server.command,
          args: server.args ?? [],
          cwd: server.cwd || undefined,
          env,
          stderr: "pipe",
          authProvider: oauthFlow?.provider
        });
        nextTransport.stderr?.on?.("data", (chunk) => {
          this.journal.append(entry.serverId, redactMcpLogChunk(chunk, secretValues), { level: "developer", event: "MCP_STDERR" });
          this.emitChanged();
        });
        return nextTransport;
      };

      const connectOnce = async () => {
        client = createClient();
        transport = createTransport();
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
      };

      try {
        await connectOnce();
      } catch (error) {
        if (!(error instanceof UnauthorizedError) || !oauthFlow) {
          throw error;
        }
        entry.state = "authorizing";
        entry.error = "请在浏览器中完成 MCP 授权。";
        this.emitChanged();
        const authorizationCode = await oauthFlow.waitForCode();
        if (typeof transport?.finishAuth !== "function") {
          throw new Error("当前远程 MCP Transport 无法完成 OAuth 授权。" );
        }
        await transport.finishAuth(authorizationCode);
        try {
          await client?.close?.();
        } catch {
          // Best effort before reconnecting with the saved token.
        }
        try {
          await transport?.close?.();
        } catch {
          // Best effort before reconnecting with the saved token.
        }
        entry.state = "connecting";
        entry.error = "";
        this.emitChanged();
        await connectOnce();
      }

      const currentConfig = this.getServerConfig(entry.serverId);
      if (
        entry.connectionGeneration !== generation ||
        !currentConfig ||
        currentConfig.enabled === false ||
        entry.configHash !== nextHash ||
        configHash(currentConfig) !== nextHash
      ) {
        const cancelled = entry.connectionGeneration !== generation;
        const error = new Error(cancelled
          ? "MCP 连接请求已被更新的配置或断开操作取消。"
          : "MCP Server 配置在连接过程中发生变化，已放弃旧连接。"
        );
        error.code = cancelled ? "MCP_CONNECTION_CANCELLED" : "MCP_CONFIG_CHANGED";
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
      entry.health = {
        state: "healthy",
        latencyMs: null,
        checkedAt: Date.now(),
        consecutiveFailures: 0
      };
      entry.recovery = { attempt: 0, nextRetryAt: null, reason: "" };
      this.recoveryManager.reset(entry.serverId);
      this.journal.append(entry.serverId, `MCP ${server.name} connected.`, {
        level: "user",
        event: "MCP_CONNECTED"
      });
      await this.discoverEntry(entry);
      this.emitChanged();
      return this.publicEntry(entry);
    } catch (error) {
      const stale = entry.connectionGeneration !== generation;
      if (!stale) {
        entry.error = errorMessage(error);
        entry.state = "error";
        entry.client = null;
        entry.transport = null;
        entry.pid = null;
      }
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
      if (!stale) {
        this.emitChanged();
      }
      throw error;
    } finally {
      try {
        await oauthFlow?.close?.();
      } catch {
        // OAuth callback cleanup is best effort.
      }
    }
  }

  applyDiscoveredTools(entry, tools) {
    entry.tools = tools;
    entry.lastDiscoveryAt = Date.now();
    const manifest = this.manifestTracker.update(entry.serverId, tools);
    entry.manifestRevision = manifest.revision;
    entry.manifestHash = manifest.hash;
    return entry.tools;
  }

  async discoverEntry(entry) {
    if (!entry.client) {
      throw new Error("MCP Server 尚未连接。");
    }
    const result = await entry.client.listTools();
    const maxTools = Math.max(1, this.settings.maxToolsPerServer ?? 128);
    return this.applyDiscoveredTools(
      entry,
      normalizeDiscoveredTools(result?.tools, maxTools)
    );
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

  async pingServer(serverId, { connect = true, timeoutMs = null } = {}) {
    let entry = this.entries.get(String(serverId ?? ""));
    if ((!entry || entry.state !== "connected" || !entry.client) && connect) {
      await this.connectServer(serverId);
      entry = this.entries.get(String(serverId ?? ""));
    }
    if (!entry?.client || entry.state !== "connected") {
      const error = new Error("MCP Server 尚未连接。");
      error.code = "MCP_NOT_CONNECTED";
      throw error;
    }
    const startedAt = Date.now();
    await entry.client.ping({
      timeout: timeoutMs ?? Math.min(
        entry.config?.callTimeoutMs ?? this.settings.callTimeoutMs ?? 60000,
        30000
      )
    });
    const latencyMs = Date.now() - startedAt;
    entry.health = {
      state: "healthy",
      latencyMs,
      checkedAt: Date.now(),
      consecutiveFailures: 0
    };
    entry.error = "";
    this.emitChanged();
    return {
      ok: true,
      latencyMs,
      server: this.publicEntry(entry)
    };
  }

  async checkServerHealth(serverId) {
    const entry = this.entries.get(String(serverId ?? ""));
    if (!entry || entry.state !== "connected" || !entry.client) {
      return { ok: false, skipped: true };
    }
    try {
      return await this.pingServer(serverId, {
        connect: false,
        timeoutMs: this.settings.health?.timeoutMs ?? 8000
      });
    } catch (error) {
      const failures = (entry.health?.consecutiveFailures ?? 0) + 1;
      const threshold = this.settings.health?.unhealthyThreshold ?? 2;
      entry.health = {
        state: failures >= threshold ? "offline" : "degraded",
        latencyMs: null,
        checkedAt: Date.now(),
        consecutiveFailures: failures
      };
      entry.error = errorMessage(error);
      this.journal.append(entry.serverId, `health check: ${entry.error}`, {
        level: "developer",
        event: "MCP_HEALTH_CHECK_FAILED"
      });
      this.emitChanged();
      if (failures >= threshold) {
        this.recoveryManager.schedule(entry.serverId, "health-check-failed");
      }
      return { ok: false, error: entry.error };
    }
  }

  recordToolResult(entry, toolName, normalized, durationMs) {
    const safety = normalized?.safety ?? {};
    const suspicious =
      safety.classification === "prompt-injection-suspected" ||
      (Array.isArray(safety.promptInjectionSignals) && safety.promptInjectionSignals.length > 0);
    const truncated =
      safety.contentTruncated === true ||
      safety.structuredTruncated === true;
    const binaryBlocksOmitted = Math.max(
      0,
      Number(safety.binaryBlocksOmitted) || 0
    );

    entry.security ??= createSecurityDiagnostics();
    entry.security.calls += 1;
    entry.security.lastDurationMs = Math.max(0, Number(durationMs) || 0);
    entry.security.lastToolName = String(toolName ?? "").slice(0, 256);
    entry.security.binaryBlocksOmitted += binaryBlocksOmitted;
    if (truncated) {
      entry.security.truncatedResults += 1;
    }
    if (suspicious) {
      entry.security.suspiciousResults += 1;
      entry.security.lastSuspiciousAt = Date.now();
      entry.security.lastSignals = (safety.promptInjectionSignals ?? [])
        .map((item) => String(item ?? "").slice(0, 120))
        .slice(0, 8);
      this.journal.append(
        entry.serverId,
        `MCP 工具 ${toolName} 返回内容包含疑似提示词注入信号。`,
        {
          level: "user",
          event: "MCP_PROMPT_INJECTION_SUSPECTED",
          data: {
            toolName: entry.security.lastToolName,
            signals: entry.security.lastSignals
          }
        }
      );
    }

    this.journal.append(entry.serverId, `tool ${toolName} completed in ${entry.security.lastDurationMs}ms`, {
      level: "developer",
      event: "MCP_TOOL_CALL_COMPLETED",
      data: {
        toolName: entry.security.lastToolName,
        durationMs: entry.security.lastDurationMs,
        suspicious,
        truncated,
        binaryBlocksOmitted
      }
    });
  }

  recordToolFailure(entry, toolName, durationMs, error) {
    entry.security ??= createSecurityDiagnostics();
    entry.security.calls += 1;
    entry.security.failures += 1;
    entry.security.lastDurationMs = Math.max(0, Number(durationMs) || 0);
    entry.security.lastToolName = String(toolName ?? "").slice(0, 256);
    entry.error = errorMessage(error);
    this.journal.append(entry.serverId, `tool call: ${entry.error}`, {
      level: "developer",
      event: "MCP_TOOL_CALL_FAILED",
      data: {
        toolName: entry.security.lastToolName,
        durationMs: entry.security.lastDurationMs
      }
    });
  }

  async invokeTool(entry, toolName, input, { signal, timeoutMs } = {}) {
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
    return normalizeMcpToolResult(result, {
      serverId: entry.serverId,
      toolName,
      limits: this.settings.resultLimits
    });
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

    const tool = entry.tools.find((candidate) => candidate.name === String(toolName ?? ""));
    if (!tool) {
      const error = new Error("MCP 工具不存在或工具清单已经变化。");
      error.code = "MCP_TOOL_NOT_FOUND";
      throw error;
    }
    this.permissionPolicy.assertToolAllowed(entry.config, tool);

    const startedAt = Date.now();
    try {
      const normalized = await this.invokeTool(entry, toolName, input, { signal, timeoutMs });
      this.recordToolResult(entry, toolName, normalized, Date.now() - startedAt);
      entry.error = "";
      this.emitChanged();
      return normalized;
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      this.recordToolFailure(entry, toolName, Date.now() - startedAt, error);
      this.emitChanged();

      const decision = this.permissionPolicy.toolDecision(entry.config, tool);
      const canRecover = decision.capabilities?.readOnly === true || entry.config.readOnly === true;
      if (canRecover && this.settings.recovery?.enabled !== false) {
        try {
          await this.connectServer(entry.serverId, { force: true, recovery: true });
          const recovered = this.entries.get(entry.serverId);
          if (recovered?.client) {
            const recoveryStartedAt = Date.now();
            const normalized = await this.invokeTool(recovered, toolName, input, { signal, timeoutMs });
            this.recordToolResult(
              recovered,
              toolName,
              normalized,
              Date.now() - recoveryStartedAt
            );
            recovered.error = "";
            this.emitChanged();
            return normalized;
          }
        } catch (recoveryError) {
          this.journal.append(entry.serverId, `tool recovery: ${errorMessage(recoveryError)}`, {
            level: "developer",
            event: "MCP_TOOL_RECOVERY_FAILED"
          });
        }
      }
      throw error;
    }
  }

  getToolDefinitions(settings = null, { includeDenied = false } = {}) {
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
        const permission = this.permissionPolicy.toolDecision(server, tool);
        if (!permission.allowed && !includeDenied) {
          continue;
        }
        const definition = createMcpToolDefinition({
          manager: this,
          server,
          tool,
          manifestRevision: entry.manifestRevision,
          manifestHash: entry.manifestHash
        });
        definition.mcp.permission = permission;
        definitions.push(definition);
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

  async disconnectEntry(entry, options = {}) {
    const manual = options.manual !== false;
    const invalidateConnection = options.invalidateConnection ?? manual;
    if (invalidateConnection) {
      entry.connectionGeneration += 1;
    }
    if (entry.disconnectingPromise) {
      return entry.disconnectingPromise;
    }

    let disconnectingPromise = null;
    disconnectingPromise = this.performDisconnectEntry(entry, {
      ...options,
      manual
    }).finally(() => {
      if (entry.disconnectingPromise === disconnectingPromise) {
        entry.disconnectingPromise = null;
      }
    });
    entry.disconnectingPromise = disconnectingPromise;
    return disconnectingPromise;
  }

  async performDisconnectEntry(entry, { forgetTools = false, preserveState = false, manual = true } = {}) {
    const client = entry.client;
    const transport = entry.transport;
    entry.suppressRecovery = true;
    entry.client = null;
    entry.transport = null;
    entry.pid = null;

    try {
      await transport?.terminateSession?.();
    } catch (error) {
      this.journal.append(entry.serverId, `session terminate: ${errorMessage(error)}`, { level: "debug", event: "MCP_CLOSE_WARNING" });
    }
    try {
      await client?.close?.();
    } catch (error) {
      this.journal.append(entry.serverId, `client close: ${errorMessage(error)}`, { level: "debug", event: "MCP_CLOSE_WARNING" });
    }
    try {
      await transport?.close?.();
    } catch (error) {
      this.journal.append(entry.serverId, `transport close: ${errorMessage(error)}`, { level: "debug", event: "MCP_CLOSE_WARNING" });
    }

    if (forgetTools) {
      entry.tools = [];
      entry.lastDiscoveryAt = null;
      entry.manifestRevision = 0;
      entry.manifestHash = "";
      this.manifestTracker.forget(entry.serverId);
    }
    if (!preserveState) {
      entry.state = "disconnected";
      entry.error = "";
      entry.health = {
        state: "unknown",
        latencyMs: null,
        checkedAt: Date.now(),
        consecutiveFailures: 0
      };
    }
    if (manual) {
      this.recoveryManager.reset(entry.serverId);
      entry.recovery = { attempt: 0, nextRetryAt: null, reason: "" };
    }
    entry.suppressRecovery = false;
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

  markRecoveryScheduled(serverId, attempt, delayMs, reason) {
    const entry = this.entries.get(String(serverId ?? ""));
    if (!entry) return;
    entry.state = "reconnecting";
    entry.recovery = {
      attempt,
      nextRetryAt: Date.now() + delayMs,
      reason
    };
    this.journal.append(entry.serverId, `Recovery attempt ${attempt} scheduled in ${delayMs}ms.`, {
      level: "user",
      event: "MCP_RECOVERY_SCHEDULED",
      data: { attempt, delayMs, reason }
    });
    this.emitChanged();
  }

  markRecoveryExhausted(serverId, attempts, reason) {
    const entry = this.entries.get(String(serverId ?? ""));
    if (!entry) return;
    entry.state = "offline";
    entry.recovery = { attempt: attempts, nextRetryAt: null, reason };
    entry.error = `MCP 自动恢复已在 ${attempts} 次尝试后停止。`;
    this.journal.append(entry.serverId, entry.error, {
      level: "user",
      event: "MCP_RECOVERY_EXHAUSTED"
    });
    this.emitChanged();
  }

  async closeAll() {
    this.healthMonitor.stop();
    this.recoveryManager.close();
    await Promise.allSettled(
      [...this.entries.values()].map((entry) =>
        this.disconnectEntry(entry, { forgetTools: false, manual: true })
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
      transport: entry.config?.transport ?? "stdio",
      authMode: entry.config?.authMode ?? "none",
      endpoint: entry.config?.transport === "streamable-http"
        ? entry.config?.url ?? ""
        : "",
      serverInfo: structuredClone(entry.serverInfo),
      capabilities: structuredClone(entry.capabilities),
      instructions: entry.instructions,
      manifestRevision: entry.manifestRevision,
      manifestHash: entry.manifestHash,
      health: structuredClone(entry.health),
      recovery: structuredClone(entry.recovery),
      security: structuredClone(entry.security ?? createSecurityDiagnostics()),
      permissions: structuredClone(entry.config?.permissions ?? {}),
      toolCount: entry.tools.length,
      allowedToolCount: entry.tools.filter((tool) =>
        this.permissionPolicy.toolDecision(entry.config, tool).allowed
      ).length,
      tools: entry.tools.map((tool) => ({
        ...publicTool(tool),
        permission: this.permissionPolicy.toolDecision(entry.config, tool)
      })).filter(Boolean),
      logs: this.journal.list(entry.serverId, { level: this.settings.logLevel ?? "developer" })
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
        authMode: server.authMode ?? "none",
        endpoint: server.transport === "streamable-http" ? server.url : "",
        commandConfigured: Boolean(server.command),
        secretEnvKeys: [...(server.secretEnvKeys ?? [])],
        ...(entry ? this.publicEntry(entry) : {
          serverId: server.id,
          state: "disconnected",
          error: "",
          transport: server.transport,
          authMode: server.authMode ?? "none",
          endpoint: server.transport === "streamable-http" ? server.url : "",
          connectedAt: null,
          lastDiscoveryAt: null,
          pid: null,
          serverInfo: null,
          capabilities: null,
          instructions: "",
          manifestRevision: 0,
          manifestHash: "",
          health: { state: "unknown", latencyMs: null, checkedAt: null, consecutiveFailures: 0 },
          recovery: { attempt: 0, nextRetryAt: null, reason: "" },
          security: createSecurityDiagnostics(),
          permissions: structuredClone(server.permissions ?? {}),
          toolCount: 0,
          allowedToolCount: 0,
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
      healthyCount: servers.filter((server) => server.health?.state === "healthy").length,
      recoveringCount: servers.filter((server) => server.state === "reconnecting").length,
      toolCount: servers.reduce((sum, server) => sum + (server.toolCount ?? 0), 0),
      allowedToolCount: servers.reduce((sum, server) => sum + (server.allowedToolCount ?? 0), 0),
      servers
    };
  }

  emitChanged() {
    this.emit("changed", this.snapshot());
  }
}

