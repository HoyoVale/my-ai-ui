import {
  useMemo,
  useState
} from "react";

import {
  ActionButton,
  SettingRow,
  SettingsSection,
  Select,
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

function githubReadOnlyTemplate(servers) {
  return {
    id: uniqueServerId(servers, "github"),
    name: "GitHub",
    enabled: false,
    autoConnect: true,
    transport: "stdio",
    command: "docker",
    args: [
      "run",
      "-i",
      "--rm",
      "-e",
      "GITHUB_PERSONAL_ACCESS_TOKEN",
      "-e",
      "GITHUB_READ_ONLY",
      "-e",
      "GITHUB_TOOLSETS",
      "ghcr.io/github/github-mcp-server"
    ],
    cwd: "",
    env: {
      GITHUB_READ_ONLY: "1",
      GITHUB_TOOLSETS: "repos,issues,pull_requests,actions"
    },
    headers: {},
    secretEnvKeys: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    url: "",
    authMode: "none",
    apiKeyHeader: "X-API-Key",
    oauthScopes: [],
    readOnly: true,
    preset: "github-readonly",
    connectTimeoutMs: 30000,
    callTimeoutMs: 60000
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
    readOnly: false,
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
  if (state === "error") return "连接失败";
  return "未连接";
}

function statusClass(serverState) {
  return `mcp-status mcp-status--${serverState?.state ?? "disconnected"}`;
}

function connectionSubtitle(server) {
  if (server.transport === "streamable-http") {
    return server.url || "尚未填写远程地址";
  }
  if (server.preset === "github-readonly") {
    return "GitHub 官方 MCP · Docker";
  }
  return server.command || "尚未填写启动命令";
}

function credentialLabel(server, envName) {
  if (envName === REMOTE_TOKEN_KEY) {
    return server.authMode === "api-key" ? "API Key" : "Access Token";
  }
  if (envName === "GITHUB_PERSONAL_ACCESS_TOKEN") return "GitHub Token";
  return envName;
}

function waitForSettingsCommit() {
  return new Promise((resolve) => setTimeout(resolve, 180));
}

function CredentialEditor({ server, state, run, action }) {
  const [values, setValues] = useState({});
  const statuses = new Map(
    (state?.credentialStatuses ?? []).map((item) => [item.envName, item])
  );

  if ((server.secretEnvKeys ?? []).length === 0) return null;

  return (
    <div className="mcp-credential-list">
      <h4>认证信息</h4>
      {server.secretEnvKeys.map((envName) => {
        const credential = statuses.get(envName);
        const key = `secret:${server.id}:${envName}`;
        return (
          <div className="mcp-credential" key={envName}>
            <div className="mcp-credential__name">
              <strong>{credentialLabel(server, envName)}</strong>
              <span>{credential?.configured ? `已保存${credential.protected ? " · 已加密" : ""}` : "未配置"}</span>
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
                disabled={!values[envName] || action === key}
                onClick={() => {
                  void run(key, async () => {
                    await window.api?.setMcpSecret?.(server.id, envName, values[envName]);
                    setValues((current) => ({ ...current, [envName]: "" }));
                    return { state: await window.api?.getMcpState?.() };
                  });
                }}
              >
                保存
              </ActionButton>
              <ActionButton
                tone="danger"
                disabled={!credential?.configured || action === key}
                onClick={() => {
                  void run(key, async () => {
                    await window.api?.clearMcpSecret?.(server.id, envName);
                    return { state: await window.api?.getMcpState?.() };
                  });
                }}
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

function AddConnectionSheet({ servers, onAdd, onClose }) {
  return (
    <section className="mcp-add-sheet" data-testid="mcp-add-sheet">
      <header>
        <div>
          <h3>添加 MCP 连接</h3>
          <p>远程连接最简单；本地连接适合需要访问本机资源的 MCP Server。</p>
        </div>
        <ActionButton onClick={onClose}>取消</ActionButton>
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
          <small>输入服务地址，可使用 OAuth、Token 或 API Key。</small>
          <em>推荐</em>
        </button>

        <button
          type="button"
          className="mcp-connection-option"
          onClick={() => onAdd(localTemplate(servers))}
        >
          <span className="mcp-connection-option__icon">⌘</span>
          <strong>本地 MCP</strong>
          <small>通过 stdio 启动本地命令，适合桌面扩展与开发工具。</small>
        </button>

        <button
          type="button"
          data-testid="mcp-add-github"
          className="mcp-connection-option"
          onClick={() => onAdd(githubReadOnlyTemplate(servers))}
        >
          <span className="mcp-connection-option__icon">GH</span>
          <strong>GitHub（只读）</strong>
          <small>使用官方 GitHub MCP Server，仅开放仓库、Issue、PR 与 Actions 读取。</small>
        </button>
      </div>
    </section>
  );
}

export function McpPanel({ settings, developerMode = false, onUpdate }) {
  const mcp = settings.mcp ?? {
    enabled: true,
    autoConnect: true,
    connectTimeoutMs: 15000,
    callTimeoutMs: 60000,
    maxToolsPerServer: 128,
    servers: []
  };
  const servers = mcp.servers ?? [];
  const { state, status, action, error, run, clearError } = useMcpState();
  const [expanded, setExpanded] = useState("");
  const [showAdd, setShowAdd] = useState(false);

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

  const connect = (serverId, force = false) => {
    clearError();
    void run(`connect:${serverId}`, async () => {
      await waitForSettingsCommit();
      return window.api?.connectMcpServer?.(serverId, { force });
    });
  };

  const removeServer = (server) => {
    clearError();
    void run(`remove:${server.id}`, async () => {
      await Promise.allSettled([
        Promise.resolve(window.api?.disconnectMcpServer?.(server.id)),
        Promise.resolve(window.api?.clearMcpAuthentication?.(server.id)),
        ...(server.secretEnvKeys ?? []).map((envName) =>
          Promise.resolve(window.api?.clearMcpSecret?.(server.id, envName))
        )
      ]);
      updateServers(servers.filter((item) => item.id !== server.id));
      if (expanded === server.id) setExpanded("");
    });
  };

  return (
    <>
      <SettingsSection title="MCP 连接">
        <div className="mcp-page-intro">
          <div>
            <strong>让 AI 使用外部工具和数据</strong>
            <p>MCP 连接与模型相互独立。连接后，可在 Tools 页面控制每个工具是否对模型开放。</p>
          </div>
          <ActionButton testId="mcp-add-connection" onClick={() => setShowAdd((value) => !value)}>
            {showAdd ? "收起" : "添加连接"}
          </ActionButton>
        </div>

        <SettingRow title="启用 MCP">
          <Toggle
            checked={mcp.enabled !== false}
            label="启用 MCP"
            onChange={(enabled) => onUpdate({ ...mcp, enabled })}
          />
        </SettingRow>
        <SettingRow title="自动连接">
          <Toggle
            checked={mcp.autoConnect !== false}
            label="应用启动后自动连接已启用的 MCP Server"
            onChange={(autoConnect) => onUpdate({ ...mcp, autoConnect })}
          />
        </SettingRow>

        <div className="mcp-overview" data-testid="mcp-overview">
          <div><strong>{state.connectedCount ?? 0}</strong><span>已连接</span></div>
          <div><strong>{state.serverCount ?? servers.length}</strong><span>连接</span></div>
          <div><strong>{state.toolCount ?? 0}</strong><span>可发现工具</span></div>
        </div>

        {status === "loading" && <div className="mcp-message">正在读取 MCP 状态…</div>}
        {error && <div className="mcp-message mcp-message--error">{error}</div>}
      </SettingsSection>

      {showAdd && (
        <AddConnectionSheet
          servers={servers}
          onAdd={addServer}
          onClose={() => setShowAdd(false)}
        />
      )}

      {servers.length === 0 && !showAdd && (
        <section className="mcp-empty-state">
          <div className="mcp-empty-state__icon">M</div>
          <h3>还没有 MCP 连接</h3>
          <p>添加远程服务、本地扩展或 GitHub 连接，为 AI 增加新的能力。</p>
          <ActionButton onClick={() => setShowAdd(true)}>添加第一个连接</ActionButton>
        </section>
      )}

      {servers.map((server) => {
        const serverState = stateById.get(server.id);
        const isExpanded = expanded === server.id;
        const busy = action.endsWith(`:${server.id}`) || action.startsWith(`secret:${server.id}:`);
        const isRemote = server.transport === "streamable-http";
        const isConnected = serverState?.state === "connected";
        const authentication = serverState?.authentication;

        return (
          <section className="mcp-server-card" key={server.id} data-testid={`mcp-server-${server.id}`}>
            <header className="mcp-server-card__header">
              <div className="mcp-server-card__identity">
                <span className="mcp-server-card__logo">{server.preset === "github-readonly" ? "GH" : isRemote ? "↗" : "⌘"}</span>
                <button
                  type="button"
                  className="mcp-server-card__toggle"
                  onClick={() => setExpanded(isExpanded ? "" : server.id)}
                >
                  <span className="mcp-server-card__title">{server.name}</span>
                  <small>{connectionSubtitle(server)}</small>
                </button>
              </div>
              <span className={statusClass(serverState)}>{statusCopy(serverState)}</span>
              <Toggle
                checked={server.enabled === true}
                label={`启用 ${server.name}`}
                onChange={(enabled) => updateServer(server.id, { enabled })}
              />
            </header>

            <div className="mcp-server-card__summary">
              <span>{isRemote ? "远程" : "本地"}</span>
              <span>{server.readOnly ? "只读" : "可执行操作"}</span>
              <span>{serverState?.toolCount ?? 0} 个工具</span>
              {isRemote && server.authMode !== "none" && (
                <span>{authentication?.signedIn ? "认证已配置" : server.authMode === "oauth" ? "尚未登录" : "缺少凭据"}</span>
              )}
            </div>

            <div className="mcp-server-card__actions">
              <ActionButton
                disabled={!server.enabled || busy || (isRemote ? !server.url : !server.command)}
                onClick={() => connect(server.id, isConnected)}
              >
                {serverState?.state === "authorizing" ? "等待登录" : isConnected ? "重新连接" : server.authMode === "oauth" && !authentication?.signedIn ? "登录并连接" : "连接"}
              </ActionButton>
              {isConnected && (
                <ActionButton disabled={busy} onClick={() => void run(`refresh:${server.id}`, () => window.api?.refreshMcpServer?.(server.id))}>
                  刷新工具
                </ActionButton>
              )}
              <ActionButton onClick={() => setExpanded(isExpanded ? "" : server.id)}>
                {isExpanded ? "收起" : "管理"}
              </ActionButton>
              {isConnected && (
                <ActionButton disabled={busy} onClick={() => void run(`disconnect:${server.id}`, () => window.api?.disconnectMcpServer?.(server.id))}>
                  断开
                </ActionButton>
              )}
            </div>

            {serverState?.error && <div className="mcp-message mcp-message--error">{serverState.error}</div>}

            {isExpanded && (
              <div className="mcp-server-card__body">
                <SettingRow title="名称">
                  <TextInput value={server.name} onChange={(name) => updateServer(server.id, { name })} />
                </SettingRow>

                {isRemote ? (
                  <>
                    <SettingRow title="MCP Server 地址">
                      <TextInput
                        testId={`mcp-url-${server.id}`}
                        value={server.url ?? ""}
                        placeholder="https://example.com/mcp"
                        onChange={(url) => updateServer(server.id, { url })}
                      />
                    </SettingRow>
                    <SettingRow title="认证方式">
                      <Select
                        value={server.authMode ?? "none"}
                        options={AUTH_OPTIONS}
                        onChange={(authMode) => updateServer(server.id, {
                          authMode,
                          secretEnvKeys: ["bearer", "api-key"].includes(authMode) ? [REMOTE_TOKEN_KEY] : []
                        })}
                      />
                    </SettingRow>
                    {server.authMode === "api-key" && (
                      <SettingRow title="API Key Header">
                        <TextInput
                          value={server.apiKeyHeader ?? "X-API-Key"}
                          placeholder="X-API-Key"
                          onChange={(apiKeyHeader) => updateServer(server.id, { apiKeyHeader })}
                        />
                      </SettingRow>
                    )}
                    {server.authMode === "oauth" && (
                      <div className="mcp-auth-card">
                        <div>
                          <strong>{authentication?.signedIn ? "OAuth 已登录" : "使用浏览器登录"}</strong>
                          <p>连接时会打开浏览器完成授权，令牌会保存在本机安全存储中。</p>
                        </div>
                        {authentication?.signedIn && (
                          <ActionButton
                            tone="danger"
                            onClick={() => void run(`auth:${server.id}`, () => window.api?.clearMcpAuthentication?.(server.id))}
                          >
                            退出登录
                          </ActionButton>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <SettingRow title="启动命令">
                      <TextInput
                        value={server.command}
                        placeholder="npx、node、docker 或可执行文件路径"
                        onChange={(command) => updateServer(server.id, { command })}
                      />
                    </SettingRow>
                    <SettingRow title="参数">
                      <TextArea
                        value={(server.args ?? []).join("\n")}
                        rows={7}
                        placeholder="每行一个参数，不经过 Shell 解析"
                        onChange={(value) => updateServer(server.id, {
                          args: value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean)
                        })}
                      />
                    </SettingRow>
                  </>
                )}

                <SettingRow title="访问级别">
                  <Toggle
                    checked={server.readOnly === true}
                    label="将该 Server 提供的工具视为只读"
                    onChange={(readOnly) => updateServer(server.id, { readOnly })}
                  />
                </SettingRow>
                <SettingRow title="自动连接">
                  <Toggle
                    checked={server.autoConnect !== false}
                    label="自动连接该 MCP Server"
                    onChange={(autoConnect) => updateServer(server.id, { autoConnect })}
                  />
                </SettingRow>

                <CredentialEditor server={server} state={serverState} run={run} action={action} />

                {(serverState?.tools ?? []).length > 0 && (
                  <div className="mcp-tool-list">
                    <h4>已发现工具</h4>
                    {serverState.tools.slice(0, 24).map((tool) => (
                      <div className="mcp-tool-list__item" key={tool.name}>
                        <div><strong>{tool.title || tool.name}</strong><code>{tool.name}</code></div>
                        {tool.description && <p>{tool.description}</p>}
                      </div>
                    ))}
                    {serverState.tools.length > 24 && (
                      <div className="mcp-message">另有 {serverState.tools.length - 24} 个工具，可在 Tools 页面统一查看和开关。</div>
                    )}
                  </div>
                )}

                {developerMode && (
                  <details className="settings-disclosure mcp-advanced-settings">
                    <summary>高级设置</summary>
                    <div className="mcp-advanced-settings__body">
                      <SettingRow title="连接 ID">
                        <code className="mcp-readonly-value">{server.id}</code>
                      </SettingRow>
                      {!isRemote && (
                        <>
                          <SettingRow title="工作目录">
                            <TextInput value={server.cwd ?? ""} placeholder="可选，必须为绝对路径" onChange={(cwd) => updateServer(server.id, { cwd })} />
                          </SettingRow>
                          <SettingRow title="普通环境变量">
                            <TextArea value={formatEnvironment(server.env)} rows={5} placeholder="KEY=value，每行一个" onChange={(value) => updateServer(server.id, { env: parseEnvironment(value) })} />
                          </SettingRow>
                          <SettingRow title="凭据变量名">
                            <TextArea value={(server.secretEnvKeys ?? []).join("\n")} rows={3} placeholder="例如 API_TOKEN" onChange={(value) => updateServer(server.id, { secretEnvKeys: parseSecretKeys(value) })} />
                          </SettingRow>
                        </>
                      )}
                      {isRemote && (
                        <>
                          {server.authMode === "oauth" && (
                            <SettingRow title="OAuth Scopes">
                              <TextInput value={(server.oauthScopes ?? []).join(" ")} placeholder="可选，以空格分隔" onChange={(value) => updateServer(server.id, { oauthScopes: value.split(/[\s,]+/u).filter(Boolean) })} />
                            </SettingRow>
                          )}
                          <SettingRow title="附加 Header">
                            <TextArea value={formatHeaders(server.headers)} rows={4} placeholder="X-Client-Version: 1.0\n敏感值请使用认证设置" onChange={(value) => updateServer(server.id, { headers: parseHeaders(value) })} />
                          </SettingRow>
                        </>
                      )}
                      <SettingRow title="连接超时">
                        <TextInput type="number" value={String(server.connectTimeoutMs ?? 15000)} onChange={(value) => updateServer(server.id, { connectTimeoutMs: Number(value) || 15000 })} />
                      </SettingRow>
                      <SettingRow title="调用超时">
                        <TextInput type="number" value={String(server.callTimeoutMs ?? 60000)} onChange={(value) => updateServer(server.id, { callTimeoutMs: Number(value) || 60000 })} />
                      </SettingRow>
                    </div>
                  </details>
                )}

                {developerMode && (serverState?.logs ?? []).length > 0 && (
                  <details className="settings-disclosure">
                    <summary>Server 日志</summary>
                    <pre className="mcp-log">{serverState.logs.map((item) => item.text).join("\n")}</pre>
                  </details>
                )}

                <div className="mcp-danger-zone">
                  <ActionButton
                    tone="danger"
                    disabled={action === `remove:${server.id}`}
                    onClick={() => removeServer(server)}
                  >
                    {action === `remove:${server.id}` ? "正在删除…" : "删除连接"}
                  </ActionButton>
                </div>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
