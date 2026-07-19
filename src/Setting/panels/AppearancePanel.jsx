import {
  useState
} from "react";

import {
  ColorSwatches,
  Segmented,
  Select,
  SettingRow,
  SettingsSection,
  Slider,
  TextInput,
  Toggle
} from "../components/Controls.jsx";

const THEME_OPTIONS = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" }
];

const ACCENT_OPTIONS = [
  { value: "#10a37f", label: "ChatGPT 绿" },
  { value: "#5b7cfa", label: "蓝色" },
  { value: "#6366f1", label: "靛蓝" },
  { value: "#7c5ce6", label: "紫色" },
  { value: "#d65f8d", label: "玫红" },
  { value: "#e05252", label: "红色" },
  { value: "#e08a35", label: "橙色" },
  { value: "#16a394", label: "青绿色" }
];

const FONT_OPTIONS = [
  { value: "system", label: "系统默认" },
  { value: "humanist", label: "现代无衬线" },
  { value: "serif", label: "衬线字体" },
  { value: "monospace", label: "等宽字体" },
  { value: "custom", label: "自定义" }
];

const DENSITY_OPTIONS = [
  { value: "compact", label: "紧凑" },
  { value: "comfortable", label: "舒适" },
  { value: "spacious", label: "宽松" }
];

const WINDOW_OPTIONS = [
  { value: "conversation", label: "对话窗口" },
  { value: "response", label: "回复窗口" },
  { value: "input", label: "输入窗口" },
  { value: "memory", label: "记忆窗口" },
  { value: "setting", label: "设置窗口" },
  { value: "pet", label: "桌宠菜单" }
];

export function AppearancePanel({
  settings,
  onUpdate
}) {
  const appearance =
    settings.appearance;

  const [activeWindowId, setActiveWindowId] =
    useState("conversation");

  const typography =
    appearance.typography[
      activeWindowId
    ];

  const updateWindowTypography =
    (windowId, patch) => {
      onUpdate({
        typography: {
          ...appearance.typography,
          [windowId]: {
            ...appearance.typography[
              windowId
            ],
            ...patch
          }
        }
      });
    };

  return (
    <>
      <SettingsSection title="主题">
        <div className="settings-section__standalone">
          <Segmented
            value={appearance.theme}
            options={THEME_OPTIONS}
            onChange={(theme) => {
              onUpdate({ theme });
            }}
          />
        </div>
      </SettingsSection>

      <SettingsSection title="强调色">
        <div className="settings-section__standalone">
          <ColorSwatches
            value={appearance.accentColor}
            options={ACCENT_OPTIONS}
            onChange={(accentColor) => {
              onUpdate({ accentColor });
            }}
          />
        </div>
      </SettingsSection>
      <SettingsSection title="全局字体">
        <SettingRow title="字体族">
          <Select
            testId="appearance-font-family"
            value={appearance.fontFamily}
            options={FONT_OPTIONS}
            onChange={(fontFamily) => {
              onUpdate({ fontFamily });
            }}
          />
        </SettingRow>

        {appearance.fontFamily === "custom" && (
          <SettingRow title="自定义字体">
            <TextInput
              testId="appearance-custom-font"
              value={appearance.customFontFamily}
              placeholder="Segoe UI Variable, Microsoft YaHei UI"
              onChange={(customFontFamily) => {
                onUpdate({
                  customFontFamily
                });
              }}
            />
          </SettingRow>
        )}
      </SettingsSection>

      <SettingsSection title="窗口排版">
        <div className="settings-section__standalone settings-typography-window-picker">
          <Select
            testId="appearance-typography-window"
            value={activeWindowId}
            options={WINDOW_OPTIONS}
            onChange={setActiveWindowId}
          />
        </div>

        <SettingRow title="字号">
          <Slider
            value={typography.fontSize}
            min={10}
            max={28}
            step={1}
            unit=" px"
            onChange={(fontSize) => {
              updateWindowTypography(
                activeWindowId,
                { fontSize }
              );
            }}
          />
        </SettingRow>

        <SettingRow title="行高">
          <Slider
            value={typography.lineHeight}
            min={1.1}
            max={2.4}
            step={0.05}
            formatValue={(value) =>
              value.toFixed(2)
            }
            onChange={(lineHeight) => {
              updateWindowTypography(
                activeWindowId,
                { lineHeight }
              );
            }}
          />
        </SettingRow>

        <SettingRow title="字距">
          <Slider
            value={typography.letterSpacing ?? 0}
            min={-0.03}
            max={0.05}
            step={0.001}
            formatValue={(value) =>
              `${value.toFixed(3)} em`
            }
            onChange={(letterSpacing) => {
              updateWindowTypography(
                activeWindowId,
                { letterSpacing }
              );
            }}
          />
        </SettingRow>

        <SettingRow title="界面间距">
          <Segmented
            testId="appearance-density"
            value={typography.density}
            options={DENSITY_OPTIONS}
            onChange={(density) => {
              updateWindowTypography(
                activeWindowId,
                { density }
              );
            }}
          />
        </SettingRow>

        <div
          className="settings-typography-preview"
          style={{
            fontSize:
              `${typography.fontSize}px`,
            lineHeight:
              typography.lineHeight,
            letterSpacing:
              `${typography.letterSpacing ?? 0}em`
          }}
        >
          <span>排版预览</span>
          <p>
            清晰、稳定的文字节奏，适合持续阅读长对话。
          </p>
        </div>
      </SettingsSection>

      <SettingsSection title="对话阅读布局">
        <SettingRow title="内容宽度">
          <Slider
            value={
              appearance.typography
                .conversation
                .contentWidth ?? 768
            }
            min={560}
            max={1080}
            step={8}
            unit=" px"
            onChange={(contentWidth) => {
              updateWindowTypography(
                "conversation",
                { contentWidth }
              );
            }}
          />
        </SettingRow>

        <SettingRow title="消息间距">
          <Slider
            value={
              appearance.typography
                .conversation
                .messageSpacing ?? 34
            }
            min={16}
            max={72}
            step={1}
            unit=" px"
            onChange={(messageSpacing) => {
              updateWindowTypography(
                "conversation",
                { messageSpacing }
              );
            }}
          />
        </SettingRow>

        <SettingRow title="段落间距">
          <Slider
            value={
              appearance.typography
                .conversation
                .paragraphSpacing ?? 1
            }
            min={0.5}
            max={1.8}
            step={0.05}
            formatValue={(value) =>
              `${value.toFixed(2)} em`
            }
            onChange={(paragraphSpacing) => {
              updateWindowTypography(
                "conversation",
                { paragraphSpacing }
              );
            }}
          />
        </SettingRow>
      </SettingsSection>
<SettingsSection title="动画">
        <SettingRow title="减少动态效果">
          <Toggle
            checked={appearance.reducedMotion}
            label="减少动态效果"
            onChange={(reducedMotion) => {
              onUpdate({ reducedMotion });
            }}
          />
        </SettingRow>
      </SettingsSection>
    </>
  );
}
