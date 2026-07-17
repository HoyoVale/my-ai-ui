import {
  SettingRow,
  SettingsSection,
  Slider,
  Toggle
} from "../components/Controls.jsx";

export function ConversationWindowPanel({
  settings,
  onUpdate
}) {
  const conversationWindow =
    settings.conversationWindow;

  return (
    <>
      <SettingsSection
        title="窗口布局"
        description="调整会话记录窗口的侧栏和消息阅读区域。"
      >
        <SettingRow
          title="侧栏宽度"
          description="控制会话列表占用的横向空间。"
        >
          <Slider
            value={
              conversationWindow
                .sidebarWidth
            }
            min={220}
            max={420}
            step={4}
            unit=" px"
            onChange={(sidebarWidth) => {
              onUpdate({
                sidebarWidth
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="消息区最大宽度"
          description="限制正文宽度，宽屏时仍保持舒适的阅读行长。"
        >
          <Slider
            value={
              conversationWindow
                .messageMaxWidth
            }
            min={520}
            max={1200}
            step={20}
            unit=" px"
            onChange={(messageMaxWidth) => {
              onUpdate({
                messageMaxWidth
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="始终置顶"
          description="让会话记录窗口保持在普通窗口上方。"
        >
          <Toggle
            checked={
              conversationWindow
                .alwaysOnTop
            }
            label="会话窗口始终置顶"
            onChange={(alwaysOnTop) => {
              onUpdate({
                alwaysOnTop
              });
            }}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="阅读与列表"
        description="调整消息文字和历史会话列表的显示密度。"
      >
        <SettingRow
          title="消息字号"
          description="影响用户和助手消息的正文大小。"
        >
          <Slider
            value={
              conversationWindow
                .fontSize
            }
            min={12}
            max={22}
            step={1}
            unit=" px"
            onChange={(fontSize) => {
              onUpdate({
                fontSize
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="紧凑会话列表"
          description="缩小历史会话项目的垂直间距。"
        >
          <Toggle
            checked={
              conversationWindow
                .compactList
            }
            label="使用紧凑列表"
            onChange={(compactList) => {
              onUpdate({
                compactList
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="显示消息预览"
          description="在会话标题下显示最近一条消息摘要。"
        >
          <Toggle
            checked={
              conversationWindow
                .showPreview
            }
            label="显示会话预览"
            onChange={(showPreview) => {
              onUpdate({
                showPreview
              });
            }}
          />
        </SettingRow>
      </SettingsSection>
    </>
  );
}
