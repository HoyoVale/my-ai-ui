import {
  SettingRow,
  SettingsSection,
  Slider,
  TextInput,
  Toggle
} from "../components/Controls.jsx";

export function InputPanel({
  settings,
  onUpdate
}) {
  const input =
    settings.input;

  return (
    <>
      <SettingsSection
        title="窗口布局"
        description="输入框宽度以桌宠窗口为基准计算。"
      >
        <SettingRow
          title="额外宽度"
          description="在桌宠宽度基础上向左右扩展。"
        >
          <Slider
            value={
              input.extraWidth
            }
            min={0}
            max={600}
            step={10}
            unit=" px"
            onChange={(value) => {
              onUpdate({
                extraWidth: value
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="与桌宠间距"
          description="输入窗口与桌宠底部之间的距离。"
        >
          <Slider
            value={
              input.gap
            }
            min={0}
            max={120}
            step={1}
            unit=" px"
            onChange={(value) => {
              onUpdate({
                gap: value
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="最大文本行数"
          description="超过后输入框内部出现滚动条。"
        >
          <Slider
            value={
              input.maxLines
            }
            min={1}
            max={20}
            step={1}
            unit=" 行"
            onChange={(value) => {
              onUpdate({
                maxLines: value
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="始终置顶"
          description="让输入窗口保持在普通窗口上方。"
        >
          <Toggle
            checked={
              input.alwaysOnTop
            }
            label="输入窗口始终置顶"
            onChange={(value) => {
              onUpdate({
                alwaysOnTop:
                  value
              });
            }}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="文字与外观"
        description="调整输入框的可读性和视觉密度。"
      >
        <SettingRow
          title="字号"
          description="输入文字和占位文本的字号。"
        >
          <Slider
            value={
              input.fontSize
            }
            min={10}
            max={28}
            step={1}
            unit=" px"
            onChange={(value) => {
              onUpdate({
                fontSize: value
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="背景不透明度"
          description="降低后可看到窗口后方内容。"
        >
          <Slider
            value={
              input
                .backgroundOpacity
            }
            min={0.2}
            max={1}
            step={0.01}
            formatValue={(value) =>
              `${Math.round(
                value * 100
              )}%`
            }
            onChange={(value) => {
              onUpdate({
                backgroundOpacity:
                  value
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="圆角"
          description="输入窗口外框的圆角半径。"
        >
          <Slider
            value={
              input.borderRadius
            }
            min={0}
            max={48}
            step={1}
            unit=" px"
            onChange={(value) => {
              onUpdate({
                borderRadius:
                  value
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="占位文字"
          description="输入框为空时显示的提示。"
        >
          <TextInput
            value={
              input.placeholder
            }
            placeholder="Type a message..."
            onChange={(value) => {
              onUpdate({
                placeholder:
                  value
              });
            }}
          />
        </SettingRow>
      </SettingsSection>
    </>
  );
}
