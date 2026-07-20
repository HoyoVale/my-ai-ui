const SECRET_NAME_PATTERN = /(?:^|_)(?:TOKEN|API_KEY|KEY|SECRET|PASSWORD|PASSCODE|CREDENTIAL)(?:$|_)/iu;
const SENSITIVE_HEADER_NAMES = new Set(["authorization", "cookie", "proxy-authorization"]);

function safeId(value, fallback) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  return normalized || fallback;
}


function sanitizeHeaders(headers = {}) {
  const output = {};
  for (const [rawName, rawValue] of Object.entries(headers ?? {})) {
    const name = String(rawName ?? "").trim();
    const value = String(rawValue ?? "").trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,80}$/u.test(name)) continue;
    if (!value || value.length > 2000 || /[\r\n]/u.test(value)) continue;
    if (SENSITIVE_HEADER_NAMES.has(name.toLowerCase())) continue;
    output[name] = value;
  }
  return output;
}

function publicEnvironment(env = {}, secretEnvKeys = []) {
  const secretNames = new Set((secretEnvKeys ?? []).map((name) => String(name ?? "").toUpperCase()));
  return Object.fromEntries(
    Object.entries(env ?? {}).filter(([rawName]) => {
      const name = String(rawName ?? "").toUpperCase();
      return !secretNames.has(name) && !SECRET_NAME_PATTERN.test(name);
    })
  );
}

function splitEnvironment(env = {}) {
  const publicEnv = {};
  const secretEnvKeys = [];
  for (const [rawName, rawValue] of Object.entries(env ?? {})) {
    const name = String(rawName ?? "").trim().toUpperCase();
    if (!/^[A-Z_][A-Z0-9_]{0,63}$/u.test(name)) continue;
    if (SECRET_NAME_PATTERN.test(name)) {
      secretEnvKeys.push(name);
    } else {
      publicEnv[name] = String(rawValue ?? "").slice(0, 4000);
    }
  }
  return { env: publicEnv, secretEnvKeys };
}

function normalizeServer(name, source = {}, index = 0) {
  const id = safeId(source.id ?? name, `mcp-${index + 1}`);
  const remoteUrl = source.url ?? source.serverUrl ?? source.endpoint ?? "";
  if (remoteUrl) {
    return {
      id,
      name: String(source.name ?? name ?? id).slice(0, 80),
      enabled: source.enabled === true,
      autoConnect: source.autoConnect !== false,
      transport: "streamable-http",
      url: String(remoteUrl),
      authMode: source.authMode ?? "none",
      apiKeyHeader: source.apiKeyHeader ?? "X-API-Key",
      oauthScopes: Array.isArray(source.oauthScopes) ? source.oauthScopes : [],
      headers: sanitizeHeaders(source.headers),
      command: "",
      args: [],
      cwd: "",
      env: {},
      secretEnvKeys: source.secretEnvKeys ?? [],
      readOnly: source.readOnly === true,
      preset: "remote",
      permissions: source.permissions,
      recovery: source.recovery,
      connectTimeoutMs: source.connectTimeoutMs ?? 15000,
      callTimeoutMs: source.callTimeoutMs ?? 60000
    };
  }
  const environment = splitEnvironment(source.env ?? {});
  return {
    id,
    name: String(source.name ?? name ?? id).slice(0, 80),
    enabled: source.enabled === true,
    autoConnect: source.autoConnect !== false,
    transport: "stdio",
    url: "",
    authMode: "none",
    apiKeyHeader: "X-API-Key",
    oauthScopes: [],
    headers: {},
    command: String(source.command ?? ""),
    args: Array.isArray(source.args) ? source.args.map(String) : [],
    cwd: String(source.cwd ?? ""),
    env: environment.env,
    secretEnvKeys: [...new Set([...(source.secretEnvKeys ?? []), ...environment.secretEnvKeys])],
    readOnly: source.readOnly === true,
    preset: "custom",
    permissions: source.permissions,
    recovery: source.recovery,
    connectTimeoutMs: source.connectTimeoutMs ?? 15000,
    callTimeoutMs: source.callTimeoutMs ?? 60000
  };
}

export function importMcpConfiguration(payload = {}) {
  const warnings = [];
  let entries = [];
  if (payload.mcpServers && typeof payload.mcpServers === "object") {
    entries = Object.entries(payload.mcpServers);
  } else if (Array.isArray(payload?.mcp?.servers)) {
    entries = payload.mcp.servers.map((server) => [server.name ?? server.id, server]);
  } else if (Array.isArray(payload.servers)) {
    entries = payload.servers.map((server) => [server.name ?? server.id, server]);
  } else {
    throw new Error("未找到可导入的 mcpServers 或 servers 配置。");
  }
  const servers = entries.slice(0, 32).map(([name, source], index) => {
    const server = normalizeServer(name, source, index);
    if (source.env && Object.keys(source.env).some((key) => SECRET_NAME_PATTERN.test(key))) {
      warnings.push(`${server.name}：检测到的敏感环境变量只导入变量名，未导入明文值。`);
    }
    if (source.headers && Object.keys(source.headers).some((key) => SENSITIVE_HEADER_NAMES.has(String(key).toLowerCase()))) {
      warnings.push(`${server.name}：Authorization、Cookie 等敏感 Header 未被导入。`);
    }
    return server;
  });
  return { servers, warnings };
}

function exportServer(server = {}) {
  if (server.transport === "streamable-http") {
    return {
      url: server.url,
      authMode: server.authMode,
      apiKeyHeader: server.apiKeyHeader,
      oauthScopes: server.oauthScopes,
      headers: sanitizeHeaders(server.headers),
      enabled: server.enabled,
      autoConnect: server.autoConnect,
      readOnly: server.readOnly,
      permissions: server.permissions,
      recovery: server.recovery
    };
  }
  return {
    command: server.command,
    args: server.args,
    cwd: server.cwd || undefined,
    env: publicEnvironment(server.env, server.secretEnvKeys),
    secretEnvKeys: server.secretEnvKeys,
    enabled: server.enabled,
    autoConnect: server.autoConnect,
    readOnly: server.readOnly,
    permissions: server.permissions,
    recovery: server.recovery
  };
}

export function exportMcpConfiguration(settings = {}) {
  const mcp = settings.mcp ?? settings;
  return {
    version: 1,
    mcp: {
      enabled: mcp.enabled !== false,
      autoConnect: mcp.autoConnect !== false,
      connectTimeoutMs: mcp.connectTimeoutMs,
      callTimeoutMs: mcp.callTimeoutMs,
      maxToolsPerServer: mcp.maxToolsPerServer,
      logLevel: mcp.logLevel,
      health: mcp.health,
      recovery: mcp.recovery,
      resultLimits: mcp.resultLimits,
      servers: (mcp.servers ?? []).map((server) => ({
        id: server.id,
        name: server.name,
        ...exportServer(server)
      }))
    }
  };
}
