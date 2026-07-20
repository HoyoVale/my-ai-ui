import {
  useMemo,
  useState
} from "react";

import {
  ActionButton,
  SettingRow,
  SettingsSection,
  Select,
  Slider,
  TextArea,
  TextInput,
  Toggle
} from "../components/Controls.jsx";

import {
  useMcpState
} from "../hooks/useMcpState.js";

const REMOTE_TOKEN_KEY = "MCP_REMOTE_TOKEN";

const AUTH_OPTIONS = [
  { value: "none", label: "无需认证" },
  { value: "oauth", label: "浏览器登录（OAuth）" },
  { value: "bearer", label: "Bearer Token" },
  { value: "api-key", label: "API Key" }
];

const LOG_LEVEL_OPTIONS = [
  { value: "user", label: "User" },
  { value: "developer", label: "Developer" },
  { value: "debug", label: "Debug" }
];

function uniqueServerId(servers, base) {
  const used = new Set((servers ?? []).map((server) => server.id));
  let id = base;
  let index = 2;
  while (used.has(id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  return id;
}

function defaultPermissions(readOnly = true) {
  return {
    localProcess: true,
    network: true,
    account: true,
    fileRead: true,
    fileWrite: !readOnly,
    externalWrite: !readOnly,
    destructive: false,
    tools: {}
  };
}

function remoteTemplate(servers) {
  return {
    id: uniqueServerId(servers, "remote-mcp"),
    name: "远程 MCP",
    enabled: false,
    autoConnect: true,
    transport: "streamable-http",
    url: "",
    authMode: "none",
    apiKeyHeader: "X-API-Key",
    oauthScopes: [],
    headers: {},
    command: "",
    args: [],
    cwd: "",
    env: {},
    secretEnvKeys: [],
    readOnly: true,
    permissions: defaultPermissions(true),
    recovery: { enabled: true, maxAttempts: 3 },
    preset: "remote",
    connectTimeoutMs: 20000,
    callTimeoutMs: 60000
  };
}

function localTemplate(servers) {
  const id = uniqueServerId(servers, "local-mcp");
  return {
    id,
    name: "本地 MCP",
    enabled: false,
    autoConnect: true,
    transport: "stdio",
    command: "",
    args: [],
    cwd: "",
    env: {},
    headers: {},
    secretEnvKeys: [],
    url: "",
    authMode: "none",
    apiKeyHeader: "X-API-Key",
    oauthScopes: [],
    readOnly: true,
    permissions: defaultPermissions(true),
    recovery: { enabled: true, maxAttempts: 3 },
    preset: "custom",
    connectTimeoutMs: 15000,
    callTimeoutMs: 60000
  };
}

function parseEnvironment(text) {
  const output = {};
  for (const line of String(text ?? "").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator).trim().toUpperCase();
    const value = trimmed.slice(separator + 1);
    if (/^[A-Z_][A-Z0-9_]{0,63}$/u.test(name)) output[name] = value;
  }
  return output;
}

function formatEnvironment(env = {}) {
  return Object.entries(env).map(([name, value]) => `${name}=${value}`).join("\n");
}

function parseHeaders(text) {
  const output = {};
  for (const line of String(text ?? "").split(/\r?\n/u)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,80}$/u.test(name) && value) {
      output[name] = value;
    }
  }
  return output;
}

function formatHeaders(headers = {}) {
  return Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join("\n");
}

function parseSecretKeys(text) {
  return [...new Set(
    String(text ?? "")
      .split(/[\s,]+/u)
      .map((value) => value.trim().toUpperCase())
      .filter((value) => /^[A-Z_][A-Z0-9_]{0,63}$/u.test(value))
  )];
}

function statusCopy(serverState) {
  const state = serverState?.state ?? "disconnected";
  if (state === "connected") return "已连接";
  if (state === "connecting") return "正在连接";
  if (state === "authorizing") return "等待登录";
  if (state === "reconnecting") return "正在恢复";
  if (state === "offline") return "离线";
  if (state === "error") return "连接失败";
  return "未连接";
}

