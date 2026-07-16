function InfoRow({
  label,
  value
}) {
  return (
    <div className="about-info__row">
      <span>{label}</span>
      <strong>{value ?? "—"}</strong>
    </div>
  );
}

export function AboutPanel({
  appInfo
}) {
  return (
    <div className="about-panel">
      <div className="about-panel__brand">
        <div className="about-panel__logo">
          X
        </div>

        <div>
          <h2>
            {appInfo?.name ??
              "Xixi"}
          </h2>

          <p>
            Electron + React
            桌面 AI 助手
          </p>
        </div>
      </div>

      <div className="about-info">
        <InfoRow
          label="应用版本"
          value={
            appInfo?.version
          }
        />

        <InfoRow
          label="Electron"
          value={
            appInfo?.electron
          }
        />

        <InfoRow
          label="Chrome"
          value={
            appInfo?.chrome
          }
        />

        <InfoRow
          label="Node.js"
          value={
            appInfo?.node
          }
        />

        <InfoRow
          label="平台"
          value={
            appInfo
              ? `${appInfo.platform} / ${appInfo.arch}`
              : null
          }
        />

        <InfoRow
          label="运行模式"
          value={
            appInfo
              ? appInfo.isPackaged
                ? "已打包"
                : "开发模式"
              : null
          }
        />
      </div>

      <div className="about-path">
        <span>
          设置文件
        </span>

        <code>
          {appInfo
            ?.settingsPath ??
            "正在读取…"}
        </code>
      </div>
    </div>
  );
}
