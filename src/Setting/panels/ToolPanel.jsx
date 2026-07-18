import {
  useMemo,
  useState
} from "react";

import {
  ActionButton,
  SettingRow,
  SettingsSection,
  Slider,
  TextInput,
  Toggle,
  Segmented,
  Select
} from "../components/Controls.jsx";

import {
  TOOL_MODE_OPTIONS,
  TOOL_OVERRIDE_OPTIONS,
  TOOLSET_OPTIONS
} from "../tools/toolPanelOptions.js";

function formatBytes(value) {
  if (value >= 1000000) {
    return `${Math.round(value / 100000) / 10} MB`;
  }

  return `${Math.round(value / 1000)} KB`;
}

function resolveActiveModel(modelSettings = {}) {
  const provider =
    modelSettings.providers?.[
      modelSettings.activeProvider
    ] ?? Object.values(
      modelSettings.providers ?? {}
    )[0];

  const model =
    provider?.models?.find(
      (item) =>
        item.id ===
        provider.activeModelId
    ) ?? provider?.models?.[0];

  return {
    providerName:
      provider?.name ?? "未配置",
    providerType:
      provider?.type ?? "unknown",
    modelName:
      model?.name ?? "未配置",
    modelId:
      model?.modelId ?? "unknown"
  };
}

function resolveToolsetEnabled(
  settings,
  toolsetId
) {
  let enabled =
    toolsetId === "workspace.read"
      ? settings.mode === "coding"
      : true;

  const override =
    settings.developer
      ?.toolsetOverrides?.[
        toolsetId
      ] ?? "inherit";

  if (override === "enabled") {
    enabled = true;
  } else if (override === "disabled") {
    enabled = false;
  }

  return enabled;
}

function resolveToolEnabled(
  settings,
  toolsetId,
  toolName
) {
  if (
    !resolveToolsetEnabled(
      settings,
      toolsetId
    )
  ) {
    return false;
  }

  const override =
    settings.developer
      ?.toolOverrides?.[
        toolName
      ] ?? "inherit";

  return override !== "disabled";
}

function hasDeveloperOverrides(
  settings
) {
  return [
    ...Object.values(
      settings.developer
        ?.toolsetOverrides ?? {}
    ),
    ...Object.values(
      settings.developer
        ?.toolOverrides ?? {}
    )
  ].some(
    (value) =>
      value !== "inherit"
  );
}