function healthCopy(serverState) {
  const health = serverState?.health;
  if (health?.state === "healthy") {
    return `健康${Number.isFinite(health.latencyMs) ? ` · ${health.latencyMs} ms` : ""}`;
  }
  if (health?.state === "degraded") return "连接不稳定";
  if (health?.state === "offline") return "健康检查失败";
  return "尚未检查";
}

function waitForSettingsCommit() {
  return new Promise((resolve) => setTimeout(resolve, 180));
}

function CredentialEditor({ server, state, onAction }) {
  const [values, setValues] = useState({});
  const keys = server.transport === "streamable-http" && ["bearer", "api-key"].includes(server.authMode)
    ? [...new Set([...(server.secretEnvKeys ?? []), REMOTE_TOKEN_KEY])]
    : server.secretEnvKeys ?? [];
  if (keys.length === 0) return null;

  const statuses = new Map((state?.credentialStatuses ?? []).map((item) => [item.envName, item]));
  return (
    <div className="mcp-credential-list">
      {keys.map((envName) => {
        const status = statuses.get(envName);
        return (
          <div className="mcp-credential" key={envName}>
            <div className="mcp-credential__name">
              <code>{envName}</code>
              <span>{status?.configured ? "已保存" : "未配置"}</span>
            </div>
            <TextInput
              type="password"
              autoComplete="off"
              value={values[envName] ?? ""}
              placeholder="输入后保存"
              onChange={(value) => setValues((current) => ({ ...current, [envName]: value }))}
            />
            <div className="mcp-inline-actions">
              <ActionButton
                disabled={!values[envName]}
                onClick={() => onAction(async () => {
                  await window.api?.setMcpSecret?.(server.id, envName, values[envName]);
                  setValues((current) => ({ ...current, [envName]: "" }));
                })}
              >
                保存
              </ActionButton>
              <ActionButton
                tone="danger"
                disabled={!status?.configured}
                onClick={() => onAction(() => window.api?.clearMcpSecret?.(server.id, envName))}
              >
                清除
              </ActionButton>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AddConnectionSheet({ servers, onAdd }) {
  return (
    <section className="mcp-add-sheet" data-testid="mcp-add-sheet">
      <header>
        <div>
          <h3>添加 MCP 连接</h3>
          <p>连接配置保持通用，不再绑定 GitHub、Docker 或其他具体服务。</p>
        </div>
      </header>
      <div className="mcp-connection-options">
        <button
          type="button"
          data-testid="mcp-add-remote"
          className="mcp-connection-option is-recommended"
          onClick={() => onAdd(remoteTemplate(servers))}
        >
          <span className="mcp-connection-option__icon">↗</span>
          <strong>远程 MCP</strong>
          <small>Streamable HTTP，支持 OAuth、Token 与 API Key。</small>
          <em>推荐</em>
        </button>
        <button
          type="button"
          data-testid="mcp-add-local"
          className="mcp-connection-option"
          onClick={() => onAdd(localTemplate(servers))}
        >
          <span className="mcp-connection-option__icon">⌘</span>
          <strong>本地 MCP</strong>
          <small>通过 stdio 启动本地命令；敏感环境变量单独保存。</small>
        </button>
      </div>
    </section>
  );
}

function mergeImportedServers(current, imported) {
  const used = new Set(current.map((server) => server.id));
  return imported.map((server) => {
    const base = server.id || "imported-mcp";
    let id = base;
    let index = 2;
    while (used.has(id)) {
      id = `${base.slice(0, 42)}-${index}`;
      index += 1;
    }
    used.add(id);
    return { ...server, id, enabled: false };
  });
}

export function McpPanel({ settings, developerMode = false, onUpdate }) {
  const mcp = settings.mcp;
  const servers = mcp.servers ?? [];
  const { state, status, action, error, run, clearError } = useMcpState();
  const [expanded, setExpanded] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [notice, setNotice] = useState("");

  const stateById = useMemo(
    () => new Map((state.servers ?? []).map((server) => [server.id, server])),
    [state.servers]
  );

  const updateServers = (nextServers) => onUpdate({ ...mcp, servers: nextServers });
  const updateServer = (serverId, patch) => {
    updateServers(servers.map((server) => server.id === serverId ? { ...server, ...patch } : server));
  };
  const addServer = (server) => {
    updateServers([...servers, server]);
    setExpanded(server.id);
    setShowAdd(false);
  };
  const runAction = (key, callback) => {
    clearError();
    setNotice("");
    void run(key, callback);
  };

  const importConfig = () => runAction("import", async () => {
    const result = await window.api?.importMcpConfig?.();
    if (!result?.ok) return result;
    const imported = mergeImportedServers(servers, result.servers ?? []);
    updateServers([...servers, ...imported]);
    setNotice(`已导入 ${imported.length} 个连接，默认保持关闭。${result.warnings?.length ? ` ${result.warnings.join(" ")}` : ""}`);
    return result;
  });

  return (
    <>
      <SettingsSection title="MCP 连接">
        <div className="mcp-page-intro">
          <div>
            <strong>连接与工具分离</strong>
            <p>MCP 页面只管理连接、认证、健康和安全策略；发现的工具统一进入 Tools。</p>
          </div>
          <div className="mcp-inline-actions">
            <ActionButton testId="mcp-import-config" disabled={Boolean(action)} onClick={importConfig}>导入配置</ActionButton>
            <ActionButton disabled={Boolean(action)} onClick={() => runAction("export", () => window.api?.exportMcpConfig?.())}>导出备份</ActionButton>
            <ActionButton testId="mcp-add-connection" onClick={() => setShowAdd((value) => !value)}>添加连接</ActionButton>
          </div>
        </div>

        <SettingRow title="启用 MCP">
          <Toggle checked={mcp.enabled !== false} label="启用 MCP" onChange={(enabled) => onUpdate({ ...mcp, enabled })} />
        </SettingRow>
        <SettingRow title="自动连接">
          <Toggle checked={mcp.autoConnect !== false} label="自动连接 MCP" onChange={(autoConnect) => onUpdate({ ...mcp, autoConnect })} />
        </SettingRow>

        <div className="mcp-overview" data-testid="mcp-overview">
          <div><strong>{state.connectedCount ?? 0}/{state.serverCount ?? servers.length}</strong><span>已连接</span></div>
          <div><strong>{state.healthyCount ?? 0}</strong><span>健康</span></div>
          <div><strong>{state.recoveringCount ?? 0}</strong><span>恢复中</span></div>
          <div><strong>{state.allowedToolCount ?? state.toolCount ?? 0}</strong><span>可用工具</span></div>
        </div>

        {showAdd && <AddConnectionSheet servers={servers} onAdd={addServer} />}
        {status === "loading" && <div className="mcp-message">正在读取 MCP 状态…</div>}
        {error && <div className="mcp-message mcp-message--error">{error}</div>}
        {notice && <div className="mcp-message">{notice}</div>}
      </SettingsSection>

      {servers.length === 0 ? (
        <section className="mcp-empty-state">
          <div className="mcp-empty-state__icon">M</div>
          <h3>还没有 MCP 连接</h3>
          <p>可手动添加本地或远程连接，也可导入通用 MCP JSON 配置。</p>
        </section>
      ) : servers.map((server) => {
        const serverState = stateById.get(server.id);
        const isRemote = server.transport === "streamable-http";
        const isExpanded = expanded === server.id;
        const permissions = { ...defaultPermissions(server.readOnly), ...(server.permissions ?? {}) };
        return (
          <section className="mcp-server-card" key={server.id} data-testid={`mcp-server-${server.id}`}>
            <header className="mcp-server-card__header">
              <div className="mcp-server-card__identity">
                <span className="mcp-server-card__logo">{isRemote ? "↗" : "⌘"}</span>
                <button type="button" className="mcp-server-card__toggle" onClick={() => setExpanded(isExpanded ? "" : server.id)}>
                  <span className="mcp-server-card__title">{server.name}</span>
                  <small>{isRemote ? server.url || "未配置地址" : server.command || "未配置命令"}</small>
                </button>
              </div>
              <Toggle checked={server.enabled === true} label={`启用 ${server.name}`} onChange={(enabled) => updateServer(server.id, { enabled })} />
            </header>

            <div className="mcp-server-card__summary">
              <span className={`mcp-status mcp-status--${serverState?.state ?? "disconnected"}`}>{statusCopy(serverState)}</span>
              <span>{healthCopy(serverState)}</span>
              <span>Manifest r{serverState?.manifestRevision ?? 0}</span>
              <span>{serverState?.allowedToolCount ?? 0}/{serverState?.toolCount ?? 0} 个工具可用</span>
            </div>

            <div className="mcp-server-card__actions">
              <ActionButton disabled={Boolean(action)} onClick={() => runAction(`connect:${server.id}`, async () => {
                await waitForSettingsCommit();
                return window.api?.connectMcpServer?.(server.id);
              })}>连接</ActionButton>
              <ActionButton disabled={Boolean(action)} onClick={() => runAction(`ping:${server.id}`, () => window.api?.pingMcpServer?.(server.id))}>检查</ActionButton>
              <ActionButton disabled={Boolean(action)} onClick={() => runAction(`refresh:${server.id}`, () => window.api?.refreshMcpServer?.(server.id))}>刷新清单</ActionButton>
              <ActionButton disabled={Boolean(action)} onClick={() => runAction(`disconnect:${server.id}`, () => window.api?.disconnectMcpServer?.(server.id))}>断开</ActionButton>
            </div>

            {serverState?.error && <div className="mcp-message mcp-message--error">{serverState.error}</div>}

            {isExpanded && (
              <div className="mcp-server-card__body">
                <SettingsSection title="连接配置">
                  <SettingRow title="名称"><TextInput value={server.name} onChange={(name) => updateServer(server.id, { name })} /></SettingRow>
                  {isRemote ? (
                    <>
                      <SettingRow title="Server 地址"><TextInput testId={`mcp-url-${server.id}`} value={server.url ?? ""} placeholder="https://example.com/mcp" onChange={(url) => updateServer(server.id, { url })} /></SettingRow>
                      <SettingRow title="认证方式"><Select value={server.authMode ?? "none"} options={AUTH_OPTIONS} onChange={(authMode) => updateServer(server.id, {
                        authMode,
                        secretEnvKeys: ["bearer", "api-key"].includes(authMode)
                          ? [...new Set([...(server.secretEnvKeys ?? []), REMOTE_TOKEN_KEY])]
                          : (server.secretEnvKeys ?? []).filter((key) => key !== REMOTE_TOKEN_KEY)
                      })} /></SettingRow>
                      {server.authMode === "api-key" && <SettingRow title="API Key Header"><TextInput value={server.apiKeyHeader ?? "X-API-Key"} onChange={(apiKeyHeader) => updateServer(server.id, { apiKeyHeader })} /></SettingRow>}
                      {server.authMode === "oauth" && <SettingRow title="OAuth Scopes"><TextInput value={(server.oauthScopes ?? []).join(" ")} onChange={(value) => updateServer(server.id, { oauthScopes: value.split(/[\s,]+/u).filter(Boolean) })} /></SettingRow>}
                      <SettingRow title="固定 Headers"><TextArea rows={3} value={formatHeaders(server.headers)} placeholder="X-Client: my-ai-ui" onChange={(value) => updateServer(server.id, { headers: parseHeaders(value) })} /></SettingRow>
                    </>
                  ) : (
                    <>
                      <SettingRow title="Command"><TextInput value={server.command ?? ""} placeholder="node / npx / uvx" onChange={(command) => updateServer(server.id, { command })} /></SettingRow>
                      <SettingRow title="Arguments"><TextArea rows={3} value={(server.args ?? []).join("\n")} placeholder="每行一个参数" onChange={(value) => updateServer(server.id, { args: value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean) })} /></SettingRow>
                      <SettingRow title="Working Directory"><TextInput value={server.cwd ?? ""} placeholder="可选的绝对路径" onChange={(cwd) => updateServer(server.id, { cwd })} /></SettingRow>
                      <SettingRow title="普通环境变量"><TextArea rows={4} value={formatEnvironment(server.env)} placeholder="NAME=value" onChange={(value) => updateServer(server.id, { env: parseEnvironment(value) })} /></SettingRow>
                      <SettingRow title="敏感变量名"><TextInput value={(server.secretEnvKeys ?? []).join(", ")} placeholder="TOKEN, API_KEY" onChange={(value) => updateServer(server.id, { secretEnvKeys: parseSecretKeys(value) })} /></SettingRow>
                    </>
                  )}
                  <SettingRow title="自动连接"><Toggle checked={server.autoConnect !== false} label="自动连接" onChange={(autoConnect) => updateServer(server.id, { autoConnect })} /></SettingRow>
                  <SettingRow title="只读连接"><Toggle checked={server.readOnly === true} label="只读 MCP" onChange={(readOnly) => updateServer(server.id, {
                    readOnly,
                    permissions: {
                      ...permissions,
                      fileWrite: readOnly ? false : permissions.fileWrite,
                      externalWrite: readOnly ? false : permissions.externalWrite
                    }
                  })} /></SettingRow>
                </SettingsSection>

                <SettingsSection title="凭据">
                  <CredentialEditor server={server} state={serverState} onAction={(callback) => runAction(`credential:${server.id}`, callback)} />
                  {server.authMode === "oauth" && (
                    <ActionButton tone="danger" onClick={() => runAction(`auth:${server.id}`, () => window.api?.clearMcpAuthentication?.(server.id))}>清除登录</ActionButton>
                  )}
                  {(server.secretEnvKeys ?? []).length === 0 && server.authMode !== "oauth" && <div className="mcp-message">此连接未声明凭据。</div>}
                </SettingsSection>

                <SettingsSection title="权限矩阵">
                  <div className="mcp-security-note">这是 Host 侧工具发现与调用权限，不等同于操作系统沙箱。stdio Server 的进程权限仍由系统账户决定。</div>
                  {!isRemote && <SettingRow title="启动本地进程"><Toggle checked={permissions.localProcess !== false} label="允许本地进程" onChange={(localProcess) => updateServer(server.id, { permissions: { ...permissions, localProcess } })} /></SettingRow>}
                  <SettingRow title="网络访问"><Toggle checked={permissions.network !== false} label="允许网络" onChange={(network) => updateServer(server.id, { permissions: { ...permissions, network } })} /></SettingRow>
                  <SettingRow title="账户认证"><Toggle checked={permissions.account !== false} label="允许账户" onChange={(account) => updateServer(server.id, { permissions: { ...permissions, account } })} /></SettingRow>
                  <SettingRow title="文件读取"><Toggle checked={permissions.fileRead !== false} label="允许文件读取" onChange={(fileRead) => updateServer(server.id, { permissions: { ...permissions, fileRead } })} /></SettingRow>
                  <SettingRow title="文件写入"><Toggle checked={permissions.fileWrite === true} label="允许文件写入" onChange={(fileWrite) => updateServer(server.id, { permissions: { ...permissions, fileWrite } })} /></SettingRow>
                  <SettingRow title="外部写入"><Toggle checked={permissions.externalWrite === true} label="允许外部写入" onChange={(externalWrite) => updateServer(server.id, { permissions: { ...permissions, externalWrite } })} /></SettingRow>
                  <SettingRow title="破坏性操作"><Toggle checked={permissions.destructive === true} label="允许破坏性操作" onChange={(destructive) => updateServer(server.id, { permissions: { ...permissions, destructive } })} /></SettingRow>
                </SettingsSection>

                <SettingsSection title="恢复策略">
                  <SettingRow title="自动恢复"><Toggle checked={server.recovery?.enabled !== false} label="自动恢复" onChange={(enabled) => updateServer(server.id, { recovery: { ...(server.recovery ?? {}), enabled } })} /></SettingRow>
                  <SettingRow title="最大尝试"><Slider value={server.recovery?.maxAttempts ?? 3} min={0} max={20} unit=" 次" onChange={(maxAttempts) => updateServer(server.id, { recovery: { ...(server.recovery ?? {}), maxAttempts } })} /></SettingRow>
                  {serverState?.recovery?.attempt > 0 && <div className="mcp-message">第 {serverState.recovery.attempt} 次恢复 · {serverState.recovery.reason}</div>}
                </SettingsSection>

                {developerMode && (
                  <details className="settings-disclosure mcp-advanced-settings">
                    <summary>连接诊断</summary>
                    <div className="mcp-advanced-settings__body">
                      <SettingRow title="Server ID"><code className="mcp-readonly-value">{server.id}</code></SettingRow>
                      <SettingRow title="Manifest Hash"><code className="mcp-readonly-value">{serverState?.manifestHash?.slice(0, 16) || "尚未发现"}</code></SettingRow>
                      <SettingRow title="连接超时"><Slider value={(server.connectTimeoutMs ?? 15000) / 1000} min={2} max={120} unit=" 秒" onChange={(seconds) => updateServer(server.id, { connectTimeoutMs: seconds * 1000 })} /></SettingRow>
                      <SettingRow title="调用超时"><Slider value={(server.callTimeoutMs ?? 60000) / 1000} min={2} max={600} unit=" 秒" onChange={(seconds) => updateServer(server.id, { callTimeoutMs: seconds * 1000 })} /></SettingRow>
                      <h4>Server 日志</h4>
                      <pre className="mcp-log">{(serverState?.logs ?? []).map((item) => `[${item.level}] ${item.text}`).join("\n") || "暂无日志"}</pre>
                    </div>
                  </details>
                )}

                <div className="mcp-danger-zone">
                  <ActionButton tone="danger" onClick={() => runAction(`remove:${server.id}`, async () => {
                    await Promise.allSettled([
                      Promise.resolve(window.api?.disconnectMcpServer?.(server.id)),
                      Promise.resolve(window.api?.clearMcpAuthentication?.(server.id)),
                      ...(server.secretEnvKeys ?? []).map((envName) => Promise.resolve(window.api?.clearMcpSecret?.(server.id, envName)))
                    ]);
                    updateServers(servers.filter((item) => item.id !== server.id));
                    setExpanded("");
                    return { ok: true };
                  })}>删除连接</ActionButton>
                </div>
              </div>
            )}
          </section>
        );
      })}

      {developerMode && (
        <SettingsSection title="MCP Runtime">
          <SettingRow title="健康检查"><Toggle checked={mcp.health?.enabled !== false} label="启用健康检查" onChange={(enabled) => onUpdate({ ...mcp, health: { ...(mcp.health ?? {}), enabled } })} /></SettingRow>
          <SettingRow title="检查间隔"><Slider value={(mcp.health?.intervalMs ?? 30000) / 1000} min={5} max={600} unit=" 秒" onChange={(seconds) => onUpdate({ ...mcp, health: { ...(mcp.health ?? {}), intervalMs: seconds * 1000 } })} /></SettingRow>
          <SettingRow title="检查超时"><Slider value={(mcp.health?.timeoutMs ?? 8000) / 1000} min={1} max={60} unit=" 秒" onChange={(seconds) => onUpdate({ ...mcp, health: { ...(mcp.health ?? {}), timeoutMs: seconds * 1000 } })} /></SettingRow>
          <SettingRow title="失败阈值"><Slider value={mcp.health?.unhealthyThreshold ?? 2} min={1} max={10} unit=" 次" onChange={(unhealthyThreshold) => onUpdate({ ...mcp, health: { ...(mcp.health ?? {}), unhealthyThreshold } })} /></SettingRow>
          <SettingRow title="自动恢复"><Toggle checked={mcp.recovery?.enabled !== false} label="启用自动恢复" onChange={(enabled) => onUpdate({ ...mcp, recovery: { ...(mcp.recovery ?? {}), enabled } })} /></SettingRow>
          <SettingRow title="全局恢复尝试"><Slider value={mcp.recovery?.maxAttempts ?? 3} min={0} max={20} unit=" 次" onChange={(maxAttempts) => onUpdate({ ...mcp, recovery: { ...(mcp.recovery ?? {}), maxAttempts } })} /></SettingRow>
          <SettingRow title="初始恢复延迟"><Slider value={(mcp.recovery?.baseDelayMs ?? 1000) / 1000} min={0.25} max={60} step={0.25} unit=" 秒" onChange={(seconds) => onUpdate({ ...mcp, recovery: { ...(mcp.recovery ?? {}), baseDelayMs: seconds * 1000 } })} /></SettingRow>
          <SettingRow title="最大恢复延迟"><Slider value={(mcp.recovery?.maxDelayMs ?? 15000) / 1000} min={1} max={300} unit=" 秒" onChange={(seconds) => onUpdate({ ...mcp, recovery: { ...(mcp.recovery ?? {}), maxDelayMs: seconds * 1000 } })} /></SettingRow>
          <SettingRow title="每个 Server 工具上限"><Slider value={mcp.maxToolsPerServer ?? 128} min={1} max={512} unit=" 个" onChange={(maxToolsPerServer) => onUpdate({ ...mcp, maxToolsPerServer })} /></SettingRow>
          <SettingRow title="日志级别"><Select value={mcp.logLevel ?? "developer"} options={LOG_LEVEL_OPTIONS} onChange={(logLevel) => onUpdate({ ...mcp, logLevel })} /></SettingRow>
          <SettingRow title="文本结果上限"><Slider value={mcp.resultLimits?.maxTextBytes ?? 51200} min={4096} max={500000} step={4096} unit=" B" onChange={(maxTextBytes) => onUpdate({ ...mcp, resultLimits: { ...(mcp.resultLimits ?? {}), maxTextBytes } })} /></SettingRow>
          <SettingRow title="结构化结果上限"><Slider value={mcp.resultLimits?.maxStructuredBytes ?? 1048576} min={16384} max={10000000} step={16384} unit=" B" onChange={(maxStructuredBytes) => onUpdate({ ...mcp, resultLimits: { ...(mcp.resultLimits ?? {}), maxStructuredBytes } })} /></SettingRow>
          <SettingRow title="JSON 字段上限"><Slider value={mcp.resultLimits?.maxJsonFields ?? 10000} min={100} max={50000} step={100} unit=" 个" onChange={(maxJsonFields) => onUpdate({ ...mcp, resultLimits: { ...(mcp.resultLimits ?? {}), maxJsonFields } })} /></SettingRow>
          <SettingRow title="内容块上限"><Slider value={mcp.resultLimits?.maxContentBlocks ?? 128} min={1} max={512} unit=" 个" onChange={(maxContentBlocks) => onUpdate({ ...mcp, resultLimits: { ...(mcp.resultLimits ?? {}), maxContentBlocks } })} /></SettingRow>
          <SettingRow title="清理 HTML"><Toggle checked={mcp.resultLimits?.stripHtml !== false} label="清理 HTML" onChange={(stripHtml) => onUpdate({ ...mcp, resultLimits: { ...(mcp.resultLimits ?? {}), stripHtml } })} /></SettingRow>
        </SettingsSection>
      )}
    </>
  );
}
