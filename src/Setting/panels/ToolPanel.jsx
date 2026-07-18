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
  Segmented
} from "../components/Controls.jsx";

import {
  ALL_TOOL_NAMES,
  TOOL_PROFILE_OPTIONS,
  TOOLSET_OPTIONS
} from "../tools/toolPanelOptions.js";

function profilePatch(profile) {
  if (profile === "chat") {
    return {
      profile,
      toolsets: {
        "core.runtime": true,
        "workspace.read": false,
        "agent.internal": true
      },
      overrides:
        Object.fromEntries(
          ALL_TOOL_NAMES.map(
            (name) => [name, true]
          )
        )
    };
  }

  if (profile === "workspace") {
    return {
      profile,
      workspace: {
        enabled: true
      },
      toolsets: {
        "core.runtime": true,
        "workspace.read": true,
        "agent.internal": true
      },
      overrides:
        Object.fromEntries(
          ALL_TOOL_NAMES.map(
            (name) => [name, true]
          )
        )
    };
  }

  return {
    profile: "custom"
  };
}

function formatBytes(value) {
  if (value >= 1000000) {
    return `${Math.round(value / 100000) / 10} MB`;
  }

  return `${Math.round(value / 1000)} KB`;
}

export function ToolPanel({
  settings,
  onUpdate
}) {
  const [rootDraft, setRootDraft] =
    useState("");

  const enabledTools = useMemo(
    () => {
      if (!settings.enabled) {
        return 0;
      }

      return TOOLSET_OPTIONS.reduce(
        (count, toolset) => {
          if (
            settings.toolsets[
              toolset.id
            ] === false ||
            (
              toolset.id ===
                "workspace.read" &&
              settings.workspace
                .enabled === false
            )
          ) {
            return count;
          }

          return count +
            toolset.tools.filter(
              (tool) =>
                settings.overrides[
                  tool.name
                ] !== false
            ).length;
        },
        0
      );
    },
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
      profile: "custom",
      workspace: {
        ...settings.workspace,
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

  const setProfile = (profile) => {
    const patch = profilePatch(profile);

    onUpdate({
      ...patch,
      workspace: patch.workspace
        ? {
            ...settings.workspace,
            ...patch.workspace
          }
        : settings.workspace,
      toolsets: patch.toolsets ??
        settings.toolsets,
      overrides: patch.overrides ??
        settings.overrides
    });
  };

  return (
    <>
      <div className="tool-overview-card">
        <div>
          <span className="tool-overview-card__eyebrow">
            Safe Tool Runtime
          </span>
          <strong>
            {settings.enabled
              ? `${enabledTools} 个工具可用`
              : "工具调用已关闭"}
          </strong>
          <p>
            只向模型暴露当前策略允许的工具。文件工具保持只读，并继续阻止敏感路径和符号链接逃逸。
          </p>
        </div>

        <Toggle
          checked={settings.enabled}
          label="启用工具调用"
          testId="tools-enabled"
          onChange={(enabled) => {
            onUpdate({ enabled });
          }}
        />
      </div>

      <SettingsSection
        title="运行模式"
        description="使用预设快速控制工具范围；修改任意工具后会切换为自定义。"
      >
        <SettingRow
          title="工具预设"
          description="对话模式不读取工作区；工作区模式启用当前全部低风险工具。"
          disabled={!settings.enabled}
        >
          <Segmented
            value={settings.profile}
            options={TOOL_PROFILE_OPTIONS}
            testId="tool-profile"
            disabled={!settings.enabled}
            onChange={setProfile}
          />
        </SettingRow>

        <SettingRow
          title="最大执行步数"
          description="限制一次回复中模型、工具和工具结果之间的循环次数。"
          disabled={!settings.enabled}
        >
          <Slider
            value={settings.runtime.maxSteps}
            min={1}
            max={12}
            unit=" 步"
            disabled={!settings.enabled}
            onChange={(maxSteps) => {
              updateRuntime({ maxSteps });
            }}
          />
        </SettingRow>

        <SettingRow
          title="单个工具超时"
          description="超过时限后停止等待并把超时错误返回给模型。"
          disabled={!settings.enabled}
        >
          <Slider
            value={
              settings.runtime
                .defaultTimeoutMs /
              1000
            }
            min={2}
            max={120}
            step={1}
            unit=" 秒"
            disabled={!settings.enabled}
            onChange={(seconds) => {
              updateRuntime({
                defaultTimeoutMs:
                  seconds * 1000
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="保存工具记录"
          description="把工具名称、输入、结果和耗时保存在对应的 AI 消息中。"
          disabled={!settings.enabled}
        >
          <Toggle
            checked={
              settings.runtime
                .saveToolHistory
            }
            label="保存工具记录"
            onChange={(saveToolHistory) => {
              updateRuntime({
                saveToolHistory
              });
            }}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="只读工作区"
        description="只有这里授权的目录才能被工作区工具读取。环境变量中的工作区仍会作为附加来源。"
      >
        <SettingRow
          title="启用工作区工具"
          description="关闭后不会向模型提供任何文件读取和搜索工具。"
          disabled={!settings.enabled}
        >
          <Toggle
            checked={settings.workspace.enabled}
            label="启用工作区工具"
            testId="workspace-tools-enabled"
            onChange={(enabled) => {
              updateWorkspace({ enabled });
            }}
          />
        </SettingRow>

        <SettingRow
          title="包含应用启动目录"
          description="开发时通常是当前项目根目录；打包后建议另外添加明确工作区。"
          disabled={
            !settings.enabled ||
            !settings.workspace.enabled
          }
        >
          <Toggle
            checked={
              settings.workspace
                .includeProjectRoot
            }
            label="包含应用启动目录"
            onChange={(includeProjectRoot) => {
              updateWorkspace({
                includeProjectRoot
              });
            }}
          />
        </SettingRow>

        <div className="workspace-editor">
          <div className="workspace-editor__header">
            <div>
              <strong>授权目录</strong>
              <span>
                使用相对路径时，工具会依次在这些目录中查找。
              </span>
            </div>
            <ActionButton
              disabled={
                !settings.enabled ||
                !settings.workspace.enabled
              }
              onClick={() => {
                void browseRoot();
              }}
            >
              浏览…
            </ActionButton>
          </div>

          <div className="workspace-editor__add">
            <TextInput
              value={rootDraft}
              placeholder="C:\\Projects\\Xixi"
              disabled={
                !settings.enabled ||
                !settings.workspace.enabled
              }
              onChange={setRootDraft}
            />
            <ActionButton
              disabled={
                !rootDraft.trim() ||
                !settings.enabled ||
                !settings.workspace.enabled
              }
              onClick={() => {
                addRoot(rootDraft);
              }}
            >
              添加
            </ActionButton>
          </div>

          <div className="workspace-root-list">
            {settings.workspace.roots.length === 0 ? (
              <div className="workspace-root-list__empty">
                尚未添加额外目录
              </div>
            ) : (
              settings.workspace.roots.map(
                (root) => (
                  <div
                    className="workspace-root-item"
                    key={root}
                  >
                    <code>{root}</code>
                    <button
                      type="button"
                      aria-label={`移除 ${root}`}
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
                      ×
                    </button>
                  </div>
                )
              )
            )}
          </div>
        </div>

        <details className="settings-disclosure">
          <summary>读取与搜索上限</summary>
          <div className="settings-disclosure__body">
            <SettingRow
              title="文本文件上限"
              description="超过此大小的文件不会按文本读取或搜索。"
            >
              <Slider
                value={
                  settings.workspace
                    .maxTextFileBytes
                }
                min={250000}
                max={20000000}
                step={250000}
                formatValue={formatBytes}
                disabled={
                  !settings.enabled ||
                  !settings.workspace.enabled
                }
                onChange={(maxTextFileBytes) => {
                  updateWorkspace({
                    maxTextFileBytes
                  });
                }}
              />
            </SettingRow>
            <SettingRow
              title="单次读取行数"
              description="限制 read_text_file 一次最多返回的行数。"
            >
              <Slider
                value={
                  settings.workspace
                    .maxReadLines
                }
                min={50}
                max={5000}
                step={50}
                unit=" 行"
                disabled={
                  !settings.enabled ||
                  !settings.workspace.enabled
                }
                onChange={(maxReadLines) => {
                  updateWorkspace({
                    maxReadLines
                  });
                }}
              />
            </SettingRow>
            <SettingRow
              title="目录项目上限"
              description="限制 list_directory 单次返回的项目数量。"
            >
              <Slider
                value={
                  settings.workspace
                    .maxDirectoryEntries
                }
                min={20}
                max={1000}
                step={20}
                unit=" 项"
                disabled={
                  !settings.enabled ||
                  !settings.workspace.enabled
                }
                onChange={(maxDirectoryEntries) => {
                  updateWorkspace({
                    maxDirectoryEntries
                  });
                }}
              />
            </SettingRow>
            <SettingRow
              title="搜索结果上限"
              description="限制文件搜索和文本搜索的单次结果数量。"
            >
              <Slider
                value={
                  settings.workspace
                    .maxSearchResults
                }
                min={10}
                max={500}
                step={10}
                unit=" 条"
                disabled={
                  !settings.enabled ||
                  !settings.workspace.enabled
                }
                onChange={(maxSearchResults) => {
                  updateWorkspace({
                    maxSearchResults
                  });
                }}
              />
            </SettingRow>
            <SettingRow
              title="搜索深度"
              description="限制递归进入子目录的层数。"
            >
              <Slider
                value={
                  settings.workspace
                    .maxSearchDepth
                }
                min={1}
                max={12}
                unit=" 层"
                disabled={
                  !settings.enabled ||
                  !settings.workspace.enabled
                }
                onChange={(maxSearchDepth) => {
                  updateWorkspace({
                    maxSearchDepth
                  });
                }}
              />
            </SettingRow>
            <SettingRow
              title="哈希文件上限"
              description="超过此大小的文件不会整体读入内存计算 SHA-256。"
            >
              <Slider
                value={
                  settings.workspace
                    .maxHashFileBytes
                }
                min={1000000}
                max={200000000}
                step={1000000}
                formatValue={formatBytes}
                disabled={
                  !settings.enabled ||
                  !settings.workspace.enabled
                }
                onChange={(maxHashFileBytes) => {
                  updateWorkspace({
                    maxHashFileBytes
                  });
                }}
              />
            </SettingRow>
          </div>
        </details>
      </SettingsSection>

      <SettingsSection
        title="工具权限"
        description="先按 Toolset 控制一组能力，再按单个工具做精细调整。"
      >
        <div className="toolset-grid">
          {TOOLSET_OPTIONS.map(
            (toolset) => {
              const enabled =
                settings.toolsets[
                  toolset.id
                ] !== false;

              return (
                <div
                  className={`toolset-card${
                    enabled
                      ? " is-enabled"
                      : ""
                  }`}
                  key={toolset.id}
                >
                  <div className="toolset-card__top">
                    <div>
                      <span>
                        {toolset.risk}
                      </span>
                      <strong>
                        {toolset.title}
                      </strong>
                    </div>
                    <Toggle
                      checked={enabled}
                      disabled={!settings.enabled}
                      label={`启用 ${toolset.title}`}
                      onChange={(value) => {
                        onUpdate({
                          profile: "custom",
                          toolsets: {
                            ...settings.toolsets,
                            [toolset.id]: value
                          }
                        });
                      }}
                    />
                  </div>
                  <p>{toolset.description}</p>
                  <small>
                    {toolset.tools.length} 个工具
                  </small>
                </div>
              );
            }
          )}
        </div>

        <details className="settings-disclosure tool-list-disclosure">
          <summary>单个工具</summary>
          <div className="tool-list-groups">
            {TOOLSET_OPTIONS.map(
              (toolset) => (
                <div
                  className="tool-list-group"
                  key={toolset.id}
                >
                  <div className="tool-list-group__title">
                    {toolset.title}
                  </div>
                  {toolset.tools.map(
                    (tool) => (
                      <div
                        className="tool-list-item"
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
                        </div>
                        <Toggle
                          checked={
                            settings.overrides[
                              tool.name
                            ] !== false
                          }
                          disabled={
                            !settings.enabled ||
                            settings.toolsets[
                              toolset.id
                            ] === false ||
                            (
                              toolset.id ===
                                "workspace.read" &&
                              !settings.workspace.enabled
                            )
                          }
                          label={`启用 ${tool.title}`}
                          testId={`tool-toggle-${tool.name}`}
                          onChange={(value) => {
                            onUpdate({
                              profile: "custom",
                              overrides: {
                                ...settings.overrides,
                                [tool.name]: value
                              }
                            });
                          }}
                        />
                      </div>
                    )
                  )}
                </div>
              )
            )}
          </div>
        </details>

        <div className="tool-safety-note">
          <strong>固定安全边界</strong>
          <span>
            当前版本不会在 Setting 中开放敏感文件、符号链接逃逸、写文件、命令执行或任意联网权限。这些保护不受预设和单工具开关影响。
          </span>
        </div>
      </SettingsSection>
    </>
  );
}
