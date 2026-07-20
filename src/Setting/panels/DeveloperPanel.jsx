import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";

import {
  ActionButton,
  Select,
  SettingsSection,
  TextArea
} from "../components/Controls.jsx";

import {
  useToolManifest
} from "../hooks/useToolManifest.js";

const MODE_OPTIONS = [
  { value: "chat", label: "Chat" },
  { value: "coding", label: "Coding" }
];

function resolveActiveModel(modelSettings = {}) {
  const provider =
    modelSettings.providers?.[modelSettings.activeProvider] ??
    Object.values(modelSettings.providers ?? {})[0];
  const model =
    provider?.models?.find((item) => item.id === provider.activeModelId) ??
    provider?.models?.[0];

  return {
    provider: provider?.name ?? "未配置",
    model: model?.name ?? "未配置",
    modelId: model?.modelId ?? "unknown"
  };
}

function authorityLabel(authority) {
  return {
    policy: "应用策略",
    capability: "运行能力",
    runtime: "运行环境",
    developer: "开发者指令",
    preference: "用户偏好",
    data: "上下文数据"
  }[authority] ?? authority;
}

function PromptInspector({ settings }) {
  const [inspection, setInspection] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const previewFingerprint = JSON.stringify({
    tools: settings?.tools ?? {},
    prompts: settings?.prompts ?? {},
    personality: settings?.personality ?? {},
    context: settings?.context ?? {},
    conversation: settings?.conversation ?? {},
    memory: settings?.memory ?? {}
  });
  const settingsPreview = useMemo(
    () => JSON.parse(previewFingerprint),
    [previewFingerprint]
  );

  const refresh = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      const value = await window.api?.inspectEffectivePrompt?.({
        settingsPreview
      });
      setInspection(value ?? null);
      setStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("error");
    }
  }, [settingsPreview]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void refresh();
    }, 160);
    return () => clearTimeout(timer);
  }, [refresh]);

  const copyPrompt = async () => {
    const content = inspection?.effectivePrompt ?? "";
    if (!content) return;
    await navigator.clipboard?.writeText?.(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="prompt-inspector" data-testid="effective-prompt-viewer">
      <div className="prompt-inspector__toolbar">
        <div>
          <strong>Effective Prompt</strong>
          <span>
            {inspection
              ? `${inspection.sections.length} 层 · 约 ${inspection.promptTokens} tokens`
              : "读取当前设置生成的最终 System Prompt"}
          </span>
        </div>
        <div>
          <ActionButton onClick={() => void refresh()}>刷新</ActionButton>
          <ActionButton disabled={!inspection} onClick={() => void copyPrompt()}>
            {copied ? "已复制" : "复制"}
          </ActionButton>
        </div>
      </div>

      {status === "loading" && <p className="prompt-inspector__empty">正在生成 Prompt Stack…</p>}
      {status === "error" && <p className="prompt-inspector__empty is-error">{error}</p>}

      {inspection && (
        <>
          <div className="prompt-stack-list">
            {inspection.sections.map((section) => (
              <details key={section.id} className="prompt-stack-section">
                <summary>
                  <span>
                    <strong>{section.title || section.id}</strong>
                    <small>{authorityLabel(section.authority)} · {section.source}</small>
                  </span>
                  <span>{section.tokens} tokens{section.locked ? " · 锁定" : section.editable ? " · 可配置" : ""}</span>
                </summary>
                <pre>{section.content}</pre>
              </details>
            ))}
          </div>

          <details className="effective-prompt-block">
            <summary>查看最终拼接结果</summary>
            <pre>{inspection.effectivePrompt}</pre>
          </details>
        </>
      )}
    </div>
  );
}

