import {
  Select,
  SettingRow,
  SettingsSection,
  Slider,
  Toggle
} from "../components/Controls.jsx";

const SIDE_OPTIONS = [
  {
    value: "auto",
    label: "自动"
  },
  {
    value: "right",
    label: "固定右侧"
  },
  {
    value: "left",
    label: "固定左侧"
  }
];

const AUTO_CLOSE_OPTIONS = [
  {
    value: 0,
    label: "手动关闭"
  },
  {
    value: 3,
    label: "3 秒后"
  },
  {
    value: 5,
    label: "5 秒后"
  },
  {
    value: 10,
    label: "10 秒后"
  },
  {
    value: 20,
    label: "20 秒后"
  },
  {
    value: 30,
    label: "30 秒后"
  },
  {
    value: 60,
    label: "60 秒后"
  }
];

export function ResponsePanel({
  settings,
  onUpdate
}) {
  const response =
    settings.response;

  return (
    <>
      <SettingsSection
        title="位置"
        description="控制回复气泡相对桌宠的停靠方式。"
      >
        <SettingRow
          title="停靠方向"
          description="自动模式会优先选择屏幕空间充足的一侧。"
        >
          <Select
            value={
              response
                .preferredSide
            }
            options={
              SIDE_OPTIONS
            }
            onChange={(value) => {
              onUpdate({
                preferredSide:
                  value
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="与桌宠间距"
          description="气泡与桌宠窗口之间的水平距离。"
        >
          <Slider
            value={
              response.gap
            }
            min={0}
            max={160}
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
          title="垂直锚点"
          description="气泡相对桌宠顶部向下停靠的位置。"
        >
          <Slider
            value={
              response
                .anchorRatio
            }
            min={0}
            max={1}
            step={0.02}
            formatValue={(value) =>
              `${Math.round(
                value * 100
              )}%`
            }
            onChange={(value) => {
              onUpdate({
                anchorRatio:
                  value
              });
            }}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="尺寸"
        description="限制气泡在长文本下的最大范围。"
      >
        <SettingRow
          title="最大宽度"
          description="达到上限后文本自动换行。"
        >
          <Slider
            value={
              response
                .bubbleMaxWidth
            }
            min={180}
            max={1000}
            step={10}
            unit=" px"
            onChange={(value) => {
              onUpdate({
                bubbleMaxWidth:
                  value
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="最大内容高度"
          description="达到上限后气泡内部出现滚动条。"
        >
          <Slider
            value={
              response
                .contentMaxHeight
            }
            min={80}
            max={900}
            step={10}
            unit=" px"
            onChange={(value) => {
              onUpdate({
                contentMaxHeight:
                  value
              });
            }}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="文字与外观"
        description="调整回复气泡的阅读体验。"
      >
        <SettingRow
          title="字号"
          description="回复正文使用的字体大小。"
        >
          <Slider
            value={
              response.fontSize
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
          title="行高"
          description="控制多行文本之间的垂直间距。"
        >
          <Slider
            value={
              response.lineHeight
            }
            min={1.1}
            max={2.4}
            step={0.05}
            formatValue={(value) =>
              value.toFixed(2)
            }
            onChange={(value) => {
              onUpdate({
                lineHeight:
                  value
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="背景不透明度"
          description="降低后可看到气泡后方内容。"
        >
          <Slider
            value={
              response
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
          description="回复气泡主体的圆角半径。"
        >
          <Slider
            value={
              response
                .borderRadius
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
      </SettingsSection>

      <SettingsSection
        title="行为"
        description="控制回复结束后的显示方式。"
      >
        <SettingRow
          title="始终置顶"
          description="让回复气泡保持在普通窗口上方。"
        >
          <Toggle
            checked={
              response
                .alwaysOnTop
            }
            label="回复气泡始终置顶"
            onChange={(value) => {
              onUpdate({
                alwaysOnTop:
                  value
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="回复完成后关闭"
          description="流式输出结束后自动隐藏气泡。"
        >
          <Select
            value={
              response
                .autoCloseSeconds
            }
            options={
              AUTO_CLOSE_OPTIONS
            }
            onChange={(value) => {
              onUpdate({
                autoCloseSeconds:
                  value
              });
            }}
          />
        </SettingRow>
      </SettingsSection>
    </>
  );
}
