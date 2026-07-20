import {
  useCallback,
  useEffect,
  useState
} from "react";

import {
  SettingRow,
  SettingsSection,
  Slider,
  Toggle,
  Select
} from "../components/Controls.jsx";

import {
  TOOL_OVERRIDE_OPTIONS
} from "../tools/toolPanelOptions.js";

import {
  useToolManifest
} from "../hooks/useToolManifest.js";

import {
  CustomToolsPanel
} from "./CustomToolsPanel.jsx";

function formatBytes(value) {
  if (value >= 1_000_000) {
    return `${Math.round(value / 100_000) / 10} MB`;
  }
  return `${Math.round(value / 1_000)} KB`;
}

function formatJson(value) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function riskLabel(tool) {
  const labels = {
    none: "无风险",
    low: "低风险",
    medium: "中风险",
    high: "高风险"
  };
  return labels[tool.riskLevel] ?? tool.riskLevel ?? "未知";
}

function effectLabel(tool) {
  const labels = {
    none: "无副作用",
    read: "读取",
    write: "本地写入",
    external: "外部操作",
    local_write: "本地写入",
    remote_write: "远程写入",
    destructive: "破坏性操作"
  };
  return labels[tool.runtimeContract?.effect] ??
    labels[tool.sideEffect] ??
    tool.sideEffect ??
    "未知";
}

function effectiveLabel(item) {
  if (item.ready) return "已启用";
  if (item.effectiveEnabled && !item.available) return "暂不可用";
  return "已禁用";
}

function ToolSchema({ title, schema }) {
  return (
    <details className="tool-manifest-schema">
      <summary>{title}</summary>
      <pre>{formatJson(schema)}</pre>
    </details>
  );
}

function ManifestToolCard({
  tool,
  developerMode,
  expanded = false,
  onExpandedChange,
  onOverride,
  onMcpPermission
}) {
  return (
    <details
      className={`tool-manifest-card${tool.ready ? " is-enabled" : ""}`}
      data-testid={`tool-manifest-${tool.name}`}
      open={expanded}
      onToggle={(event) => {
        onExpandedChange?.(event.currentTarget.open);
      }}
    >
      <summary>
        <span className="tool-manifest-card__summary-copy">
          <strong>{tool.displayTitle}</strong>
          <small>{tool.name}</small>
        </span>
        <span className={`tool-manifest-state is-${tool.ready ? "enabled" : "disabled"}`}>
          {effectiveLabel(tool)}
        </span>
      </summary>

      <div className="tool-manifest-card__body">
        <p>{tool.displayDescription}</p>

        <div className="tool-manifest-badges">
          <span>{tool.source}</span>
          <span>v{tool.version}</span>
          <span>{riskLabel(tool)}</span>
          <span>{effectLabel(tool)}</span>
          <span>{tool.runtimeContract?.retryMode ?? "safe"}</span>
        </div>

        {!tool.available && tool.availabilityReason && (
          <div className="tool-manifest-notice">
            {tool.availabilityReason}
          </div>
        )}

        {developerMode && (
          <SettingRow title="工具开关">
            <Select
              testId={`tool-override-${tool.name}`}
              value={tool.override ?? "inherit"}
              options={TOOL_OVERRIDE_OPTIONS}
              onChange={onOverride}
            />
          </SettingRow>
        )}

        {tool.sourceKind === "mcp" && (
          <SettingRow title="MCP 调用权限">
            <Select
              testId={`mcp-tool-permission-${tool.name}`}
              value={tool.mcp?.permission?.rule ?? "inherit"}
              options={[
                { value: "inherit", label: "跟随连接权限" },
                { value: "allow", label: "允许（仍受连接权限）" },
                { value: "deny", label: "显式拒绝" }
              ]}
              onChange={onMcpPermission}
            />
          </SettingRow>
        )}

        <div className="tool-manifest-facts">
          <div><span>Tool ID</span><code>{tool.id}</code></div>
          <div><span>Toolset</span><code>{tool.toolsetId}</code></div>
          <div><span>超时</span><strong>{tool.timeoutMs ? `${Math.round(tool.timeoutMs / 1000)} 秒` : "Runtime 默认"}</strong></div>
          <div><span>重试</span><strong>{tool.retryPolicy?.maxAttempts ?? 1} 次尝试</strong></div>
          <div><span>支持取消</span><strong>{tool.runtimeContract?.supportsAbort ? "是" : "否"}</strong></div>
          <div><span>支持恢复</span><strong>{tool.runtimeContract?.supportsResume ? "是" : "否"}</strong></div>
        </div>

        <div className="tool-manifest-readonly">
          内置工具的实现、原始描述和 Schema 由应用版本管理，只读不可编辑。
        </div>

        <ToolSchema title="Input Schema" schema={tool.inputSchema} />
        <ToolSchema title="Output Schema" schema={tool.outputSchema} />
      </div>
    </details>
  );
}