export function DeveloperPanel({
  settings,
  onUpdatePrompts
}) {
  const { manifest } = useToolManifest(settings);
  const fallbackModel = resolveActiveModel(settings.model);
  const activeModel = manifest?.activeModel
    ? {
        provider: manifest.activeModel.providerName,
        model: manifest.activeModel.modelName,
        modelId: manifest.activeModel.modelId
      }
    : fallbackModel;
  const [modeEditor, setModeEditor] = useState(
    manifest?.mode === "coding" ? "coding" : "chat"
  );
  const promptSettings = settings.prompts ?? {
    modeOverrides: { chat: "", coding: "" },
    developerInstructions: ""
  };

  useEffect(() => {
    if (manifest?.mode) {
      setModeEditor(manifest.mode);
    }
  }, [
    manifest?.executionContext?.conversationId,
    manifest?.mode
  ]);

  const updateModePrompt = (value) => {
    onUpdatePrompts?.({
      modeOverrides: {
        ...(promptSettings.modeOverrides ?? {}),
        [modeEditor]: value
      }
    });
  };

  const clearModePrompt = () => updateModePrompt("");
  const visibleTools = manifest?.tools?.filter((tool) => tool.ready).length ?? 0;
  const totalTools = manifest?.tools?.length ?? 0;

  return (
    <>
      <SettingsSection title="Agent Runtime">
        <div className="developer-diagnostic-grid">
          <div><span>工作模式</span><strong>{manifest?.mode === "coding" ? "Coding" : "Chat"}</strong></div>
          <div><span>已注册工具</span><strong>{totalTools}</strong></div>
          <div><span>模型可见工具</span><strong>{visibleTools}</strong></div>
          <div><span>Manifest</span><strong>{manifest?.revision ?? "加载中"}</strong></div>
          <div><span>当前会话</span><strong>{manifest?.executionContext?.conversationTitle ?? "加载中"}</strong></div>
          <div><span>授权工作区</span><strong>{manifest?.executionContext?.workspaceAvailable ? 1 : 0}</strong></div>
          <div><span>最大工具调用</span><strong>{settings.tools.runtime.maxToolCalls}</strong></div>
        </div>
      </SettingsSection>

      <SettingsSection title="Prompt Stack">
        <div className="developer-prompt-editor">
          <div className="developer-prompt-editor__header">
            <div>
              <strong>模式提示词</strong>
              <span>留空使用应用内置版本；自定义内容只能替换模式行为层，不能覆盖 Runtime Kernel。</span>
            </div>
            <Select
              value={modeEditor}
              options={MODE_OPTIONS}
              onChange={setModeEditor}
            />
          </div>

          <TextArea
            testId={`mode-prompt-${modeEditor}`}
            rows={8}
            maxLength={12000}
            value={promptSettings.modeOverrides?.[modeEditor] ?? ""}
            placeholder={`留空使用内置 ${modeEditor === "coding" ? "Coding" : "Chat"} Prompt`}
            onChange={updateModePrompt}
          />

          <div className="developer-prompt-editor__footer">
            <span>{(promptSettings.modeOverrides?.[modeEditor] ?? "").length}/12000</span>
            <ActionButton
              disabled={!promptSettings.modeOverrides?.[modeEditor]}
              onClick={clearModePrompt}
            >
              恢复内置版本
            </ActionButton>
          </div>
        </div>

        <div className="developer-prompt-editor">
          <div className="developer-prompt-editor__header">
            <div>
              <strong>开发者附加指令</strong>
              <span>追加到能力与运行环境之后，不能扩展工具权限或覆盖应用安全策略。</span>
            </div>
          </div>
          <TextArea
            testId="developer-instructions"
            rows={7}
            maxLength={20000}
            value={promptSettings.developerInstructions ?? ""}
            placeholder="例如：所有代码修改优先最小改动，并在完成后运行相关测试。"
            onChange={(developerInstructions) => {
              onUpdatePrompts?.({ developerInstructions });
            }}
          />
          <div className="developer-prompt-editor__footer">
            <span>{(promptSettings.developerInstructions ?? "").length}/20000</span>
          </div>
        </div>

        <PromptInspector settings={settings} />
      </SettingsSection>

      <SettingsSection title="Model">
        <div className="developer-model-summary">
          <span>{activeModel.provider}</span>
          <strong>{activeModel.model}</strong>
          <code>{activeModel.modelId}</code>
        </div>
      </SettingsSection>

      <SettingsSection title="安全边界">
        <div className="developer-boundary-list">
          <span>Runtime Kernel 与产品基础策略不可编辑</span>
          <span>敏感文件、工作区与符号链接边界</span>
          <span>写入仅限 Coding 绑定工作区并使用原子替换</span>
          <span>任意 Shell 被禁用；进程工具仅允许显式可执行文件与参数</span>
          <span>工具开关、Schema 和详情来自统一 Tool Manifest</span>
          <span>没有任意网络工具；未来 MCP 仍需通过 Tool Runtime</span>
        </div>
      </SettingsSection>
    </>
  );
}
