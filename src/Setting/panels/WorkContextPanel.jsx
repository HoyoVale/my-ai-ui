import {
  useState
} from "react";

import {
  ActionButton,
  Segmented,
  SettingsSection
} from "../components/Controls.jsx";

import {
  TOOL_MODE_OPTIONS
} from "../tools/toolPanelOptions.js";

export function WorkContextPanel({
  settings,
  onUpdateTools
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const workspaces = Array.isArray(settings.workspaces?.items)
    ? settings.workspaces.items
    : [];
  const coding = settings.tools.mode === "coding";

  const addWorkspace = async () => {
    setError("");
    const selected = await window.api
      ?.selectWorkspaceDirectory?.();

    if (selected?.canceled || !selected?.paths?.[0]) {
      return;
    }

    setBusy(true);

    try {
      const result = await window.api
        ?.registerWorkspace?.(selected.paths[0]);

      if (result?.ok === false) {
        setError(result.message ?? "无法添加工作区。");
      }
    } catch (addError) {
      console.error("添加工作区失败：", addError);
      setError("无法添加工作区。");
    } finally {
      setBusy(false);
    }
  };

  const removeWorkspace = async (workspace) => {
    const confirmed = window.confirm(
      `移除工作区“${workspace.name}”？旧会话仍会保留工作区快照，但文件工具将不再访问该目录。`
    );

    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const result = await window.api
        ?.removeWorkspace?.(workspace.id);

      if (result?.ok === false) {
        setError(result.message ?? "无法移除工作区。");
      }
    } catch (removeError) {
      console.error("移除工作区失败：", removeError);
      setError("无法移除工作区。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingsSection
        title="工作模式"
        description="模式决定新一轮运行可使用的能力；会话仍按工作区归类。"
      >
        <div className="tool-mode-card">
          <Segmented
            value={settings.tools.mode}
            options={TOOL_MODE_OPTIONS}
            testId="work-context-mode"
            onChange={(mode) => {
              onUpdateTools({
                mode,
                profile: mode === "coding"
                  ? "workspace"
                  : "chat"
              });
            }}
          />

          <div className="tool-mode-card__copy">
            <strong>
              {coding
                ? "Coding"
                : "Chat"}
            </strong>
            <span>
              {coding
                ? "允许当前会话读取其绑定的工作区；没有工作区时仍可正常聊天。"
                : "仅使用通用工具，不读取本地工作区。"}
            </span>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="工作区"
        description="工作区是长期注册的项目目录；每个会话固定绑定一个工作区或无工作区。"
      >
        {error && (
          <div className="settings-inline-error">
            {error}
          </div>
        )}

        <div className="workspace-simple-list">
          {workspaces.length === 0 ? (
            <div className="workspace-simple-list__empty">
              尚未添加工作区
            </div>
          ) : (
            workspaces.map((workspace) => (
              <div
                className="workspace-simple-item workspace-registry-item"
                key={workspace.id}
              >
                <div className="workspace-registry-item__copy">
                  <strong>{workspace.name}</strong>
                  <code title={workspace.rootPath}>
                    {workspace.rootPath}
                  </code>
                </div>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void removeWorkspace(workspace);
                  }}
                >
                  移除
                </button>
              </div>
            ))
          )}
        </div>

        <ActionButton
          testId="register-workspace"
          disabled={busy}
          onClick={() => {
            void addWorkspace();
          }}
        >
          添加工作区
        </ActionButton>

        <p className="settings-support-copy">
          移除工作区不会删除历史会话；历史记录会保留原工作区名称和路径快照。
        </p>
      </SettingsSection>
    </>
  );
}