function ManifestToolset({
  toolset,
  developerMode,
  expandedTools,
  onToolExpandedChange,
  onToolsetOverride,
  onToolOverride,
  onMcpPermission
}) {
  return (
    <details
      className="tool-manifest-toolset"
      open={toolset.userVisible !== false}
      data-testid={`toolset-manifest-${toolset.id}`}
    >
      <summary>
        <span>
          <strong>{toolset.title}</strong>
          <small>{toolset.description}</small>
        </span>
        <span className="tool-manifest-toolset__count">
          {toolset.enabledToolCount}/{toolset.toolCount}
        </span>
      </summary>

      <div className="tool-manifest-toolset__body">
        {developerMode && (
          <SettingRow title="Toolset 开关">
            <Select
              testId={`toolset-override-${toolset.id}`}
              value={toolset.override ?? "inherit"}
              options={TOOL_OVERRIDE_OPTIONS}
              onChange={onToolsetOverride}
            />
          </SettingRow>
        )}

        {toolset.tools.map((tool) => (
          <ManifestToolCard
            key={tool.id}
            tool={tool}
            developerMode={developerMode}
            expanded={Boolean(expandedTools[tool.id])}
            onExpandedChange={(expanded) => {
              onToolExpandedChange(tool.id, expanded);
            }}
            onOverride={(value) => onToolOverride(tool.name, value)}
            onMcpPermission={(value) => onMcpPermission(tool, value)}
          />
        ))}
      </div>
    </details>
  );
}

