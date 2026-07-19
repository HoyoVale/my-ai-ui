import {
  Segmented,
  Select,
  SettingRow,
  SettingsSection,
  SettingsVisibility,
  TextArea,
  TextInput,
  Toggle
} from "../components/Controls.jsx";

const LANGUAGE_OPTIONS = [
  {
    value: "auto",
    label: "跟随用户"
  },
  {
    value: "zh-CN",
    label: "简体中文"
  },
  {
    value: "en-US",
    label: "English"
  }
];

const TONE_OPTIONS = [
  {
    value: "natural",
    label: "自然"
  },
  {
    value: "friendly",
    label: "友好"
  },
  {
    value: "professional",
    label: "专业"
  },
  {
    value: "direct",
    label: "直接"
  }
];

const LENGTH_OPTIONS = [
  {
    value: "concise",
    label: "精简"
  },
  {
    value: "balanced",
    label: "平衡"
  },
  {
    value: "detailed",
    label: "详细"
  }
];

const TONE_LABELS =
  Object.fromEntries(
    TONE_OPTIONS.map(
      (option) => [
        option.value,
        option.label
      ]
    )
  );

const LENGTH_LABELS =
  Object.fromEntries(
    LENGTH_OPTIONS.map(
      (option) => [
        option.value,
        option.label
      ]
    )
  );

export function PersonalityPanel({
  settings,
  developerMode = false,
  onUpdate
}) {
  const personality =
    settings.personality;

  return (
    <>
      <div className="personality-preview">
        <div className="personality-preview__avatar">
          {personality.name
            .trim()
            .slice(0, 1)
            .toUpperCase() || "X"}
        </div>

        <div className="personality-preview__copy">
          <div>
            <strong>
              {personality.name ||
                "Xixi"}
            </strong>
            <span>
              {personality.enabled
                ? "人格已启用"
                : "使用基础助手行为"}
            </span>
          </div>

          <p>
            {personality.identity ||
              "桌面 AI 助手"}
          </p>

          <small>
            {TONE_LABELS[
              personality.tone
            ] ?? "自然"}
            语气 · {LENGTH_LABELS[
              personality
                .responseLength
            ] ?? "平衡"}
            篇幅
          </small>
        </div>
      </div>

      <SettingsSection
        title="人格开关"
        description="启用后，名称、身份和回复偏好会作为稳定系统上下文发送给模型。"
      >
        <SettingRow
          title="启用自定义人格"
          description="关闭时仍保留配置，但模型只使用基础助手规则。"
        >
          <Toggle
            checked={
              personality.enabled
            }
            label="启用自定义人格"
            testId="personality-enabled"
            onChange={(enabled) => {
              onUpdate({
                enabled
              });
            }}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsVisibility
        visibility="developer"
        developerMode={developerMode}
      >
      <SettingsSection
        title="身份"
        description="定义助手如何称呼自己，以及它在对话中的稳定定位。"
      >
        <SettingRow
          title="名称"
          description="用于人格上下文和界面预览。"
          disabled={
            !personality.enabled
          }
        >
          <TextInput
            value={personality.name}
            placeholder="Xixi"
            testId="personality-name"
            disabled={
              !personality.enabled
            }
            onChange={(name) => {
              onUpdate({
                name
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="身份描述"
          description="用一句话说明助手是谁，不要在这里保存用户信息。"
          disabled={
            !personality.enabled
          }
        >
          <TextInput
            value={
              personality.identity
            }
            placeholder="运行在用户桌面上的轻量 AI 助手"
            testId="personality-identity"
            disabled={
              !personality.enabled
            }
            onChange={(identity) => {
              onUpdate({
                identity
              });
            }}
          />
        </SettingRow>
      </SettingsSection>
      </SettingsVisibility>

      <SettingsSection
        title="回复偏好"
        description="控制默认语言、语气和篇幅。具体用户要求始终优先于这些默认设置。"
      >
        <SettingRow
          title="默认语言"
          description="跟随用户最适合多语言对话。"
          disabled={
            !personality.enabled
          }
        >
          <Segmented
            value={
              personality.language
            }
            testId="personality-language"
            options={
              LANGUAGE_OPTIONS
            }
            onChange={(language) => {
              onUpdate({
                language
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="语气"
          description="只影响表达方式，不改变事实与任务执行规则。"
          disabled={
            !personality.enabled
          }
        >
          <Select
            value={personality.tone}
            options={TONE_OPTIONS}
            testId="personality-tone"
            onChange={(tone) => {
              onUpdate({
                tone
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="回答篇幅"
          description="模型会结合问题复杂度调整，避免机械地固定长度。"
          disabled={
            !personality.enabled
          }
        >
          <Segmented
            value={
              personality
                .responseLength
            }
            testId="personality-length"
            options={
              LENGTH_OPTIONS
            }
            onChange={(
              responseLength
            ) => {
              onUpdate({
                responseLength
              });
            }}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="补充行为说明"
        description="只写助手应如何工作，例如表达习惯或固定规则；用户事实应放在长期记忆中。"
      >
        <div className="settings-section__standalone personality-instructions">
          <TextArea
            value={
              personality
                .customInstructions
            }
            placeholder="例如：回答代码问题时先说明修改位置，再给出完整代码；不确定时明确标注。"
            testId="personality-instructions"
            disabled={
              !personality.enabled
            }
            rows={7}
            maxLength={4000}
            onChange={(
              customInstructions
            ) => {
              onUpdate({
                customInstructions
              });
            }}
          />

          <div className="personality-instructions__footer">
            <span>
              每次模型请求都会携带这段说明。
            </span>
            <span>
              {personality
                .customInstructions
                .length}/4000
            </span>
          </div>
        </div>
      </SettingsSection>
    </>
  );
}
