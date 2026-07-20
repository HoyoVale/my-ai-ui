import {
  useMemo,
  useState
} from "react";

import {
  ActionButton,
  SettingRow,
  SettingsSection,
  TextArea,
  TextInput,
  Toggle
} from "../components/Controls.jsx";

import {
  useMcpState
} from "../hooks/useMcpState.js";

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
    secretEnvKeys: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    readOnly: true,
    preset: "github-readonly",
    connectTimeoutMs: 30000,
    callTimeoutMs: 60000
  };
}

function customTemplate(servers) {
  const id = uniqueServerId(servers, "custom-mcp");
  return {
    id,
    name: "Custom MCP",
    enabled: false,
    autoConnect: true,
    transport: "stdio",
    command: "",
    args: [],
    cwd: "",
    env: {},
    secretEnvKeys: [],
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
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = trimmed.slice(0, separator).trim().toUpperCase();
    const value = trimmed.slice(separator + 1);
    if (/^[A-Z_][A-Z0-9_]{0,63}$/u.test(name)) {
      output[name] = value;
    }
  }
  return output;
}

function formatEnvironment(env = {}) {
  return Object.entries(env)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");
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
  if (state === "error") return "连接失败";
  return "未连接";
}

function statusClass(serverState) {
  const state = serverState?.state ?? "disconnected";
  return `mcp-status mcp-status--${state}`;
}

function waitForSettingsCommit() {
  return new Promise((resolve) => setTimeout(resolve, 180));
}

