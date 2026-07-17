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
  { id: "conversation", label: "Conversation", description: "历史对话、Markdown 与上下文检查器。" },
  { id: "response", label: "Response", description: "桌宠旁边的流式回复窗口。" },
  { id: "input", label: "Input", description: "输入框文字与内部留白。" },
  { id: "memory", label: "Memory", description: "记忆列表与编辑内容。" },
  { id: "setting", label: "Setting", description: "设置项、说明和控件。" },
  { id: "pet", label: "Pet menu", description: "桌宠右键菜单文字。" }
];

const LINE_HEIGHT_PRESETS = {
  conversation: {
    compact: 1.5,
    comfortable: 1.72,
    spacious: 1.9
  },
  response: {
    compact: 1.4,
    comfortable: 1.55,
    spacious: 1.75
  },
  input: {
    compact: 1.3,
    comfortable: 1.45,
    spacious: 1.62
  },
  memory: {
    compact: 1.4,
    comfortable: 1.55,
    spacious: 1.75
  },
  setting: {
    compact: 1.35,
    comfortable: 1.5,
    spacious: 1.7
  },
  pet: {
    compact: 1.3,
    comfortable: 1.4,
    spacious: 1.58
  }
};

export function AppearancePanel({
  settings,
  onUpdate
}) {
  const appearance =
    settings.appearance;

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
      <SettingsSection
        title="主题"
        description="同时应用于所有窗口。"
      >
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

      <SettingsSection
        title="强调色"
        description="用于按钮、焦点、进度和选中状态。"
      >
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

      <SettingsSection
        title="全局字体"
        description="所有窗口使用同一套字体族，避免界面风格割裂。"
      >
        <SettingRow
          title="字体族"
          description="不会附带或下载字体；系统中不存在时会自动使用后备字体。"
        >
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
          <SettingRow
            title="自定义字体"
            description="可以填写多个 CSS 字体名，例如 Segoe UI Variable, Microsoft YaHei UI。"
          >
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

      <SettingsSection
        title="窗口文字与密度"
        description="字号按窗口独立设置；密度同时调整行高和主要留白。"
      >
        {WINDOW_OPTIONS.map((windowOption) => {
          const typography =
            appearance.typography[
              windowOption.id
            ];

          return (
            <SettingRow
              key={windowOption.id}
              title={windowOption.label}
              description={windowOption.description}
            >
              <div className="settings-typography-control">
                <Slider
                  value={typography.fontSize}
                  min={10}
                  max={24}
                  step={1}
                  unit=" px"
                  onChange={(fontSize) => {
                    updateWindowTypography(
                      windowOption.id,
                      { fontSize }
                    );
                  }}
                />

                <Select
                  value={typography.density}
                  options={DENSITY_OPTIONS}
                  onChange={(density) => {
                    updateWindowTypography(
                      windowOption.id,
                      {
                        density,
                        lineHeight:
                          LINE_HEIGHT_PRESETS[
                            windowOption.id
                          ][density]
                      }
                    );
                  }}
                />
              </div>
            </SettingRow>
          );
        })}
      </SettingsSection>

      <SettingsSection
        title="动画"
        description="减少界面切换和弹出动画。"
      >
        <SettingRow
          title="减少动态效果"
          description="适合偏好稳定界面或对动画敏感的用户。"
        >
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
