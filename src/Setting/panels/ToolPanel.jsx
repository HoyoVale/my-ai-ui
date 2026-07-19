import {
  SettingRow,
  SettingsSection,
  Slider,
  Toggle,
  Select
} from "../components/Controls.jsx";

import {
  TOOL_OVERRIDE_OPTIONS,
  TOOLSET_OPTIONS
} from "../tools/toolPanelOptions.js";

function formatBytes(value) {
  if (value >= 1000000) {
    return `${Math.round(value / 100000) / 10} MB`;
  }

  return `${Math.round(value / 1000)} KB`;
}

export function ToolPanel({
  settings,
  developerMode = false,
  onUpdate
}) {
  const updateRuntime = (patch) => {
    onUpdate({
      runtime: {
        ...settings.runtime,
        ...patch
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

  const updateDeveloper = (patch) => {
    onUpdate({
      developer: {
        ...settings.developer,
        ...patch
      }
    });
  };

  const updateToolset = (toolsetId, enabled) => {
    onUpdate({
      toolsets: {
        ...settings.toolsets,
        [toolsetId]: enabled
      }
    });
  };

  const updateTool = (toolName, enabled) => {
    onUpdate({
      overrides: {
        ...settings.overrides,
        [toolName]: enabled
      }
    });
  };

  const userToolsets = TOOLSET_OPTIONS.filter(
    (toolset) => toolset.userVisible !== false
  );

  return (
    <>
      <SettingsSection
        title="工具"
        description="控制 Agent 是否可以使用工具，以及允许使用的工具组。"
      >
        <SettingRow
          title="启用工具"
          description="关闭后模型只进行普通对话，不调用任何 Tool。"
        >
          <Toggle
            checked={settings.enabled !== false}
            label="启用工具"
            onChange={(enabled) => onUpdate({ enabled })}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="工具组"
        description="Chat 绑定工作区后只提供只读能力；Coding 会话始终固定在创建时选择的工作区。"
      >
        {userToolsets.map((toolset) => (
          <SettingRow
            key={toolset.id}
            title={toolset.title}
            description={toolset.description}
          >
            <Toggle
              checked={settings.toolsets?.[toolset.id] !== false}
              label={`启用${toolset.title}`}
              onChange={(enabled) => {
                updateToolset(toolset.id, enabled);
              }}
            />
          </SettingRow>
        ))}
      </SettingsSection>

      <SettingsSection
        title="单个工具"
        description="关闭不需要或不信任的工具。任务计划和大型结果读取属于内部基础工具。"
      >
        {userToolsets.map((toolset) => (
          <details
            className="developer-tool-list"
            key={toolset.id}
          >
            <summary>{toolset.title}</summary>
            <div className="developer-tool-list__body">
              {toolset.tools.map((tool) => (
                <SettingRow
                  key={tool.name}
                  title={tool.title}
                  description={tool.description}
                >
                  <Toggle
                    checked={settings.overrides?.[tool.name] !== false}
                    label={`启用${tool.title}`}
                    onChange={(enabled) => {
                      updateTool(tool.name, enabled);
                    }}
                  />
                </SettingRow>
              ))}
            </div>
          </details>
        ))}
      </SettingsSection>

      <details className="settings-disclosure" data-testid="tool-advanced-settings">
        <summary>高级设置</summary>
        <div className="settings-disclosure__body">
          <SettingRow
            title="工具并发"
            description="同时执行的工具数量；较低数值更稳，较高数值更快。"
          >
            <Slider
              value={settings.runtime.maxConcurrent ?? 4}
              min={1}
              max={16}
              unit=" 个"
              onChange={(maxConcurrent) => updateRuntime({ maxConcurrent })}
            />
          </SettingRow>

          <SettingRow
            title="单工具超时"
            description="单次工具执行超过时限后返回超时结果。"
          >
            <Slider
              value={settings.runtime.defaultTimeoutMs / 1000}
              min={2}
              max={120}
              unit=" 秒"
              onChange={(seconds) => updateRuntime({
                defaultTimeoutMs: seconds * 1000
              })}
            />
          </SettingRow>

          <SettingRow
            title="自动重试"
            description="只重试无副作用且可安全恢复的临时故障。"
          >
            <Slider
              value={settings.runtime.maxToolRetries}
              min={0}
              max={2}
              unit=" 次"
              onChange={(maxToolRetries) => updateRuntime({ maxToolRetries })}
            />
          </SettingRow>

          <SettingRow title="保存工具历史">
            <Toggle
              checked={settings.runtime.saveToolHistory}
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
                <Slider
                  value={settings.runtime.maxSteps}
                  min={1}
                  max={32}
                  unit=" 步"
                  onChange={(maxSteps) => updateRuntime({ maxSteps })}
                />
              </SettingRow>

              <SettingRow title="最大任务分段">
                <Slider
                  value={settings.runtime.maxSegments}
                  min={1}
                  max={100}
                  unit=" 段"
                  onChange={(maxSegments) => updateRuntime({ maxSegments })}
                />
              </SettingRow>

              <SettingRow title="无进展分段限制">
                <Slider
                  value={settings.runtime.maxNoProgressSegments}
                  min={1}
                  max={10}
                  unit=" 段"
                  onChange={(maxNoProgressSegments) => updateRuntime({ maxNoProgressSegments })}
                />
              </SettingRow>

              <SettingRow title="最终总结尝试">
                <Slider
                  value={settings.runtime.maxFinalizationAttempts}
                  min={1}
                  max={3}
                  unit=" 次"
                  onChange={(maxFinalizationAttempts) => updateRuntime({ maxFinalizationAttempts })}
                />
              </SettingRow>

              <SettingRow title="最终总结超时">
                <Slider
                  value={settings.runtime.finalizationTimeoutMs / 1000}
                  min={5}
                  max={120}
                  unit=" 秒"
                  onChange={(seconds) => updateRuntime({
                    finalizationTimeoutMs: seconds * 1000
                  })}
                />
              </SettingRow>

              <SettingRow title="受限工具调用">
                <Slider
                  value={settings.runtime.maxToolCalls}
                  min={1}
                  max={500}
                  unit=" 次"
                  onChange={(maxToolCalls) => updateRuntime({ maxToolCalls })}
                />
              </SettingRow>

              <SettingRow title="单 Step 工具数量">
                <Slider
                  value={settings.runtime.maxToolCallsPerStep}
                  min={1}
                  max={64}
                  unit=" 次"
                  onChange={(maxToolCallsPerStep) => updateRuntime({ maxToolCallsPerStep })}
                />
              </SettingRow>

              <SettingRow title="单批工具数量">
                <Slider
                  value={settings.runtime.maxToolCallsPerBatch}
                  min={1}
                  max={128}
                  unit=" 次"
                  onChange={(maxToolCallsPerBatch) => updateRuntime({ maxToolCallsPerBatch })}
                />
              </SettingRow>

              <SettingRow title="总请求熔断">
                <Slider
                  value={settings.runtime.maxTotalToolCalls}
                  min={100}
                  max={10000}
                  step={100}
                  unit=" 次"
                  onChange={(maxTotalToolCalls) => updateRuntime({ maxTotalToolCalls })}
                />
              </SettingRow>

              <SettingRow title="任务运行时间">
                <Slider
                  value={settings.runtime.runTimeoutMs / 60000}
                  min={1}
                  max={240}
                  unit=" 分钟"
                  onChange={(minutes) => updateRuntime({
                    runTimeoutMs: minutes * 60000
                  })}
                />
              </SettingRow>

              <SettingRow title="重复调用限制">
                <Slider
                  value={settings.runtime.maxIdenticalCalls}
                  min={1}
                  max={10}
                  unit=" 次"
                  onChange={(maxIdenticalCalls) => updateRuntime({ maxIdenticalCalls })}
                />
              </SettingRow>

              <div className="developer-subsection">
                <h3>Toolset 强制覆盖</h3>
                {TOOLSET_OPTIONS.map((toolset) => (
                  <SettingRow
                    key={toolset.id}
                    title={toolset.title}
                    description="仅用于调试，优先级高于普通用户开关。"
                  >
                    <Select
                      value={settings.developer.toolsetOverrides?.[toolset.id] ?? "inherit"}
                      options={TOOL_OVERRIDE_OPTIONS}
                      onChange={(value) => updateDeveloper({
                        toolsetOverrides: {
                          ...settings.developer.toolsetOverrides,
                          [toolset.id]: value
                        }
                      })}
                    />
                  </SettingRow>
                ))}
              </div>

              <details className="developer-tool-list">
                <summary>单工具强制覆盖</summary>
                <div className="developer-tool-list__body">
                  {TOOLSET_OPTIONS.flatMap((toolset) =>
                    toolset.tools.map((tool) => (
                      <SettingRow
                        key={tool.name}
                        title={tool.title}
                        description={tool.name}
                      >
                        <Select
                          value={settings.developer.toolOverrides?.[tool.name] ?? "inherit"}
                          options={TOOL_OVERRIDE_OPTIONS}
                          onChange={(value) => updateDeveloper({
                            toolOverrides: {
                              ...settings.developer.toolOverrides,
                              [tool.name]: value
                            }
                          })}
                        />
                      </SettingRow>
                    ))
                  )}
                </div>
              </details>
            </div>
          </details>
        </div>
      )}
    </>
  );
}
