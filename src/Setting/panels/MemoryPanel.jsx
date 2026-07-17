import {
  ActionButton,
  SettingRow,
  SettingsSection,
  Slider,
  Toggle
} from "../components/Controls.jsx";

import {
  useMemories
} from "../hooks/useMemories.js";

export function MemoryPanel({
  settings,
  onUpdate
}) {
  const memory =
    settings.memory;

  const {
    state,
    busy,
    error,
    clear
  } = useMemories();

  const handleClear = async () => {
    if (
      !window.confirm(
        "确定清空全部长期记忆吗？此操作无法撤销。"
      )
    ) {
      return;
    }

    await clear();
  };

  return (
    <>
      <SettingsSection
        title="记忆检索"
        description="控制哪些长期记忆可以参与模型回复。第一版只支持手动保存，不会自动分析聊天内容。"
      >
        <SettingRow
          title="启用长期记忆"
          description="关闭后仍保留记忆数据，但不会注入模型上下文。"
        >
          <Toggle
            checked={memory.enabled}
            label="启用长期记忆"
            onChange={(enabled) => {
              onUpdate({
                enabled
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="每次最多注入"
          description="限制单次请求使用的记忆条数，避免长期信息占用过多上下文。"
          disabled={!memory.enabled}
        >
          <Slider
            value={
              memory.maxInjected
            }
            min={1}
            max={20}
            step={1}
            unit=" 条"
            onChange={(maxInjected) => {
              onUpdate({
                maxInjected
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="最低优先级"
          description="优先级低于该阈值的记忆不会参与检索。"
          disabled={!memory.enabled}
        >
          <Slider
            value={
              memory.minPriority
            }
            min={0}
            max={1}
            step={0.05}
            formatValue={(value) =>
              `${Math.round(
                value * 100
              )}%`
            }
            onChange={(minPriority) => {
              onUpdate({
                minPriority
              });
            }}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="记忆数据"
        description="查看和维护用户明确保存的长期信息。"
      >
        <div className="memory-setting-summary">
          <div>
            <strong>
              {state.totalMemories}
            </strong>
            <span>总记忆</span>
          </div>
          <div>
            <strong>
              {state.enabledMemories}
            </strong>
            <span>已启用</span>
          </div>
          <ActionButton
            onClick={() => {
              window.api
                ?.openMemory?.();
            }}
          >
            打开记忆管理
          </ActionButton>
        </div>

        {error && (
          <div className="conversation-error">
            {error}
          </div>
        )}

        <div className="conversation-danger-zone">
          <div>
            <strong>清空长期记忆</strong>
            <span>
              删除全部 {state.totalMemories} 条长期记忆，不影响会话历史。
            </span>
          </div>

          <ActionButton
            tone="danger"
            disabled={
              busy ||
              state.totalMemories === 0
            }
            onClick={() => {
              void handleClear();
            }}
          >
            清空全部记忆
          </ActionButton>
        </div>
      </SettingsSection>
    </>
  );
}
