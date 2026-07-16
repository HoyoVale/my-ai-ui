import {
  SettingRow,
  SettingsSection,
  Slider,
  Toggle
} from "../components/Controls.jsx";

export function PetPanel({
  settings,
  onUpdate
}) {
  const pet =
    settings.pet;

  return (
    <>
      <SettingsSection
        title="尺寸与透明度"
        description="修改后会立即应用到桌宠窗口。"
      >
        <SettingRow
          title="桌宠尺寸"
          description="以原始 300 × 420 窗口为 100%。"
        >
          <Slider
            value={
              pet.scale
            }
            min={0.7}
            max={1.4}
            step={0.05}
            formatValue={(value) =>
              `${Math.round(
                value * 100
              )}%`
            }
            onChange={(value) => {
              onUpdate({
                scale: value
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="窗口透明度"
          description="只影响整个桌宠窗口，不影响点击区域。"
        >
          <Slider
            value={
              pet.opacity
            }
            min={0.4}
            max={1}
            step={0.05}
            formatValue={(value) =>
              `${Math.round(
                value * 100
              )}%`
            }
            onChange={(value) => {
              onUpdate({
                opacity: value
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="阴影强度"
          description="控制桌宠图片下方的柔和阴影。"
        >
          <Slider
            value={
              pet.shadowOpacity
            }
            min={0}
            max={0.45}
            step={0.01}
            formatValue={(value) =>
              `${Math.round(
                value * 100
              )}%`
            }
            onChange={(value) => {
              onUpdate({
                shadowOpacity:
                  value
              });
            }}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="窗口行为"
        description="控制桌宠与其他桌面窗口的关系。"
      >
        <SettingRow
          title="始终置顶"
          description="让桌宠保持在普通窗口上方。"
        >
          <Toggle
            checked={
              pet.alwaysOnTop
            }
            label="桌宠始终置顶"
            onChange={(value) => {
              onUpdate({
                alwaysOnTop:
                  value
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="显示在任务栏"
          description="关闭后桌宠不会占用任务栏位置。"
        >
          <Toggle
            checked={
              pet.showInTaskbar
            }
            label="桌宠显示在任务栏"
            onChange={(value) => {
              onUpdate({
                showInTaskbar:
                  value
              });
            }}
          />
        </SettingRow>
      </SettingsSection>
    </>
  );
}