export function ToolPanel({
  settings,
  developerMode = false,
  modelSettings,
  onUpdate
}) {
  const [rootDraft, setRootDraft] =
    useState("");

  const activeModel = useMemo(
    () =>
      resolveActiveModel(
        modelSettings
      ),
    [modelSettings]
  );

  const enabledTools = useMemo(
    () =>
      TOOLSET_OPTIONS.reduce(
        (count, toolset) =>
          count +
          toolset.tools.filter(
            (tool) =>
              resolveToolEnabled(
                settings,
                toolset.id,
                tool.name
              )
          ).length,
        0
      ),
    [settings]
  );

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

  const addRoot = (value) => {
    const normalized =
      String(value ?? "").trim();

    if (!normalized) {
      return;
    }

    updateWorkspace({
      roots: [
        ...new Set([
          ...settings.workspace.roots,
          normalized
        ])
      ]
    });
    setRootDraft("");
  };

  const browseRoot = async () => {
    const result =
      await window.api
        ?.selectWorkspaceDirectory?.();

    if (
      result?.canceled ||
      !result?.paths?.[0]
    ) {
      return;
    }

    addRoot(result.paths[0]);
  };

  const coding =
    settings.mode === "coding";

  return (
    <>
      <SettingsSection
        title="工作模式"
        description="选择 Agent 当前需要的能力范围。"
      >
        <div className="tool-mode-card">
          <Segmented
            value={settings.mode}
            options={TOOL_MODE_OPTIONS}
            testId="tool-mode"
            onChange={(mode) => {
              onUpdate({
                mode,
                profile:
                  mode === "coding"
                    ? "workspace"
                    : "chat"
              });
            }}
          />

          <div
            className="tool-mode-card__copy"
            key={settings.mode}
          >
            <strong>
              {coding
                ? "分析授权项目"
                : "聊天与通用任务"}
            </strong>
            <span>
              {coding
                ? "包含 Chat 能力，并允许读取和搜索授权工作区。"
                : "用于时间、计算、规划和日常对话，不读取本地项目。"}
            </span>
          </div>

          <div className="tool-mode-card__status">
            <span>
              {enabledTools} 个工具可用
            </span>
            {hasDeveloperOverrides(
              settings
            ) && (
              <span>
                开发者覆盖生效
              </span>
            )}
          </div>
        </div>
      </SettingsSection>

      <section
        className={`tool-workspace-reveal${
          coding
            ? " is-visible"
            : ""
        }`}
        aria-hidden={!coding}
      >
        <div className="tool-workspace-reveal__inner">
          <SettingsSection
            title="Coding 工作区"
            description="Agent 只能读取你明确授权的目录。"
          >
            <div className="workspace-simple-list">
              {settings.workspace.roots.length === 0 ? (
                <div className="workspace-simple-list__empty">
                  尚未添加额外工作区
                </div>
              ) : (
                settings.workspace.roots.map(
                  (root) => (
                    <div
                      className="workspace-simple-item"
                      key={root}
                    >
                      <code title={root}>
                        {root}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          updateWorkspace({
                            roots:
                              settings.workspace.roots.filter(
                                (item) =>
                                  item !== root
                              )
                          });
                        }}
                      >
                        移除
                      </button>
                    </div>
                  )
                )
              )}
            </div>

            <ActionButton
              testId="add-workspace"
              onClick={() => {
                void browseRoot();
              }}
            >
              添加工作区
            </ActionButton>
          </SettingsSection>
        </div>
      </section>

      <SettingsSection title="活动显示">
        <SettingRow title="展示层级">
          <span className="setting-static-value">详细</span>
        </SettingRow>
      </SettingsSection>

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
                  title="最大 Agent 步数"
                  description="限制模型与工具结果之间的循环次数。"
                >
                  <Slider
                    value={settings.runtime.maxSteps}
                    min={1}
                    max={12}
                    unit=" 步"
                    onChange={(maxSteps) => {
                      updateRuntime({ maxSteps });
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
                  title="用户问题上限"
                  description="限制单个任务中 ask_user 可提出的问题数量，并阻止回答后立即连续追问。"
                >
                  <Slider
                    value={settings.runtime.maxAskUserCalls}
                    min={1}
                    max={10}
                    unit=" 个"
                    onChange={(maxAskUserCalls) => {
                      updateRuntime({ maxAskUserCalls });
                    }}
                  />
                </SettingRow>

                <SettingRow
                  title="最大工具调用"
                  description="达到上限后拒绝新的工具调用。"
                >
                  <Slider
                    value={settings.runtime.maxToolCalls}
                    min={1}
                    max={50}
                    unit=" 次"
                    onChange={(maxToolCalls) => {
                      updateRuntime({ maxToolCalls });
                    }}
                  />
                </SettingRow>

                <SettingRow
                  title="任务总超时"
                  description="限制一个 Agent Run 可持续的总时间。"
                >
                  <Slider
                    value={settings.runtime.runTimeoutMs / 1000}
                    min={10}
                    max={600}
                    step={10}
                    unit=" 秒"
                    onChange={(seconds) => {
                      updateRuntime({
                        runTimeoutMs:
                          seconds * 1000
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
                  description="阻止模型持续使用完全相同的工具和参数。"
                >
                  <Slider
                    value={settings.runtime.maxIdenticalCalls}
                    min={1}
                    max={5}
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
                  <SettingRow
                    title="包含应用启动目录"
                    description="开发时通常是当前项目根目录。"
                  >
                    <Toggle
                      checked={settings.workspace.includeProjectRoot}
                      label="包含应用启动目录"
                      onChange={(includeProjectRoot) => {
                        updateWorkspace({ includeProjectRoot });
                      }}
                    />
                  </SettingRow>

                  <div className="workspace-developer-add">
                    <TextInput
                      value={rootDraft}
                      placeholder="手动输入工作区路径"
                      onChange={setRootDraft}
                    />
                    <ActionButton
                      disabled={!rootDraft.trim()}
                      onClick={() => {
                        addRoot(rootDraft);
                      }}
                    >
                      添加
                    </ActionButton>
                  </div>

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

              <div className="developer-model-capability">
                <div>
                  <span>当前模型</span>
                  <strong>
                    {activeModel.providerName} / {activeModel.modelName}
                  </strong>
                  <small>
                    {activeModel.modelId}
                  </small>
                </div>
                <dl>
                  <div>
                    <dt>Provider</dt>
                    <dd>{activeModel.providerType}</dd>
                  </div>
                  <div>
                    <dt>工具接口</dt>
                    <dd>AI SDK</dd>
                  </div>
                  <div>
                    <dt>当前可见</dt>
                    <dd>{enabledTools} 个</dd>
                  </div>
                  <div>
                    <dt>能力验证</dt>
                    <dd>请求时完成</dd>
                  </div>
                </dl>
              </div>

              <div className="tool-safety-note">
                <strong>固定安全边界</strong>
                <span>
                  开发者模式不会开放敏感文件、工作区逃逸、写文件、命令执行或任意联网。
                </span>
              </div>
            </div>
          </details>
        </div>
      )}
    </>
  );
}
