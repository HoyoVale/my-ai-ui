import {
  ActionButton,
  SettingRow,
  SettingsSection,
  Toggle
} from "../components/Controls.jsx";

export function GeneralPanel({
  settings,
  appInfo,
  onUpdate,
  onReset
}) {
  const general =
    settings.general;

  return (
    <>
      <SettingsSection
        title="启动"
        description="控制应用如何启动。"
      >
        <SettingRow
          title="开机启动"
          description={
            appInfo?.isPackaged
              ? "登录系统后自动启动 Xixi。"
              : "开发模式下不可用，打包应用后生效。"
          }
          disabled={
            !appInfo?.isPackaged
          }
        >
          <Toggle
            checked={
              general
                .launchAtLogin
            }
            disabled={
              !appInfo
                ?.isPackaged
            }
            label="开机启动"
            onChange={(value) => {
              onUpdate({
                launchAtLogin:
                  value
              });
            }}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="窗口状态"
        description="保存下次启动时需要恢复的信息。"
      >
        <SettingRow
          title="记住桌宠位置"
          description="关闭应用后保存桌宠最后所在的屏幕位置。"
        >
          <Toggle
            checked={
              general
                .rememberPetPosition
            }
            label="记住桌宠位置"
            onChange={(value) => {
              onUpdate({
                rememberPetPosition:
                  value
              });
            }}
          />
        </SettingRow>
      </SettingsSection>


      <SettingsSection
        title="开发者"
        description="在保持默认安全边界的前提下显示高级设置与诊断信息。"
      >
        <SettingRow
          title="开发者模式"
          description="显示模型、上下文、工具运行时和诊断设置。"
        >
          <Toggle
            checked={
              general.developerMode
            }
            label="开发者模式"
            testId="developer-mode"
            onChange={(value) => {
              if (
                value &&
                !window.confirm(
                  "开发者模式用于模型适配、工具调试和插件开发。它不会解除应用的固定安全保护。"
                )
              ) {
                return;
              }

              onUpdate({
                developerMode: value
              });
            }}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="恢复默认"
        description="恢复所有窗口和外观设置。"
      >
        <SettingRow
          title="重置全部设置"
          description="不会删除项目文件，只会重置用户配置。"
        >
          <ActionButton
            tone="danger"
            onClick={() => {
              const confirmed =
                window.confirm(
                  "确定恢复全部默认设置吗？"
                );

              if (confirmed) {
                onReset();
              }
            }}
          >
            恢复默认
          </ActionButton>
        </SettingRow>
      </SettingsSection>
    </>
  );
}