export function ToolPanel({
  settings,
  appSettings = null,
  customToolSettings = null,
  developerMode = false,
  onUpdate,
  onUpdateMcp,
  onUpdateCustomTools
}) {
  const {
    manifest,
    status: manifestStatus,
    error: manifestError
  } = useToolManifest(appSettings ?? { tools: settings });

  const [expandedTools, setExpandedTools] =
    useState({});

  const updateExpandedTool = useCallback(
    (toolId, expanded) => {
      setExpandedTools((current) => {
        if (Boolean(current[toolId]) === expanded) {
          return current;
        }

        if (expanded) {
          return {
            ...current,
            [toolId]: true
          };
        }

        const next = {
          ...current
        };
        delete next[toolId];
        return next;
      });
    },
    []
  );

  const updateRuntime = (patch) => {
    onUpdate({
      runtime: {
        ...settings.runtime,
        ...patch
      }
    });
  };

  const updateCircuitBreaker = (scope, patch) => {
    updateRuntime({
      circuitBreakers: {
        ...(settings.runtime.circuitBreakers ?? {}),
        [scope]: {
          ...(settings.runtime.circuitBreakers?.[scope] ?? {}),
          ...patch
        }
      }
    });
  };

  const updateWorkspace = (patch) => {
    onUpdate({
      workspace: {
        ...settings.workspace,
        ...patch
      }
    });
  };

  const updateApprovalSecurity = (patch) => {
    onUpdate({
      security: {
        ...(settings.security ?? {}),
        approval: {
          ...(settings.security?.approval ?? {}),
          ...patch
        }
      }
    });
  };

  const updateUntrustedSecurity = (patch) => {
    onUpdate({
      security: {
        ...(settings.security ?? {}),
        untrustedContent: {
          ...(settings.security?.untrustedContent ?? {}),
          ...patch
        }
      }
    });
  };

  const updateDeveloper = (patch) => {
    onUpdate({
      developer: {
        ...settings.developer,
        ...patch
      }
    });
  };

  const updateToolsetOverride = (toolsetId, value) => {
    updateDeveloper({
      toolsetOverrides: {
        ...settings.developer?.toolsetOverrides,
        [toolsetId]: value
      }
    });
  };

  const updateToolOverride = (toolName, value) => {
    updateDeveloper({
      toolOverrides: {
        ...settings.developer?.toolOverrides,
        [toolName]: value
      }
    });
  };


  const updateMcpToolPermission = (tool, value) => {
    const mcp = appSettings?.mcp;
    const serverId = tool.mcp?.serverId;
    const remoteName = tool.mcp?.remoteName;
    if (!mcp || !serverId || !remoteName || !onUpdateMcp) return;
    onUpdateMcp({
      ...mcp,
      servers: (mcp.servers ?? []).map((server) => {
        if (server.id !== serverId) return server;
        return {
          ...server,
          permissions: {
            ...(server.permissions ?? {}),
            tools: {
              ...(server.permissions?.tools ?? {}),
              [remoteName]: value
            }
          }
        };
      })
    });
  };

  const visibleToolsets = (manifest?.toolsets ?? []).filter(
    (toolset) => developerMode || toolset.userVisible !== false
  );

  return (
    <>
      <SettingsSection title="工具">
        <SettingRow title="启用工具">
          <Toggle
            checked={settings.enabled !== false}
            label="启用工具"
            onChange={(enabled) => onUpdate({ enabled })}
          />
        </SettingRow>

        <div className="tool-manifest-overview">
          <span>当前模式</span>
          <strong>{manifest?.mode === "coding" ? "Coding" : "Chat"}</strong>
          <span>当前会话</span>
          <strong>{manifest?.executionContext?.conversationTitle ?? "加载中"}</strong>
          <span>Manifest</span>
          <code>{manifest?.revision ?? "加载中"}</code>
          <span>模型可见</span>
          <strong>{manifest?.tools?.filter((tool) => tool.ready).length ?? 0} 个工具</strong>
        </div>
      </SettingsSection>

      <SettingsSection title="操作确认">
        <SettingRow title="本地文件写入">
          <Toggle
            checked={settings.security?.approval?.localWrite !== false}
            label="写入前询问"
            onChange={(localWrite) => updateApprovalSecurity({ localWrite })}
          />
        </SettingRow>
        <SettingRow title="外部系统写入">
          <Toggle
            checked={settings.security?.approval?.remoteWrite !== false}
            label="外部操作前询问"
            onChange={(remoteWrite) => updateApprovalSecurity({ remoteWrite })}
          />
        </SettingRow>
        <SettingRow title="任务内授权">
          <Toggle
            checked={settings.security?.approval?.allowRunGrant !== false}
            label="允许本任务内记住批准"
            onChange={(allowRunGrant) => updateApprovalSecurity({ allowRunGrant })}
          />
        </SettingRow>
        <div className="tool-security-note">
          破坏性操作始终需要逐次确认；检测到疑似提示词注入后，已有任务授权会立即失效。
        </div>
      </SettingsSection>

      <SettingsSection title="工具来源">
        <div className="tool-source-overview" data-testid="tool-source-overview">
          <div><strong>{manifest?.sourceSummary?.builtin ?? 0}</strong><span>Built-in</span></div>
          <div><strong>{manifest?.sourceSummary?.mcp ?? 0}</strong><span>MCP</span></div>
          <div><strong>{manifest?.sourceSummary?.custom ?? 0}</strong><span>Custom HTTP</span></div>
        </div>
      </SettingsSection>

      <SettingsSection title="工具清单">
        {manifestStatus === "loading" && (
          <div className="tool-manifest-empty">正在读取 Tool Manifest…</div>
        )}
        {manifestStatus === "error" && (
          <div className="tool-manifest-empty is-error">{manifestError || "读取 Tool Manifest 失败。"}</div>
        )}
        {manifestStatus === "ready" && visibleToolsets.map((toolset) => (
          <ManifestToolset
            key={toolset.id}
            toolset={toolset}
            developerMode={developerMode}
            expandedTools={expandedTools}
            onToolExpandedChange={updateExpandedTool}
            onToolsetOverride={(value) => updateToolsetOverride(toolset.id, value)}
            onToolOverride={updateToolOverride}
            onMcpPermission={updateMcpToolPermission}
          />
        ))}
      </SettingsSection>

      {customToolSettings && onUpdateCustomTools && (
        <div className="tool-custom-source" data-testid="custom-tools-in-tools">
          <CustomToolsPanel
            settings={{ customTools: customToolSettings }}
            developerMode={developerMode}
            onUpdate={onUpdateCustomTools}
          />
        </div>
      )}

      <details className="settings-disclosure" data-testid="tool-advanced-settings">
        <summary>高级设置</summary>
        <div className="settings-disclosure__body">
          <SettingRow title="工具并发">
            <Slider
              value={settings.runtime.maxConcurrent ?? 4}
              min={1}
              max={16}
              unit=" 个"
              onChange={(maxConcurrent) => updateRuntime({ maxConcurrent })}
            />
          </SettingRow>

          <SettingRow title="单工具超时">
            <Slider
              value={(settings.runtime.defaultTimeoutMs ?? 15000) / 1000}
              min={2}
              max={120}
              unit=" 秒"
              onChange={(seconds) => updateRuntime({ defaultTimeoutMs: seconds * 1000 })}
            />
          </SettingRow>

          <SettingRow title="自动重试">
            <Slider
              value={settings.runtime.maxToolRetries ?? 1}
              min={0}
              max={2}
              unit=" 次"
              onChange={(maxToolRetries) => updateRuntime({ maxToolRetries })}
            />
          </SettingRow>

          <SettingRow title="保存工具历史">
            <Toggle
              checked={settings.runtime.saveToolHistory !== false}
              label="保存工具输入、结果和耗时"
              onChange={(saveToolHistory) => updateRuntime({ saveToolHistory })}
            />
          </SettingRow>

          <SettingRow title="文本文件上限">
            <Slider
              value={settings.workspace.maxTextFileBytes}
              min={250000}
              max={20000000}
              step={250000}
              formatValue={formatBytes}
              onChange={(maxTextFileBytes) => updateWorkspace({ maxTextFileBytes })}
            />
          </SettingRow>

          <SettingRow title="单次读取行数">
            <Slider
              value={settings.workspace.maxReadLines}
              min={50}
              max={5000}
              step={50}
              unit=" 行"
              onChange={(maxReadLines) => updateWorkspace({ maxReadLines })}
            />
          </SettingRow>

          <SettingRow title="搜索结果上限">
            <Slider
              value={settings.workspace.maxSearchResults}
              min={10}
              max={500}
              step={10}
              unit=" 条"
              onChange={(maxSearchResults) => updateWorkspace({ maxSearchResults })}
            />
          </SettingRow>

          <SettingRow title="单文件写入上限">
            <Slider
              value={settings.workspace.maxWriteFileBytes ?? 5000000}
              min={65536}
              max={20000000}
              step={65536}
              formatValue={formatBytes}
              onChange={(maxWriteFileBytes) => updateWorkspace({ maxWriteFileBytes })}
            />
          </SettingRow>
        </div>
      </details>

      {developerMode && (
        <div className="developer-reveal">
          <details
            className="settings-disclosure developer-settings-disclosure"
            data-testid="tool-developer-settings"
          >
            <summary>Runtime 诊断与保险丝</summary>
            <div className="settings-disclosure__body">
              <SettingRow title="单段最大步骤">
                <Slider value={settings.runtime.maxSteps} min={1} max={32} unit=" 步" onChange={(maxSteps) => updateRuntime({ maxSteps })} />
              </SettingRow>
              <SettingRow title="最大任务分段">
                <Slider value={settings.runtime.maxSegments} min={1} max={100} unit=" 段" onChange={(maxSegments) => updateRuntime({ maxSegments })} />
              </SettingRow>
              <SettingRow title="无进展分段限制">
                <Slider value={settings.runtime.maxNoProgressSegments} min={1} max={10} unit=" 段" onChange={(maxNoProgressSegments) => updateRuntime({ maxNoProgressSegments })} />
              </SettingRow>
              <SettingRow title="最终总结尝试">
                <Slider value={settings.runtime.maxFinalizationAttempts} min={1} max={3} unit=" 次" onChange={(maxFinalizationAttempts) => updateRuntime({ maxFinalizationAttempts })} />
              </SettingRow>
              <SettingRow title="最终总结超时">
                <Slider value={(settings.runtime.finalizationTimeoutMs ?? 30000) / 1000} min={5} max={120} unit=" 秒" onChange={(seconds) => updateRuntime({ finalizationTimeoutMs: seconds * 1000 })} />
              </SettingRow>
              <SettingRow title="受限工具调用">
                <Slider value={settings.runtime.maxToolCalls} min={1} max={500} unit=" 次" onChange={(maxToolCalls) => updateRuntime({ maxToolCalls })} />
              </SettingRow>
              <SettingRow title="单 Step 工具数量">
                <Slider value={settings.runtime.maxToolCallsPerStep} min={1} max={64} unit=" 次" onChange={(maxToolCallsPerStep) => updateRuntime({ maxToolCallsPerStep })} />
              </SettingRow>
              <SettingRow title="单批工具数量">
                <Slider value={settings.runtime.maxToolCallsPerBatch} min={1} max={128} unit=" 次" onChange={(maxToolCallsPerBatch) => updateRuntime({ maxToolCallsPerBatch })} />
              </SettingRow>
              <SettingRow title="总请求熔断">
                <Slider value={settings.runtime.maxTotalToolCalls} min={100} max={10000} step={100} unit=" 次" onChange={(maxTotalToolCalls) => updateRuntime({ maxTotalToolCalls })} />
              </SettingRow>
              <SettingRow title="任务运行时间">
                <Slider value={(settings.runtime.runTimeoutMs ?? 1800000) / 60000} min={1} max={240} unit=" 分钟" onChange={(minutes) => updateRuntime({ runTimeoutMs: minutes * 60000 })} />
              </SettingRow>
              <SettingRow title="重复调用限制">
                <Slider value={settings.runtime.maxIdenticalCalls} min={1} max={10} unit=" 次" onChange={(maxIdenticalCalls) => updateRuntime({ maxIdenticalCalls })} />
              </SettingRow>

              <div className="developer-subsection" data-testid="tool-security-settings">
                <h3>Tool Security</h3>
                <SettingRow title="批准等待时间">
                  <Slider
                    value={(settings.security?.approval?.timeoutMs ?? 300000) / 1000}
                    min={30}
                    max={1800}
                    step={30}
                    unit=" 秒"
                    onChange={(seconds) => updateApprovalSecurity({ timeoutMs: seconds * 1000 })}
                  />
                </SettingRow>
                <SettingRow title="不可信内容写入隔离">
                  <Toggle
                    checked={settings.security?.untrustedContent?.requirePerCallApproval !== false}
                    label="疑似注入后逐次确认写操作"
                    onChange={(requirePerCallApproval) => updateUntrustedSecurity({ requirePerCallApproval })}
                  />
                </SettingRow>
                <SettingRow title="注入后破坏性阻断">
                  <Toggle
                    checked={settings.security?.untrustedContent?.blockDestructive !== false}
                    label="阻止破坏性工具"
                    onChange={(blockDestructive) => updateUntrustedSecurity({ blockDestructive })}
                  />
                </SettingRow>
              </div>

              <div className="developer-subsection" data-testid="journal-storage-settings">
                <h3>Runtime Journal 存储</h3>
                <SettingRow title="单文件滚动阈值">
                  <Slider
                    value={settings.runtime.journalMaxFileBytes ?? 8000000}
                    min={256000}
                    max={100000000}
                    step={256000}
                    formatValue={formatBytes}
                    onChange={(journalMaxFileBytes) => updateRuntime({
                      journalMaxFileBytes,
                      journalMaxTotalBytes: Math.max(settings.runtime.journalMaxTotalBytes ?? 48000000, journalMaxFileBytes)
                    })}
                  />
                </SettingRow>
                <SettingRow title="归档文件上限">
                  <Slider value={settings.runtime.journalMaxArchives ?? 6} min={1} max={32} unit=" 个" onChange={(journalMaxArchives) => updateRuntime({ journalMaxArchives })} />
                </SettingRow>
                <SettingRow title="Journal 总配额">
                  <Slider
                    value={settings.runtime.journalMaxTotalBytes ?? 48000000}
                    min={Math.max(1000000, settings.runtime.journalMaxFileBytes ?? 8000000)}
                    max={1000000000}
                    step={1000000}
                    formatValue={formatBytes}
                    onChange={(journalMaxTotalBytes) => updateRuntime({ journalMaxTotalBytes })}
                  />
                </SettingRow>
              </div>

              <div className="developer-subsection">
                <h3>Provider 熔断器</h3>
                <SettingRow title="触发阈值">
                  <Slider value={settings.runtime.circuitBreakers?.provider?.failureThreshold ?? 3} min={1} max={20} unit=" 次" onChange={(failureThreshold) => updateCircuitBreaker("provider", { failureThreshold })} />
                </SettingRow>
                <SettingRow title="统计窗口">
                  <Slider value={(settings.runtime.circuitBreakers?.provider?.failureWindowMs ?? 90000) / 1000} min={5} max={600} unit=" 秒" onChange={(seconds) => updateCircuitBreaker("provider", { failureWindowMs: seconds * 1000 })} />
                </SettingRow>
                <SettingRow title="冷却时间">
                  <Slider value={(settings.runtime.circuitBreakers?.provider?.cooldownMs ?? 45000) / 1000} min={1} max={600} unit=" 秒" onChange={(seconds) => updateCircuitBreaker("provider", { cooldownMs: seconds * 1000 })} />
                </SettingRow>
                <SettingRow title="试探请求数">
                  <Slider value={settings.runtime.circuitBreakers?.provider?.halfOpenMaxCalls ?? 1} min={1} max={10} unit=" 次" onChange={(halfOpenMaxCalls) => updateCircuitBreaker("provider", { halfOpenMaxCalls })} />
                </SettingRow>

                <h3>Tool 熔断器</h3>
                <SettingRow title="触发阈值">
                  <Slider value={settings.runtime.circuitBreakers?.tool?.failureThreshold ?? 3} min={1} max={20} unit=" 次" onChange={(failureThreshold) => updateCircuitBreaker("tool", { failureThreshold })} />
                </SettingRow>
                <SettingRow title="统计窗口">
                  <Slider value={(settings.runtime.circuitBreakers?.tool?.failureWindowMs ?? 60000) / 1000} min={5} max={600} unit=" 秒" onChange={(seconds) => updateCircuitBreaker("tool", { failureWindowMs: seconds * 1000 })} />
                </SettingRow>
                <SettingRow title="冷却时间">
                  <Slider value={(settings.runtime.circuitBreakers?.tool?.cooldownMs ?? 30000) / 1000} min={1} max={600} unit=" 秒" onChange={(seconds) => updateCircuitBreaker("tool", { cooldownMs: seconds * 1000 })} />
                </SettingRow>
                <SettingRow title="试探请求数">
                  <Slider value={settings.runtime.circuitBreakers?.tool?.halfOpenMaxCalls ?? 1} min={1} max={10} unit=" 次" onChange={(halfOpenMaxCalls) => updateCircuitBreaker("tool", { halfOpenMaxCalls })} />
                </SettingRow>
              </div>

              <CircuitBreakerDiagnostics />
            </div>
          </details>
        </div>
      )}
    </>
  );
}

