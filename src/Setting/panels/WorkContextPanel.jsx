import {
  useState
} from "react";

import {
  ActionButton,
  SettingsSection
} from "../components/Controls.jsx";

export function WorkContextPanel({
  settings
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const workspaces = Array.isArray(settings.workspaces?.items)
    ? settings.workspaces.items
    : [];

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
        title="会话规则"
        description="会话按 Chat 与 Coding 管理，工作区绑定创建后不会改变。"
      >
        <div className="tool-mode-card">
          <div className="tool-mode-card__copy">
            <strong>Chat</strong>
            <span>可以不绑定工作区；绑定后只提供只读文件能力。Input 中可以切换到其他工作区已有的 Chat 会话。</span>
          </div>
        </div>

        <div className="tool-mode-card">
          <div className="tool-mode-card__copy">
            <strong>Coding</strong>
            <span>创建会话前必须选择工作区；会话创建后不能换绑。未来写入能力也只会作用于该固定目录。</span>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="工作区"
        description="工作区是用户明确授权的项目目录。"
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
