import {
  ActionButton,
  SettingRow,
  SettingsSection,
  Slider,
  Toggle
} from "../components/Controls.jsx";

import {
  useConversations
} from "../hooks/useConversations.js";

export function ConversationPanel({
  settings,
  onUpdate
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
        title="短期上下文"
        description="控制每次请求向模型发送多少轮最近对话。当前用户消息始终会被包含。"
      >
        <SettingRow
          title="上下文轮数"
          description="轮数越高，连续对话能力越强，但请求消耗也会增加。"
        >
          <Slider
            value={
              settings
                .contextTurns
            }
            min={1}
            max={50}
            unit=" 轮"
            onChange={(
              contextTurns
            ) => {
              onUpdate({
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
              settings
                .maxConversations
            }
            min={10}
            max={500}
            step={10}
            unit=" 个"
            onChange={(
              maxConversations
            ) => {
              onUpdate({
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
              settings.autoTitle
            }
            label="自动生成会话标题"
            onChange={(
              autoTitle
            ) => {
              onUpdate({
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
              settings
                .saveAbortedReplies
            }
            label="保存中止的回复"
            onChange={(
              saveAbortedReplies
            ) => {
              onUpdate({
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
