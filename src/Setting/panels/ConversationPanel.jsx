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

function formatDate(
  timestamp
) {
  if (!timestamp) {
    return "—";
  }

  return new Intl
    .DateTimeFormat(
      "zh-CN",
      {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }
    )
    .format(
      new Date(timestamp)
    );
}

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
    select,
    remove,
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
        description="会话数据保存在 Electron 用户数据目录中。"
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
          description="停止生成时保存已经收到的部分文字，但不会把它加入后续模型上下文。"
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
        title="当前会话"
        description="当前阶段由 Input 自动使用选中的会话。"
      >
        <div className="conversation-current">
          <div>
            <span>当前</span>

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
                  } 条消息`
                : "发送第一条消息时将自动创建"}
            </small>
          </div>

          <ActionButton
            disabled={isWorking}
            onClick={() => {
              void create();
            }}
          >
            新建会话
          </ActionButton>
        </div>

        {error && (
          <div className="conversation-error">
            {error}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="历史会话"
        description={`共 ${state.totalConversations} 个会话。`}
      >
        {conversations.length === 0 ? (
          <div className="conversation-empty">
            暂无会话记录
          </div>
        ) : (
          <div className="conversation-list">
            {conversations.map(
              (conversation) => {
                const isCurrent =
                  conversation.id ===
                  state
                    .currentConversationId;

                return (
                  <div
                    className={
                      `conversation-item${
                        isCurrent
                          ? " is-current"
                          : ""
                      }`
                    }
                    key={
                      conversation.id
                    }
                  >
                    <button
                      type="button"
                      className="conversation-item__main"
                      disabled={
                        isWorking
                      }
                      onClick={() => {
                        void select(
                          conversation.id
                        );
                      }}
                    >
                      <strong>
                        {conversation.title}
                      </strong>

                      <span>
                        {
                          conversation
                            .messageCount
                        } 条消息
                        ·{" "}
                        {formatDate(
                          conversation
                            .updatedAt
                        )}
                      </span>

                      {conversation.preview && (
                        <small>
                          {
                            conversation
                              .preview
                          }
                        </small>
                      )}
                    </button>

                    <button
                      type="button"
                      className="conversation-item__delete"
                      disabled={
                        isWorking
                      }
                      aria-label={`删除 ${conversation.title}`}
                      onClick={() => {
                        void remove(
                          conversation.id
                        );
                      }}
                    >
                      删除
                    </button>
                  </div>
                );
              }
            )}
          </div>
        )}

        <div className="conversation-danger-zone">
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
