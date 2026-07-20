import {
  useEffect,
  useState
} from "react";

import {
  ActionButton,
  Select,
  SettingRow,
  SettingsSection,
  TextArea,
  TextInput,
  Toggle
} from "../components/Controls.jsx";

const METHOD_OPTIONS = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE"
].map((value) => ({ value, label: value }));

const AUTH_OPTIONS = [
  { value: "none", label: "无需认证" },
  { value: "bearer", label: "Bearer Token" },
  { value: "api-key", label: "API Key" }
];

const LOCATION_OPTIONS = [
  { value: "path", label: "URL 路径" },
  { value: "query", label: "Query" },
  { value: "header", label: "Header" },
  { value: "body", label: "JSON Body" }
];

const TYPE_OPTIONS = [
  { value: "string", label: "文本" },
  { value: "number", label: "数字" },
  { value: "integer", label: "整数" },
  { value: "boolean", label: "布尔" },
  { value: "object", label: "对象" },
  { value: "array", label: "数组" }
];

function uniqueId(tools, base = "http-tool") {
  const used = new Set((tools ?? []).map((tool) => tool.id));
  let id = base;
  let index = 2;
  while (used.has(id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  return id;
}

function newTool(tools) {
  const id = uniqueId(tools);
  return {
    id,
    name: "新 HTTP 工具",
    description: "",
    enabled: false,
    method: "GET",
    url: "https://api.example.com/resource",
    authMode: "none",
    apiKeyHeader: "X-API-Key",
    headers: {},
    parameters: [],
    responsePath: "",
    timeoutMs: 30000,
    maxResponseBytes: 262144,
    allowPrivateNetwork: false,
    allowDestructive: false
  };
}

function newParameter(parameters) {
  const used = new Set((parameters ?? []).map((item) => item.name));
  let name = "parameter";
  let index = 2;
  while (used.has(name)) {
    name = `parameter_${index}`;
    index += 1;
  }
  return {
    name,
    location: "query",
    type: "string",
    required: false,
    description: ""
  };
}

function formatHeaders(headers = {}) {
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");
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

function defaultTestInput(parameters = []) {
  return Object.fromEntries(
    parameters
      .filter((parameter) => parameter.required)
      .map((parameter) => {
        if (parameter.type === "boolean") return [parameter.name, false];
        if (["number", "integer"].includes(parameter.type)) return [parameter.name, 0];
        if (parameter.type === "array") return [parameter.name, []];
        if (parameter.type === "object") return [parameter.name, {}];
        return [parameter.name, ""];
      })
  );
}

function methodBadge(method) {
  return ["GET", "HEAD"].includes(method)
    ? "只读"
    : method === "DELETE"
      ? "高风险写入"
      : "远程写入";
}

function CredentialEditor({ tool, status, setStatuses }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const needsCredential = tool.authMode !== "none";

  useEffect(() => {
    let disposed = false;
    if (!needsCredential) {
      setStatuses((current) => ({ ...current, [tool.id]: null }));
      return () => {};
    }
    window.api?.getCustomToolSecretStatus?.(tool.id)
      .then((next) => {
        if (!disposed) {
          setStatuses((current) => ({ ...current, [tool.id]: next }));
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [needsCredential, setStatuses, tool.id]);

  if (!needsCredential) return null;

  return (
    <div className="custom-tool-credential">
      <div>
        <strong>{tool.authMode === "bearer" ? "Bearer Token" : "API Key"}</strong>
        <span>
          {status?.configured
            ? `已保存${status.protected ? " · 已加密" : ""}`
            : "未配置"}
        </span>
      </div>
      <TextInput
        type="password"
        autoComplete="off"
        value={value}
        placeholder="输入凭据后保存"
        onChange={setValue}
      />
      <div className="custom-tool-inline-actions">
        <ActionButton
          disabled={!value || busy}
          onClick={() => {
            setBusy(true);
            void window.api?.setCustomToolSecret?.(tool.id, value)
              .then((next) => {
                setStatuses((current) => ({ ...current, [tool.id]: next }));
                setValue("");
              })
              .finally(() => setBusy(false));
          }}
        >
          保存
        </ActionButton>
        <ActionButton
          tone="danger"
          disabled={!status?.configured || busy}
          onClick={() => {
            setBusy(true);
            void window.api?.clearCustomToolSecret?.(tool.id)
              .then((next) => {
                setStatuses((current) => ({ ...current, [tool.id]: next }));
              })
              .finally(() => setBusy(false));
          }}
        >
          清除
        </ActionButton>
      </div>
    </div>
  );
}

function ParameterEditor({ parameters, onChange }) {
  const update = (index, patch) => {
    onChange(parameters.map((parameter, current) =>
      current === index ? { ...parameter, ...patch } : parameter
    ));
  };

  return (
    <div className="custom-tool-parameters">
      <header>
        <div>
          <strong>输入参数</strong>
          <span>模型会根据这些定义生成结构化调用。</span>
        </div>
        <ActionButton
          onClick={() => onChange([...parameters, newParameter(parameters)])}
        >
          添加参数
        </ActionButton>
      </header>

      {parameters.length === 0 ? (
        <div className="custom-tool-empty-inline">此工具不需要输入参数。</div>
      ) : parameters.map((parameter, index) => (
        <div className="custom-tool-parameter" key={`${parameter.name}-${index}`}>
          <TextInput
            value={parameter.name}
            placeholder="参数名"
            onChange={(value) => update(index, { name: value })}
          />
          <Select
            value={parameter.location}
            options={LOCATION_OPTIONS}
            onChange={(value) => update(index, { location: value })}
          />
          <Select
            value={parameter.type}
            options={TYPE_OPTIONS}
            onChange={(value) => update(index, { type: value })}
          />
          <label className="custom-tool-required">
            <input
              type="checkbox"
              checked={parameter.required === true}
              onChange={(event) => update(index, { required: event.target.checked })}
            />
            必填
          </label>
          <TextInput
            value={parameter.description ?? ""}
            placeholder="给模型的参数说明"
            onChange={(value) => update(index, { description: value })}
          />
          <ActionButton
            tone="danger"
            onClick={() => onChange(parameters.filter((_, current) => current !== index))}
          >
            删除
          </ActionButton>
        </div>
      ))}
    </div>
  );
}

function TestConsole({ tool }) {
  const [input, setInput] = useState(() => JSON.stringify(defaultTestInput(tool.parameters), null, 2));
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setInput(JSON.stringify(defaultTestInput(tool.parameters), null, 2));
    setResult(null);
    setError("");
  }, [tool.id, tool.parameters]);

  const run = () => {
    let parsed;
    try {
      parsed = JSON.parse(input || "{}");
    } catch (parseError) {
      setError(`测试参数不是有效 JSON：${parseError.message}`);
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    window.api?.testCustomHttpTool?.(tool.id, parsed, tool)
      .then(setResult)
      .catch((requestError) => {
        setError(requestError?.message ?? String(requestError));
      })
      .finally(() => setBusy(false));
  };

  return (
    <details className="custom-tool-test">
      <summary>测试调用</summary>
      <div className="custom-tool-test__body">
        <TextArea
          value={input}
          rows={5}
          placeholder="{}"
          onChange={setInput}
        />
        <div className="custom-tool-inline-actions">
          <ActionButton disabled={busy} onClick={run}>
            {busy ? "正在请求…" : "运行测试"}
          </ActionButton>
        </div>
        {error ? <div className="custom-tool-message is-error">{error}</div> : null}
        {result ? (
          <pre className="custom-tool-result">{JSON.stringify(result, null, 2)}</pre>
        ) : null}
      </div>
    </details>
  );
}

export function CustomToolsPanel({ settings, developerMode = false, onUpdate }) {
  const customTools = settings.customTools ?? {
    enabled: true,
    maxResponseBytes: 262144,
    tools: []
  };
  const tools = customTools.tools ?? [];
  const [expanded, setExpanded] = useState("");
  const [credentialStatuses, setCredentialStatuses] = useState({});

  const enabledCount = tools.filter(
    (tool) => tool.enabled !== false
  ).length;

  const updateTools = (nextTools) => onUpdate({ ...customTools, tools: nextTools });
  const updateTool = (toolId, patch) => {
    updateTools(tools.map((tool) => tool.id === toolId ? { ...tool, ...patch } : tool));
  };

  return (
    <div className="custom-tools-panel">
      <section className="custom-tools-intro">
        <div>
          <strong>把普通 REST API 变成模型工具</strong>
          <p>无需编写 JavaScript 或部署 MCP Server。请求仍经过 Tool Runtime 的权限、超时、熔断、Journal 与恢复机制。</p>
        </div>
        <ActionButton
          testId="custom-tool-add"
          onClick={() => {
            const tool = newTool(tools);
            updateTools([...tools, tool]);
            setExpanded(tool.id);
          }}
        >
          添加 HTTP 工具
        </ActionButton>
      </section>

      <SettingsSection title="自定义工具">
        <SettingRow title="启用自定义工具">
          <Toggle
            checked={customTools.enabled !== false}
            label="启用自定义工具"
            testId="custom-tools-enabled"
            onChange={(enabled) => onUpdate({ ...customTools, enabled })}
          />
        </SettingRow>
      </SettingsSection>

      <div className="custom-tools-overview" data-testid="custom-tools-overview">
        <div><strong>{tools.length}</strong><span>已配置</span></div>
        <div><strong>{enabledCount}</strong><span>已启用</span></div>
        <div><strong>{tools.filter((tool) => ["GET", "HEAD"].includes(tool.method)).length}</strong><span>只读</span></div>
      </div>

      {tools.length === 0 ? (
        <section className="custom-tools-empty">
          <span>↗</span>
          <h3>尚未创建自定义 HTTP 工具</h3>
          <p>适合天气、物流、企业内部 API、Webhook 和简单自动化接口。</p>
        </section>
      ) : tools.map((tool) => {
        const open = expanded === tool.id;
        return (
          <details
            className="custom-tool-card"
            data-testid={`custom-tool-${tool.id}`}
            key={tool.id}
            open={open}
            onToggle={(event) => {
              if (event.currentTarget.open) setExpanded(tool.id);
              else if (expanded === tool.id) setExpanded("");
            }}
          >
            <summary>
              <span className="custom-tool-card__method">{tool.method}</span>
              <span className="custom-tool-card__identity">
                <strong>{tool.name || tool.id}</strong>
                <small>{tool.url || "尚未填写 URL"}</small>
              </span>
              <span className={`custom-tool-card__risk is-${["GET", "HEAD"].includes(tool.method) ? "read" : "write"}`}>
                {methodBadge(tool.method)}
              </span>
              <span className="custom-tool-card__toggle" onClick={(event) => event.stopPropagation()}>
                <Toggle
                  checked={tool.enabled !== false}
                  label={`启用 ${tool.name}`}
                  onChange={(enabled) => updateTool(tool.id, { enabled })}
                />
              </span>
            </summary>

            <div className="custom-tool-card__body">
              <SettingRow title="名称">
                <TextInput
                  value={tool.name}
                  onChange={(name) => updateTool(tool.id, { name })}
                />
              </SettingRow>
              <SettingRow title="说明">
                <TextArea
                  value={tool.description ?? ""}
                  rows={3}
                  placeholder="告诉模型何时以及如何使用这个工具。"
                  onChange={(description) => updateTool(tool.id, { description })}
                />
              </SettingRow>
              <SettingRow title="请求方法">
                <Select
                  value={tool.method}
                  options={METHOD_OPTIONS}
                  onChange={(method) => updateTool(tool.id, { method })}
                />
              </SettingRow>
              <SettingRow title="请求地址">
                <TextInput
                  value={tool.url}
                  testId={`custom-tool-url-${tool.id}`}
                  placeholder="https://api.example.com/items/{id}"
                  onChange={(url) => updateTool(tool.id, { url })}
                />
              </SettingRow>
              <SettingRow title="认证方式">
                <Select
                  value={tool.authMode}
                  options={AUTH_OPTIONS}
                  onChange={(authMode) => updateTool(tool.id, { authMode })}
                />
              </SettingRow>
              {tool.authMode === "api-key" ? (
                <SettingRow title="API Key Header">
                  <TextInput
                    value={tool.apiKeyHeader ?? "X-API-Key"}
                    onChange={(apiKeyHeader) => updateTool(tool.id, { apiKeyHeader })}
                  />
                </SettingRow>
              ) : null}

              <CredentialEditor
                tool={tool}
                status={credentialStatuses[tool.id]}
                setStatuses={setCredentialStatuses}
              />

              <ParameterEditor
                parameters={tool.parameters ?? []}
                onChange={(parameters) => updateTool(tool.id, { parameters })}
              />

              <details className="custom-tool-advanced">
                <summary>响应与高级设置</summary>
                <div>
                  <SettingRow title="固定 Headers">
                    <TextArea
                      value={formatHeaders(tool.headers)}
                      rows={4}
                      placeholder={'Accept-Language: zh-CN\nX-Client: my-ai-ui'}
                      onChange={(value) => updateTool(tool.id, { headers: parseHeaders(value) })}
                    />
                  </SettingRow>
                  <SettingRow title="响应字段路径">
                    <TextInput
                      value={tool.responsePath ?? ""}
                      placeholder="data.items"
                      onChange={(responsePath) => updateTool(tool.id, { responsePath })}
                    />
                  </SettingRow>
                  <SettingRow title="超时（毫秒）">
                    <TextInput
                      type="number"
                      value={String(tool.timeoutMs ?? 30000)}
                      onChange={(value) => updateTool(tool.id, { timeoutMs: Number(value) })}
                    />
                  </SettingRow>
                  <SettingRow title="最大响应字节">
                    <TextInput
                      type="number"
                      value={String(tool.maxResponseBytes ?? customTools.maxResponseBytes ?? 262144)}
                      onChange={(value) => updateTool(tool.id, { maxResponseBytes: Number(value) })}
                    />
                  </SettingRow>
                  {developerMode ? (
                    <>
                      <SettingRow title="允许私有网络">
                        <Toggle
                          checked={tool.allowPrivateNetwork === true}
                          label="允许私有网络"
                          onChange={(allowPrivateNetwork) => updateTool(tool.id, { allowPrivateNetwork })}
                        />
                      </SettingRow>
                      {tool.method === "DELETE" ? (
                        <SettingRow title="允许破坏性 DELETE">
                          <Toggle
                            checked={tool.allowDestructive === true}
                            label="允许破坏性 DELETE"
                            onChange={(allowDestructive) => updateTool(tool.id, { allowDestructive })}
                          />
                        </SettingRow>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </details>

              <TestConsole tool={tool} />

              <div className="custom-tool-danger-zone">
                <div>
                  <strong>删除工具</strong>
                  <span>工具配置会被删除；已保存凭据也会一并清除。</span>
                </div>
                <ActionButton
                  tone="danger"
                  onClick={() => {
                    void window.api?.clearCustomToolSecret?.(tool.id).catch(() => {});
                    updateTools(tools.filter((item) => item.id !== tool.id));
                    if (expanded === tool.id) setExpanded("");
                  }}
                >
                  删除
                </ActionButton>
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}
