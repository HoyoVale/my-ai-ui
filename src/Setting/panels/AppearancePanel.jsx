import { useId, useState } from "react";

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

const LATIN_FONT_SUGGESTIONS = [
  "Segoe UI Variable",
  "Inter",
  "Arial",
  "Helvetica",
  "Georgia",
  "Cascadia Code",
  "Consolas"
];

const CHINESE_FONT_SUGGESTIONS = [
  "Microsoft YaHei UI",
  "Microsoft YaHei",
  "PingFang SC",
  "Noto Sans CJK SC",
  "Source Han Sans SC",
  "Source Han Serif SC",
  "SimSun"
];

const LEGACY_LATIN_VALUES = Object.freeze({
  system: "",
  segoe: "Segoe UI Variable",
  inter: "Inter",
  arial: "Arial",
  georgia: "Georgia",
  cascadia: "Cascadia Code"
});

const LEGACY_CHINESE_VALUES = Object.freeze({
  system: "",
  yahei: "Microsoft YaHei UI",
  pingfang: "PingFang SC",
  notoSans: "Noto Sans CJK SC",
  sourceHanSans: "Source Han Sans SC",
  song: "Source Han Serif SC"
});

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

function editableFontValue(appearance, kind) {
  const familyKey = kind === "latin" ? "latinFontFamily" : "chineseFontFamily";
  const customKey = kind === "latin" ? "customLatinFontFamily" : "customChineseFontFamily";
  const family = appearance[familyKey] ?? "system";
  const custom = String(appearance[customKey] ?? "");
  if (family === "custom") return custom;
  const values = kind === "latin" ? LEGACY_LATIN_VALUES : LEGACY_CHINESE_VALUES;
  return values[family] ?? "";
}

function FontSuggestions({ id, values }) {
  return (
    <datalist id={id}>
      {values.map((value) => <option key={value} value={value} />)}
    </datalist>
  );
}

export function AppearancePanel({ settings, onUpdate }) {
  const appearance = settings.appearance;
  const [activeWindowId, setActiveWindowId] = useState("conversation");
  const latinFontListId = useId();
  const chineseFontListId = useId();
  const typography = appearance.typography[activeWindowId];

  const updateWindowTypography = (windowId, patch) => {
    onUpdate({
      typography: {
        ...appearance.typography,
        [windowId]: {
          ...appearance.typography[windowId],
          ...patch
        }
      }
    });
  };

  const updateFont = (kind, value) => {
    const customKey = kind === "latin" ? "customLatinFontFamily" : "customChineseFontFamily";
    const familyKey = kind === "latin" ? "latinFontFamily" : "chineseFontFamily";
    onUpdate({
      [customKey]: value,
      [familyKey]: value.trim() ? "custom" : "system"
    });
  };

  return (
    <>
      <SettingsSection title="主题">
        <div className="settings-section__standalone">
          <Segmented value={appearance.theme} options={THEME_OPTIONS} onChange={(theme) => onUpdate({ theme })} />
        </div>
      </SettingsSection>

      <SettingsSection title="强调色">
        <div className="settings-section__standalone">
          <ColorSwatches value={appearance.accentColor} options={ACCENT_OPTIONS} onChange={(accentColor) => onUpdate({ accentColor })} />
        </div>
      </SettingsSection>

      <SettingsSection title="字体">
        <SettingRow title="英文、数字与符号">
          <div className="settings-font-input">
            <TextInput
              testId="appearance-latin-font-family"
              value={editableFontValue(appearance, "latin")}
              placeholder="留空使用系统当前字体"
              list={latinFontListId}
              onChange={(value) => updateFont("latin", value)}
            />
            <FontSuggestions id={latinFontListId} values={LATIN_FONT_SUGGESTIONS} />
          </div>
        </SettingRow>
        <SettingRow title="中文字体">
          <div className="settings-font-input">
            <TextInput
              testId="appearance-chinese-font-family"
              value={editableFontValue(appearance, "chinese")}
              placeholder="留空使用系统当前中文字体"
              list={chineseFontListId}
              onChange={(value) => updateFont("chinese", value)}
            />
            <FontSuggestions id={chineseFontListId} values={CHINESE_FONT_SUGGESTIONS} />
          </div>
        </SettingRow>
        <div className="settings-typography-preview settings-font-pair-preview">
          <span>Font preview · 0123456789 !@#$%</span>
          <p>中文排版预览：清晰、稳定，适合持续阅读长对话。</p>
        </div>
      </SettingsSection>

      <SettingsSection title="窗口排版">
        <div className="settings-section__standalone settings-typography-window-picker">
          <Select testId="appearance-typography-window" value={activeWindowId} options={WINDOW_OPTIONS} onChange={setActiveWindowId} />
        </div>
        <SettingRow title="字号">
          <Slider value={typography.fontSize} min={10} max={28} step={1} unit=" px" onChange={(fontSize) => updateWindowTypography(activeWindowId, { fontSize })} />
        </SettingRow>
        <SettingRow title="行高">
          <Slider value={typography.lineHeight} min={1.1} max={2.4} step={0.05} formatValue={(value) => value.toFixed(2)} onChange={(lineHeight) => updateWindowTypography(activeWindowId, { lineHeight })} />
        </SettingRow>
        <SettingRow title="字距">
          <Slider value={typography.letterSpacing ?? 0} min={-0.03} max={0.05} step={0.001} formatValue={(value) => `${value.toFixed(3)} em`} onChange={(letterSpacing) => updateWindowTypography(activeWindowId, { letterSpacing })} />
        </SettingRow>
        <SettingRow title="界面间距">
          <Segmented testId="appearance-density" value={typography.density} options={DENSITY_OPTIONS} onChange={(density) => updateWindowTypography(activeWindowId, { density })} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="对话阅读布局">
        <SettingRow title="内容宽度">
          <Slider value={appearance.typography.conversation.contentWidth ?? 768} min={560} max={1080} step={8} unit=" px" onChange={(contentWidth) => updateWindowTypography("conversation", { contentWidth })} />
        </SettingRow>
        <SettingRow title="消息间距">
          <Slider value={appearance.typography.conversation.messageSpacing ?? 34} min={16} max={72} step={1} unit=" px" onChange={(messageSpacing) => updateWindowTypography("conversation", { messageSpacing })} />
        </SettingRow>
        <SettingRow title="段落间距">
          <Slider value={appearance.typography.conversation.paragraphSpacing ?? 1} min={0.5} max={1.8} step={0.05} formatValue={(value) => `${value.toFixed(2)} em`} onChange={(paragraphSpacing) => updateWindowTypography("conversation", { paragraphSpacing })} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="动画">
        <SettingRow title="减少动态效果">
          <Toggle checked={appearance.reducedMotion} label="减少动态效果" onChange={(reducedMotion) => onUpdate({ reducedMotion })} />
        </SettingRow>
      </SettingsSection>
    </>
  );
}
