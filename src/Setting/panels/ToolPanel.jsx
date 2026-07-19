import {
  SettingRow,
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

  return (
    <>
      {developerMode && (
        <div className="developer-reveal">
          <details
            className="settings-disclosure developer-settings-disclosure"
            data-testid="tool-developer-settings"
          >
            <summary>
              开发者设置
            </summary>

            <div className="settings-disclosure__body">
              <div className="developer-subsection">
                <h3>Tool Runtime</h3>

                <SettingRow
                  title="单段最大步骤"
                  description="每个 Segment 内模型与工具结果之间的循环上限；未完成时可自动进入下一段。"
                >
                  <Slider
                    value={settings.runtime.maxSteps}
                    min={1}
                    max={32}
                    unit=" 步"
                    onChange={(maxSteps) => {
                      updateRuntime({ maxSteps });
                    }}
                  />
                </SettingRow>

                <SettingRow
                  title="最大任务分段"
                  description="控制自动续跑的 checkpoint 数量；达到边界时保留进度，而不是丢失任务。"
                >
                  <Slider
                    value={settings.runtime.maxSegments}
                    min={1}
                    max={100}
                    unit=" 段"
                    onChange={(maxSegments) => {
                      updateRuntime({ maxSegments });
                    }}
                  />
                </SettingRow>

                <SettingRow
                  title="无进展分段限制"
                  description="连续多个 Segment 没有新计划进展或新工具结果时停止，避免空转。"
                >
                  <Slider
                    value={settings.runtime.maxNoProgressSegments}
                    min={1}
                    max={10}
                    unit=" 段"
                    onChange={(maxNoProgressSegments) => {
                      updateRuntime({
                        maxNoProgressSegments
                      });
                    }}
                  />
                </SettingRow>

                <SettingRow
                  title="最终总结尝试"
                  description="普通执行步数耗尽后，额外保留无工具的最终总结机会。"
                >
                  <Slider
                    value={settings.runtime.maxFinalizationAttempts}
                    min={1}
                    max={3}
                    unit=" 次"
                    onChange={(maxFinalizationAttempts) => {
                      updateRuntime({ maxFinalizationAttempts });
                    }}
                  />
                </SettingRow>

                <SettingRow
                  title="最终总结超时"
                  description="最终总结使用独立时间预算；超时后立即使用本地进展摘要，不延长主任务等待。"
                >
                  <Slider
                    value={settings.runtime.finalizationTimeoutMs / 1000}
                    min={5}
                    max={120}
                    unit=" 秒"
                    onChange={(seconds) => {
                      updateRuntime({
                        finalizationTimeoutMs:
                          seconds * 1000
                      });
                    }}
                  />
                </SettingRow>

                <SettingRow
                  title="受限工具调用"
                  description="仅统计写入、外部操作或较高风险工具；本地低风险读取不消耗该配额。"
                >
                  <Slider
                    value={settings.runtime.maxToolCalls}
                    min={1}
                    max={500}
                    unit=" 次"
                    onChange={(maxToolCalls) => {
                      updateRuntime({ maxToolCalls });
                    }}
                  />
                </SettingRow>

                <SettingRow
                  title="单 Step 工具数量"
                  description="限制模型一次 Step 内生成的工具调用总数，避免异常并发请求淹没执行队列。"
                >
                  <Slider
                    value={settings.runtime.maxToolCallsPerStep}
                    min={1}
                    max={64}
                    unit=" 次"
                    onChange={(maxToolCallsPerStep) => {
                      updateRuntime({ maxToolCallsPerStep });
                    }}
                  />
                </SettingRow>

                <SettingRow
                  title="单批工具数量"
                  description="限制同一工作批次累计的工具调用；达到边界后整理当前结果并自然收尾。"
                >
                  <Slider
                    value={settings.runtime.maxToolCallsPerBatch}
                    min={1}
                    max={128}
                    unit=" 次"
                    onChange={(maxToolCallsPerBatch) => {
                      updateRuntime({ maxToolCallsPerBatch });
                    }}
                  />
                </SettingRow>

                <SettingRow
                  title="安全重试次数"
                  description="仅对可安全重试的临时故障生效；权限、参数和取消错误不会自动重试。"
                >
                  <Slider
                    value={settings.runtime.maxToolRetries}
                    min={0}
                    max={2}
                    unit=" 次"
                    onChange={(maxToolRetries) => {
                      updateRuntime({ maxToolRetries });
                    }}
                  />
                </SettingRow>

                <SettingRow
                  title="任务运行时间"
                  description="一个 Agent Run 的最长持续时间；低风险工具免配额但仍受该熔断保护。"
                >
                  <Slider
                    value={settings.runtime.runTimeoutMs / 60000}
                    min={1}
                    max={240}
                    step={1}
                    unit=" 分钟"
                    onChange={(minutes) => {
                      updateRuntime({
                        runTimeoutMs:
                          minutes * 60000
                      });
                    }}
                  />
                </SettingRow>

                <SettingRow
                  title="单工具超时"
                  description="单次执行超过时限后返回标准化超时错误。"
                >
                  <Slider
                    value={settings.runtime.defaultTimeoutMs / 1000}
                    min={2}
                    max={120}
                    unit=" 秒"
                    onChange={(seconds) => {
                      updateRuntime({
                        defaultTimeoutMs:
                          seconds * 1000
                      });
                    }}
                  />
                </SettingRow>

                <SettingRow
                  title="重复调用限制"
                  description="限制受配额或有副作用工具的相同参数重复调用；免配额工具由无进展检测和总请求熔断保护。"
                >
                  <Slider
                    value={settings.runtime.maxIdenticalCalls}
                    min={1}
                    max={10}
                    unit=" 次"
                    onChange={(maxIdenticalCalls) => {
                      updateRuntime({ maxIdenticalCalls });
                    }}
                  />
                </SettingRow>

                <SettingRow
                  title="保存详细记录"
                  description="把工具输入、结果和耗时保存在 Assistant 消息中。"
                >
                  <Toggle
                    checked={settings.runtime.saveToolHistory}
                    label="保存详细工具记录"
                    onChange={(saveToolHistory) => {
                      updateRuntime({ saveToolHistory });
                    }}
                  />
                </SettingRow>
              </div>

              <div className="developer-subsection">
                <h3>Toolsets</h3>

                {TOOLSET_OPTIONS.map(
                  (toolset) => (
                    <SettingRow
                      key={toolset.id}
                      title={toolset.title}
                      description={toolset.description}
                    >
                      <Select
                        value={
                          settings.developer
                            .toolsetOverrides[
                              toolset.id
                            ] ?? "inherit"
                        }
                        options={TOOL_OVERRIDE_OPTIONS}
                        onChange={(value) => {
                          updateDeveloper({
                            toolsetOverrides: {
                              ...settings.developer.toolsetOverrides,
                              [toolset.id]: value
                            }
                          });
                        }}
                      />
                    </SettingRow>
                  )
                )}
              </div>

              <details className="developer-tool-list">
                <summary>
                  单个工具
                </summary>

                <div className="developer-tool-list__body">
                  {TOOLSET_OPTIONS.flatMap(
                    (toolset) =>
                      toolset.tools.map(
                        (tool) => (
                          <div
                            className="developer-tool-item"
                            key={tool.name}
                          >
                            <div>
                              <strong>
                                {tool.title}
                              </strong>
                              <code>
                                {tool.name}
                              </code>
                              <p>
                                {tool.description}
                              </p>
                              <small>
                                {toolset.title} · {toolset.risk}
                              </small>
                            </div>

                            <Select
                              value={
                                settings.developer
                                  .toolOverrides[
                                    tool.name
                                  ] ?? "inherit"
                              }
                              options={TOOL_OVERRIDE_OPTIONS}
                              testId={`tool-override-${tool.name}`}
                              onChange={(value) => {
                                updateDeveloper({
                                  toolOverrides: {
                                    ...settings.developer.toolOverrides,
                                    [tool.name]: value
                                  }
                                });
                              }}
                            />
                          </div>
                        )
                      )
                  )}
                </div>
              </details>

              <details className="developer-tool-list">
                <summary>
                  工作区高级限制
                </summary>

                <div className="developer-tool-list__body">
                  <SettingRow title="文本文件上限">
                    <Slider
                      value={settings.workspace.maxTextFileBytes}
                      min={250000}
                      max={20000000}
                      step={250000}
                      formatValue={formatBytes}
                      onChange={(maxTextFileBytes) => {
                        updateWorkspace({ maxTextFileBytes });
                      }}
                    />
                  </SettingRow>

                  <SettingRow title="单次读取行数">
                    <Slider
                      value={settings.workspace.maxReadLines}
                      min={50}
                      max={5000}
                      step={50}
                      unit=" 行"
                      onChange={(maxReadLines) => {
                        updateWorkspace({ maxReadLines });
                      }}
                    />
                  </SettingRow>

                  <SettingRow title="搜索结果上限">
                    <Slider
                      value={settings.workspace.maxSearchResults}
                      min={10}
                      max={500}
                      step={10}
                      unit=" 条"
                      onChange={(maxSearchResults) => {
                        updateWorkspace({ maxSearchResults });
                      }}
                    />
                  </SettingRow>

                  <SettingRow title="搜索深度">
                    <Slider
                      value={settings.workspace.maxSearchDepth}
                      min={1}
                      max={12}
                      unit=" 层"
                      onChange={(maxSearchDepth) => {
                        updateWorkspace({ maxSearchDepth });
                      }}
                    />
                  </SettingRow>
                </div>
              </details>

            </div>
          </details>
        </div>
      )}
    </>
  );
}
