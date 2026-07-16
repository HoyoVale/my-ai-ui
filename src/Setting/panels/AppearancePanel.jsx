import {
  ColorSwatches,
  Segmented,
  SettingRow,
  SettingsSection,
  Toggle
} from "../components/Controls.jsx";

const THEME_OPTIONS = [
  {
    value: "system",
    label: "跟随系统"
  },
  {
    value: "light",
    label: "浅色"
  },
  {
    value: "dark",
    label: "深色"
  }
];

const ACCENT_OPTIONS = [
  {
    value: "#10a37f",
    label: "ChatGPT 绿"
  },
  {
    value: "#5b7cfa",
    label: "蓝色"
  },
  {
    value: "#7c5ce6",
    label: "紫色"
  },
  {
    value: "#d65f8d",
    label: "玫红"
  },
  {
    value: "#e08a35",
    label: "橙色"
  }
];

export function AppearancePanel({
  settings,
  onUpdate
}) {
  const appearance =
    settings.appearance;

  return (
    <>
      <SettingsSection
        title="主题"
        description="同时应用于设置页、输入框、菜单和回复气泡。"
      >
        <div className="settings-section__standalone">
          <Segmented
            value={
              appearance.theme
            }
            options={
              THEME_OPTIONS
            }
            onChange={(value) => {
              onUpdate({
                theme: value
              });
            }}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="强调色"
        description="用于选中状态、流式光标和主要操作。"
      >
        <div className="settings-section__standalone">
          <ColorSwatches
            value={
              appearance
                .accentColor
            }
            options={
              ACCENT_OPTIONS
            }
            onChange={(value) => {
              onUpdate({
                accentColor:
                  value
              });
            }}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="动画"
        description="减少界面切换和弹出动画。"
      >
        <SettingRow
          title="减少动态效果"
          description="适合偏好更稳定界面或对动画敏感的用户。"
        >
          <Toggle
            checked={
              appearance
                .reducedMotion
            }
            label="减少动态效果"
            onChange={(value) => {
              onUpdate({
                reducedMotion:
                  value
              });
            }}
          />
        </SettingRow>
      </SettingsSection>
    </>
  );
}