function formatCircuitState(state) {
  if (state === "open") return "已熔断";
  if (state === "half_open") return "试探恢复";
  return "正常";
}

function CircuitBreakerDiagnostics() {
  const [snapshot, setSnapshot] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const result = await window.api?.getCircuitBreakerState?.();
      if (!result?.ok) throw new Error(result?.message ?? "读取熔断器状态失败。");
      setSnapshot(result.snapshot ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reset = async (scope, key = "") => {
    const token = `${scope}:${key || "all"}`;
    setBusy(token);
    setError("");
    try {
      const result = await window.api?.resetCircuitBreaker?.({ scope, key });
      if (!result?.ok) throw new Error(result?.message ?? "重置熔断器失败。");
      setSnapshot(result.snapshot ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  };

  const scopes = [["provider", "Provider"], ["tool", "Tool"]];

  return (
    <div className="developer-subsection circuit-breaker-diagnostics" data-testid="circuit-breaker-diagnostics">
      <div className="circuit-breaker-diagnostics__header">
        <h3>当前熔断状态</h3>
        <div>
          <button type="button" onClick={() => void refresh()}>刷新</button>
          <button type="button" disabled={Boolean(busy)} data-testid="circuit-breaker-reset-all" onClick={() => void reset("all")}>全部重置</button>
        </div>
      </div>

      {scopes.map(([scope, label]) => {
        const state = snapshot?.[scope];
        const entries = state?.entries ?? [];
        return (
          <section key={scope} className="circuit-breaker-diagnostics__scope">
            <header>
              <strong>{label}</strong>
              <span>阈值 {state?.failureThreshold ?? "-"} · 窗口 {Math.round((state?.failureWindowMs ?? 0) / 1000)} 秒 · 冷却 {Math.round((state?.cooldownMs ?? 0) / 1000)} 秒</span>
              <button type="button" disabled={Boolean(busy)} onClick={() => void reset(scope)}>重置该组</button>
            </header>
            {entries.length === 0 ? (
              <p>暂无运行记录。</p>
            ) : (
              <div className="circuit-breaker-diagnostics__entries">
                {entries.map((entry) => (
                  <article key={entry.key} className={`is-${entry.state}`}>
                    <div>
                      <strong>{entry.label || entry.key}</strong>
                      <small>{formatCircuitState(entry.state)} · 失败 {entry.failureCount}</small>
                    </div>
                    <button type="button" disabled={Boolean(busy)} data-testid={`circuit-breaker-reset-${scope}`} onClick={() => void reset(scope, entry.key)}>重置</button>
                  </article>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {error && <p className="circuit-breaker-diagnostics__error">{error}</p>}
    </div>
  );
}
