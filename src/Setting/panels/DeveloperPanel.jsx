import {
  SettingsSection
} from "../components/Controls.jsx";

import {
  TOOLSET_OPTIONS
} from "../tools/toolPanelOptions.js";

function resolveActiveModel(modelSettings = {}) {
  const provider =
    modelSettings.providers?.[
      modelSettings.activeProvider
    ] ?? Object.values(
      modelSettings.providers ?? {}
    )[0];

  const model =
    provider?.models?.find(
      (item) =>
        item.id ===
        provider.activeModelId
    ) ?? provider?.models?.[0];

  return {
    provider:
      provider?.name ?? "未配置",
    model:
      model?.name ?? "未配置",
    modelId:
      model?.modelId ?? "unknown"
  };
}

function countVisibleTools(tools) {
  return TOOLSET_OPTIONS.reduce(
    (count, toolset) => {
      let enabled =
        toolset.id === "workspace.read"
          ? tools.mode === "coding"
          : true;

      const toolsetOverride =
        tools.developer
          ?.toolsetOverrides?.[
            toolset.id
          ] ?? "inherit";

      if (toolsetOverride === "enabled") {
        enabled = true;
      } else if (
        toolsetOverride === "disabled"
      ) {
        enabled = false;
      }

      if (!enabled) {
        return count;
      }

      return count +
        toolset.tools.filter(
          (tool) =>
            tools.developer
              ?.toolOverrides?.[
                tool.name
              ] !== "disabled"
        ).length;
    },
    0
  );
}

export function DeveloperPanel({
  settings
}) {
  const activeModel =
    resolveActiveModel(
      settings.model
    );

  const totalTools =
    TOOLSET_OPTIONS.reduce(
      (count, toolset) =>
        count + toolset.tools.length,
      0
    );

  const visibleTools =
    countVisibleTools(
      settings.tools
    );

  return (
    <>
      <SettingsSection
        title="Agent Runtime"
        description="当前设置解析后的运行状态。"
      >
        <div className="developer-diagnostic-grid">
          <div>
            <span>工作模式</span>
            <strong>
              {settings.tools.mode === "coding"
                ? "Coding"
                : "Chat"}
            </strong>
          </div>
          <div>
            <span>已注册工具</span>
            <strong>{totalTools}</strong>
          </div>
          <div>
            <span>模型可见工具</span>
            <strong>{visibleTools}</strong>
          </div>
          <div>
            <span>授权工作区</span>
            <strong>
              {settings.tools.workspace.roots.length}
            </strong>
          </div>
          <div>
            <span>最大步骤</span>
            <strong>
              {settings.tools.runtime.maxSteps}
            </strong>
          </div>
          <div>
            <span>最大工具调用</span>
            <strong>
              {settings.tools.runtime.maxToolCalls}
            </strong>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Model"
        description="模型工具能力由 AI SDK Provider 在请求时验证。"
      >
        <div className="developer-model-summary">
          <span>{activeModel.provider}</span>
          <strong>{activeModel.model}</strong>
          <code>{activeModel.modelId}</code>
        </div>
      </SettingsSection>

      <SettingsSection
        title="安全边界"
        description="开发者模式只增加可见性和调试入口。"
      >
        <div className="developer-boundary-list">
          <span>敏感文件保护</span>
          <span>工作区与符号链接边界</span>
          <span>Renderer 外部资源限制</span>
          <span>无文件写入</span>
          <span>无任意命令执行</span>
          <span>无任意网络工具</span>
        </div>
      </SettingsSection>
    </>
  );
}
