import {
  ActionButton,
  SettingRow,
  SettingsSection,
  Segmented,
  Select,
  Slider,
  Toggle
} from "../components/Controls.jsx";

import {
  useConversations
} from "../hooks/useConversations.js";

const ENVIRONMENT_PROFILES = {
  minimal: {
    profile: "minimal",
    includeTime: true,
    includeLocale: false,
    includeSystem: false,
    includeApplication: false,
    includeModel: true,
    includeWorkspace: false,
    includeTools: false,
    workspaceDetail: "hidden",
    toolDetail: "hidden"
  },
  standard: {
    profile: "standard",
    includeTime: true,
    includeLocale: true,
    includeSystem: true,
    includeApplication: true,
    includeModel: true,
    includeWorkspace: true,
    includeTools: true,
    workspaceDetail: "summary",
    toolDetail: "profile"
  },
  detailed: {
    profile: "detailed",
    includeTime: true,
    includeLocale: true,
    includeSystem: true,
    includeApplication: true,
    includeModel: true,
    includeWorkspace: true,
    includeTools: true,
    workspaceDetail: "full",
    toolDetail: "names"
  }
};

export function ConversationPanel({
  conversationSettings,
  contextSettings,
  onUpdateConversation,
  onUpdateContext
}) {
  const {
    state,
    conversations,
    status,
    error,
    create,
    clear
  } = useConversations();

  const isWorking =
    status === "working";

  const environment =
    contextSettings.environment;

  const updateEnvironment = (patch) => {
    onUpdateContext({
      environment: {
        ...environment,
        ...patch
      }
    });
  };

  const setEnvironmentProfile = (profile) => {
    const preset =
      ENVIRONMENT_PROFILES[profile];

    if (!preset) {
      updateEnvironment({
        profile: "custom"
      });
      return;
    }

    updateEnvironment(preset);
  };

  const updateEnvironmentField = (
    field,
    value
  ) => {
    updateEnvironment({
      profile: "custom",
      [field]: value
    });
  };

  const handleClear = async () => {
    const confirmed =
      window.confirm(
        "确定删除全部会话记录吗？此操作无法撤销。"
      );

    if (!confirmed) {
      return;
    }

    await clear();
  };

  return (
    <>
      <SettingsSection
        title="运行环境上下文"
        description="每轮请求前由应用实时生成。默认只注入完成任务所需的信息，不包含凭据或任意文件内容。"
      >
        <SettingRow
          title="注入运行环境"
          description="关闭后模型仍可主动调用时间和运行状态工具，但不会自动收到环境快照。"
        >
          <Toggle
            checked={environment.enabled}
            label="注入运行环境"
            testId="runtime-context-enabled"
            onChange={(enabled) => {
              updateEnvironment({ enabled });
            }}
          />
        </SettingRow>

        <SettingRow
          title="信息级别"
          description="标准模式适合日常使用；详细模式会增加完整工作区路径、工具名称与运行时版本。"
          disabled={!environment.enabled}
        >
          <Segmented
            value={environment.profile}
            testId="runtime-context-profile"
            disabled={!environment.enabled}
            options={[
              { value: "minimal", label: "精简" },
              { value: "standard", label: "标准" },
              { value: "detailed", label: "详细" },
              { value: "custom", label: "自定义" }
            ]}
            onChange={setEnvironmentProfile}
          />
        </SettingRow>

        <div className="runtime-context-summary">
          <span className={environment.includeTime ? "is-on" : ""}>时间</span>
          <span className={environment.includeSystem ? "is-on" : ""}>系统</span>
          <span className={environment.includeModel ? "is-on" : ""}>模型</span>
          <span className={environment.includeWorkspace ? "is-on" : ""}>工作区</span>
          <span className={environment.includeTools ? "is-on" : ""}>工具</span>
        </div>

        <details className="settings-disclosure">
          <summary>自定义包含内容</summary>
          <div className="settings-disclosure__body">
            {[
              ["includeTime", "日期、时间与时区", "让模型知道当前本地时间和 UTC。"],
              ["includeLocale", "区域语言", "注入系统 Locale，辅助日期和语言格式。"],
              ["includeSystem", "操作系统", "注入平台、系统版本和 CPU 架构。"],
              ["includeApplication", "应用与运行时", "注入应用版本；详细模式还包含 Node、Electron 和 Chromium。"],
              ["includeModel", "当前模型", "注入 Provider、模型 ID 和上下文上限。"],
              ["includeWorkspace", "工作区摘要", "注入授权目录数量或完整路径。"],
              ["includeTools", "工具摘要", "注入当前工具预设、数量或工具名称。"]
            ].map(([field, title, description]) => (
              <SettingRow
                key={field}
                title={title}
                description={description}
                disabled={!environment.enabled}
              >
                <Toggle
                  checked={environment[field]}
                  disabled={!environment.enabled}
                  label={title}
                  onChange={(value) => {
                    updateEnvironmentField(field, value);
                  }}
                />
              </SettingRow>
            ))}

            <SettingRow
              title="工作区信息"
              description="摘要只说明授权目录数量；完整会把路径发送给当前模型。"
              disabled={!environment.enabled || !environment.includeWorkspace}
            >
              <Select
                value={environment.workspaceDetail}
                disabled={!environment.enabled || !environment.includeWorkspace}
                options={[
                  { value: "hidden", label: "不显示" },
                  { value: "summary", label: "仅摘要" },
                  { value: "full", label: "完整路径" }
                ]}
                onChange={(workspaceDetail) => {
                  updateEnvironmentField("workspaceDetail", workspaceDetail);
                }}
              />
            </SettingRow>

            <SettingRow
              title="工具信息"
              description="默认只发送预设和数量；工具名称模式会增加上下文占用。"
              disabled={!environment.enabled || !environment.includeTools}
            >
              <Select
                value={environment.toolDetail}
                disabled={!environment.enabled || !environment.includeTools}
                options={[
                  { value: "hidden", label: "不显示" },
                  { value: "profile", label: "预设与数量" },
                  { value: "names", label: "工具名称" }
                ]}
                onChange={(toolDetail) => {
                  updateEnvironmentField("toolDetail", toolDetail);
                }}
              />
            </SettingRow>
          </div>
        </details>
      </SettingsSection>

      <SettingsSection
        title="短期上下文"
        description="控制每次请求向模型发送多少轮最近对话。当前用户消息始终会被包含。"
      >
        <SettingRow
          title="上下文轮数"
          description="轮数越高，连续对话能力越强，但请求消耗也会增加。"
        >
          <Slider
            value={
              conversationSettings
                .contextTurns
            }
            min={1}
            max={50}
            unit=" 轮"
            onChange={(
              contextTurns
            ) => {
              onUpdateConversation({
                contextTurns
              });
            }}
          />
        </SettingRow>

      </SettingsSection>

      <SettingsSection
        title="保存策略"
        description="控制历史会话的数量、标题与未完成回复。"
      >
        <SettingRow
          title="最多保留会话"
          description="超过上限时自动删除最久未更新的会话。"
        >
          <Slider
            value={
              conversationSettings
                .maxConversations
            }
            min={10}
            max={500}
            step={10}
            unit=" 个"
            onChange={(
              maxConversations
            ) => {
              onUpdateConversation({
                maxConversations
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="自动生成标题"
          description="使用第一条用户消息生成简短会话标题。"
        >
          <Toggle
            checked={
              conversationSettings.autoTitle
            }
            label="自动生成会话标题"
            onChange={(
              autoTitle
            ) => {
              onUpdateConversation({
                autoTitle
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="保存中止的回复"
          description="停止生成时保留已收到的文字，但不把它加入后续模型上下文。"
        >
          <Toggle
            checked={
              conversationSettings
                .saveAbortedReplies
            }
            label="保存中止的回复"
            onChange={(
              saveAbortedReplies
            ) => {
              onUpdateConversation({
                saveAbortedReplies
              });
            }}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="会话数据"
        description="完整消息浏览、切换和单个删除操作已集中到会话窗口。"
      >
        <div className="conversation-current">
          <div>
            <span>当前会话</span>

            <strong>
              {state
                .currentConversation
                ?.title ??
                "尚未创建会话"}
            </strong>

            <small>
              {state
                .currentConversation
                ? `${
                    state
                      .currentConversation
                      .messageCount
                  } 条消息 · 共 ${state.totalConversations} 个会话`
                : "发送第一条消息时将自动创建"}
            </small>
          </div>

          <div className="conversation-current__actions">
            <ActionButton
              disabled={isWorking}
              onClick={() => {
                window.api
                  ?.openConversation?.();
              }}
            >
              打开会话记录
            </ActionButton>

            <ActionButton
              disabled={isWorking}
              onClick={() => {
                void create();
              }}
            >
              新建会话
            </ActionButton>
          </div>
        </div>

        {error && (
          <div className="conversation-error">
            {error}
          </div>
        )}

        <div className="conversation-danger-zone">
          <div>
            <strong>清空会话数据</strong>
            <span>
              删除当前保存的 {conversations.length} 个会话，此操作无法撤销。
            </span>
          </div>

          <ActionButton
            tone="danger"
            disabled={
              isWorking ||
              conversations.length === 0
            }
            onClick={() => {
              void handleClear();
            }}
          >
            清空全部会话
          </ActionButton>
        </div>
      </SettingsSection>
    </>
  );
}
