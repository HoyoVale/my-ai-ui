import {
  SettingRow,
  SettingsSection,
  SettingsVisibility,
  TextArea,
  TextInput,
  Toggle
} from "../components/Controls.jsx";

export function PersonalityPanel({ settings, developerMode = false, onUpdate }) {
  const personality = settings.personality;

  return (
    <>
      <SettingsSection title="人格">
        <SettingRow title="启用自定义人格">
          <Toggle
            checked={personality.enabled}
            label="启用自定义人格"
            testId="personality-enabled"
            onChange={(enabled) => onUpdate({ enabled })}
          />
        </SettingRow>
        <SettingRow title="名称" disabled={!personality.enabled}>
          <TextInput
            value={personality.name}
            placeholder="Xixi"
            testId="personality-name"
            disabled={!personality.enabled}
            maxLength={60}
            onChange={(name) => onUpdate({ name })}
          />
        </SettingRow>
        <SettingRow title="身份说明" disabled={!personality.enabled}>
          <TextInput
            value={personality.identity}
            placeholder="运行在用户桌面上的轻量 AI 助手"
            testId="personality-identity"
            disabled={!personality.enabled}
            maxLength={180}
            onChange={(identity) => onUpdate({ identity })}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="回复偏好"
        description="用自然语言描述希望助手如何选择语言、语气、结构和篇幅，不预设用户只能使用某几种语言。"
      >
        <div className="settings-section__standalone personality-instructions">
          <TextArea
            value={personality.responsePreferences ?? ""}
            placeholder="例如：跟随我使用的语言；先给结论；技术问题保持专业，日常交流自然；篇幅根据问题复杂度调整。"
            testId="personality-response-preferences"
            disabled={!personality.enabled}
            rows={5}
            maxLength={2000}
            onChange={(responsePreferences) => onUpdate({ responsePreferences })}
          />
          <div className="personality-instructions__footer">
            <span>不要在这里填写个人事实；个人事实应放在长期记忆。</span>
            <span>{(personality.responsePreferences ?? "").length}/2000</span>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="补充行为说明">
        <div className="settings-section__standalone personality-instructions">
          <TextArea
            value={personality.customInstructions}
            placeholder="例如：回答代码问题时先说明修改位置，再给出完整代码；不确定时明确标注。"
            testId="personality-instructions"
            disabled={!personality.enabled}
            rows={7}
            maxLength={4000}
            onChange={(customInstructions) => onUpdate({ customInstructions })}
          />
          <div className="personality-instructions__footer">
            <span>每次模型请求都会携带这段说明。</span>
            <span>{personality.customInstructions.length}/4000</span>
          </div>
        </div>
      </SettingsSection>

      <SettingsVisibility visible={developerMode}>
        <div className="settings-inline-note">
          旧版本的语言、语气和篇幅枚举仍会在加载时迁移，但不再作为 UI 选项。
        </div>
      </SettingsVisibility>
    </>
  );
}
