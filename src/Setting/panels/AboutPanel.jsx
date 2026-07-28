import {
  useUpdateState
} from "../hooks/useUpdateState.js";

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

function updateCopy(state) {
  if (!state) {
    return {
      title: "正在读取更新状态…",
      detail: "",
      action: "none"
    };
  }

  if (!state.supported) {
    return {
      title: "自动更新仅在正式安装包中启用",
      detail:
        state.reason === "development-mode"
          ? "当前为开发模式。"
          : "当前构建未包含更新组件。",
      action: "none"
    };
  }

  switch (state.status) {
    case "checking":
      return {
        title: "正在检查更新…",
        detail: "",
        action: "none"
      };

    case "available":
    case "downloading":
      return {
        title: state.availableVersion
          ? `正在下载 ${state.availableVersion}`
          : "正在下载更新",
        detail: `${Math.round(state.progressPercent || 0)}%`,
        action: state.status === "available"
          ? "download"
          : "none"
      };

    case "downloaded":
      return {
        title: state.downloadedVersion
          ? `版本 ${state.downloadedVersion} 已准备好`
          : "更新已准备好",
        detail: "安装时应用会安全退出并重新启动。",
        action: "install"
      };

    case "not-available":
      return {
        title: "当前已是最新版本",
        detail: `更新通道：${state.channel}`,
        action: "check"
      };

    case "error":
      return {
        title: "检查更新失败",
        detail:
          state.errorMessage ||
          "请稍后重试。",
        action: "check"
      };

    case "installing":
      return {
        title: "正在安装更新…",
        detail: "应用即将重新启动。",
        action: "none"
      };

    default:
      return {
        title: "自动检查更新已启用",
        detail: `更新通道：${state.channel}`,
        action: "check"
      };
  }
}

export function AboutPanel({
  appInfo
}) {
  const update = useUpdateState();
  const copy = updateCopy(update.state);

  const triggerAction = () => {
    if (copy.action === "install") {
      void update.install();
    } else if (copy.action === "download") {
      void update.download();
    } else if (copy.action === "check") {
      void update.check();
    }
  };

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
          label="发布通道"
          value={
            update.state?.channel ??
            appInfo?.releaseChannel
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

        <InfoRow
          label="应用标识"
          value={
            appInfo?.appId
          }
        />
      </div>

      <div className="about-update" data-testid="about-update-status">
        <div>
          <strong>{copy.title}</strong>
          {copy.detail ? <span>{copy.detail}</span> : null}
        </div>

        {copy.action !== "none" ? (
          <button
            type="button"
            className="settings-action"
            disabled={update.busy}
            onClick={triggerAction}
          >
            {copy.action === "install"
              ? "安装并重启"
              : copy.action === "download"
                ? "下载更新"
                : "检查更新"}
          </button>
        ) : null}
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

      <div className="about-path">
        <span>
          会话文件
        </span>

        <code>
          {appInfo
            ?.conversationsPath ??
            "正在读取…"}
        </code>
      </div>

      <div className="about-path">
        <span>
          记忆文件
        </span>

        <code>
          {appInfo
            ?.memoriesPath ??
            "正在读取…"}
        </code>
      </div>
    </div>
  );
}