function CredentialEditor({ server, state, run, action }) {
  const [values, setValues] = useState({});
  const statuses = new Map(
    (state?.credentialStatuses ?? []).map((item) => [item.envName, item])
  );

  if ((server.secretEnvKeys ?? []).length === 0) {
    return null;
  }

  return (
    <div className="mcp-credential-list">
      <h4>凭据</h4>
      {server.secretEnvKeys.map((envName) => {
        const credential = statuses.get(envName);
        const key = `secret:${server.id}:${envName}`;
        return (
          <div className="mcp-credential" key={envName}>
            <div className="mcp-credential__name">
              <code>{envName}</code>
              <span>{credential?.configured ? `已配置 · ${credential.source === "saved" ? "本地保存" : "环境变量"}` : "未配置"}</span>
            </div>
            <TextInput
              type="password"
              autoComplete="off"
              value={values[envName] ?? ""}
              placeholder="输入后保存"
              onChange={(value) => {
                setValues((current) => ({ ...current, [envName]: value }));
              }}
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

export function McpPanel({ settings, onUpdate }) {
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

  const stateById = useMemo(
    () => new Map((state.servers ?? []).map((server) => [server.id, server])),
    [state.servers]
  );

  const updateServers = (nextServers) => onUpdate({ ...mcp, servers: nextServers });
  const updateServer = (serverId, patch) => {
    updateServers(servers.map((server) =>
      server.id === serverId ? { ...server, ...patch } : server
    ));
  };

  const connect = (serverId, force = false) => {
    clearError();
    void run(`connect:${serverId}`, async () => {
      await waitForSettingsCommit();
      return window.api?.connectMcpServer?.(serverId, { force });
    });
  };

  return (
    <>
      <SettingsSection title="MCP">
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
            label="应用启动后自动连接启用的 MCP Server"
            onChange={(autoConnect) => onUpdate({ ...mcp, autoConnect })}
          />
        </SettingRow>

        <div className="mcp-overview" data-testid="mcp-overview">
          <div><strong>{state.connectedCount ?? 0}</strong><span>已连接</span></div>
          <div><strong>{state.serverCount ?? servers.length}</strong><span>Server</span></div>
          <div><strong>{state.toolCount ?? 0}</strong><span>工具</span></div>
        </div>

        <div className="mcp-add-actions">
          <ActionButton
            testId="mcp-add-github"
            onClick={() => {
              const server = githubReadOnlyTemplate(servers);
              updateServers([...servers, server]);
              setExpanded(server.id);
            }}
          >
            添加 GitHub（只读）
          </ActionButton>
          <ActionButton
            onClick={() => {
              const server = customTemplate(servers);
              updateServers([...servers, server]);
              setExpanded(server.id);
            }}
          >
            添加自定义 stdio Server
          </ActionButton>
        </div>

        {status === "loading" && <div className="mcp-message">正在读取 MCP 状态…</div>}
        {error && <div className="mcp-message mcp-message--error">{error}</div>}
      </SettingsSection>

      {servers.map((server) => {
        const serverState = stateById.get(server.id);
        const isExpanded = expanded === server.id;
        const busy = action.endsWith(`:${server.id}`) || action.startsWith(`secret:${server.id}:`);
        return (
          <section className="mcp-server-card" key={server.id} data-testid={`mcp-server-${server.id}`}>
            <header className="mcp-server-card__header">
              <button
                type="button"
                className="mcp-server-card__toggle"
                onClick={() => setExpanded(isExpanded ? "" : server.id)}
              >
                <span className="mcp-server-card__title">{server.name}</span>
                <code>{server.id}</code>
              </button>
              <span className={statusClass(serverState)}>{statusCopy(serverState)}</span>
              <Toggle
                checked={server.enabled === true}
                label={`启用 ${server.name}`}
                onChange={(enabled) => updateServer(server.id, { enabled })}
              />
            </header>

            <div className="mcp-server-card__summary">
              <span>{server.readOnly ? "只读" : "可能产生外部副作用"}</span>
              <span>{serverState?.toolCount ?? 0} 个工具</span>
              {serverState?.serverInfo?.name && <span>{serverState.serverInfo.name}</span>}
            </div>

            <div className="mcp-inline-actions">
              <ActionButton
                disabled={!server.enabled || busy || !server.command}
                onClick={() => connect(
                  server.id,
                  serverState?.state === "connected"
                )}
              >
                {serverState?.state === "connected" ? "重新连接" : "连接"}
              </ActionButton>
              <ActionButton
                disabled={serverState?.state !== "connected" || busy}
                onClick={() => {
                  void run(`ping:${server.id}`, () => window.api?.pingMcpServer?.(server.id));
                }}
              >
                测试
              </ActionButton>
              <ActionButton
                disabled={serverState?.state !== "connected" || busy}
                onClick={() => {
                  void run(`refresh:${server.id}`, () => window.api?.refreshMcpServer?.(server.id));
                }}
              >
                刷新工具
              </ActionButton>
              <ActionButton
                disabled={serverState?.state === "disconnected" || busy}
                onClick={() => {
                  void run(`disconnect:${server.id}`, () => window.api?.disconnectMcpServer?.(server.id));
                }}
              >
                断开
              </ActionButton>
            </div>

            {serverState?.error && (
              <div className="mcp-message mcp-message--error">{serverState.error}</div>
            )}

            {isExpanded && (
              <div className="mcp-server-card__body">
                <SettingRow title="名称">
                  <TextInput
                    value={server.name}
                    onChange={(name) => updateServer(server.id, { name })}
                  />
                </SettingRow>
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
                    rows={8}
                    placeholder="每行一个参数，不经过 Shell 解析"
                    onChange={(value) => updateServer(server.id, {
                      args: value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean)
                    })}
                  />
                </SettingRow>
                <SettingRow title="工作目录">
                  <TextInput
                    value={server.cwd ?? ""}
                    placeholder="可选，必须为绝对路径"
                    onChange={(cwd) => updateServer(server.id, { cwd })}
                  />
                </SettingRow>
                <SettingRow title="只读信任">
                  <Toggle
                    checked={server.readOnly === true}
                    label="将该 Server 提供的工具视为只读"
                    onChange={(readOnly) => updateServer(server.id, { readOnly })}
                  />
                </SettingRow>
                <SettingRow title="Server 自动连接">
                  <Toggle
                    checked={server.autoConnect !== false}
                    label="自动连接该 MCP Server"
                    onChange={(autoConnect) => updateServer(server.id, { autoConnect })}
                  />
                </SettingRow>
                <SettingRow title="普通环境变量">
                  <TextArea
                    value={formatEnvironment(server.env)}
                    rows={5}
                    placeholder="KEY=value，每行一个；敏感值请放到凭据中"
                    onChange={(value) => updateServer(server.id, { env: parseEnvironment(value) })}
                  />
                </SettingRow>
                <SettingRow title="凭据变量名">
                  <TextArea
                    value={(server.secretEnvKeys ?? []).join("\n")}
                    rows={3}
                    placeholder="例如 GITHUB_PERSONAL_ACCESS_TOKEN"
                    onChange={(value) => updateServer(server.id, { secretEnvKeys: parseSecretKeys(value) })}
                  />
                </SettingRow>

                <CredentialEditor
                  server={server}
                  state={serverState}
                  run={run}
                  action={action}
                />

                {(serverState?.tools ?? []).length > 0 && (
                  <div className="mcp-tool-list">
                    <h4>已发现工具</h4>
                    {serverState.tools.slice(0, 40).map((tool) => (
                      <div className="mcp-tool-list__item" key={tool.name}>
                        <div><strong>{tool.title || tool.name}</strong><code>{tool.name}</code></div>
                        {tool.description && <p>{tool.description}</p>}
                      </div>
                    ))}
                    {serverState.tools.length > 40 && (
                      <div className="mcp-message">另有 {serverState.tools.length - 40} 个工具，可在 Tools 页面统一查看和开关。</div>
                    )}
                  </div>
                )}

                {(serverState?.logs ?? []).length > 0 && (
                  <details className="settings-disclosure">
                    <summary>Server 日志</summary>
                    <pre className="mcp-log">{serverState.logs.map((item) => item.text).join("\n")}</pre>
                  </details>
                )}

                <div className="mcp-danger-zone">
                  <ActionButton
                    tone="danger"
                    onClick={() => {
                      void Promise.resolve(
                        window.api?.disconnectMcpServer?.(server.id)
                      ).finally(() => {
                        updateServers(servers.filter((item) => item.id !== server.id));
                      });
                    }}
                  >
                    删除 Server
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
