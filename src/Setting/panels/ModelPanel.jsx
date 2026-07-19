import {
  useMemo,
  useState
} from "react";

import {
  ActionButton,
  Select,
  SettingRow,
  SettingsVisibility,
  Slider,
  TextInput
} from "../components/Controls.jsx";

import {
  useModelCredentials
} from "../hooks/useModelCredentials.js";

import {
  apiModeOptions,
  CONTEXT_OPTIONS,
  CREDENTIAL_OPTIONS,
  credentialDescription,
  createModelTemplate,
  OUTPUT_OPTIONS,
  providerSdkLabel,
  REASONING_EFFORT_OPTIONS,
  REASONING_MODE_OPTIONS,
  VERBOSITY_OPTIONS
} from "../model/modelPanelOptions.js";

function ProviderSelector({
  modelSettings,
  providerId,
  provider,
  onSelect
}) {
  return (
    <div className="model-provider-header">
      <div>
        <span className="model-eyebrow">Provider</span>
        <strong>{provider.name}</strong>
        <small>{providerSdkLabel(provider)}</small>
      </div>

      <Select
        testId="model-provider-select"
        value={providerId}
        options={Object.values(
          modelSettings.providers
        ).map((item) => ({
          value: item.id,
          label: item.name
        }))}
        onChange={onSelect}
      />
    </div>
  );
}

function ModelList({
  provider,
  activeModel,
  onSelect,
  onAdd,
  onDelete
}) {
  return (
    <aside className="model-list-card">
      <div className="model-list-card__header">
        <div>
          <span className="model-eyebrow">Models</span>
          <strong>已配置模型</strong>
        </div>

        <ActionButton
          testId="model-add"
          onClick={onAdd}
        >
          ＋
          <span className="settings-sr-only">
            添加模型
          </span>
        </ActionButton>
      </div>

      <div className="model-list-card__items">
        {provider.models.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`model-list-item${
              item.id === activeModel.id
                ? " is-active"
                : ""
            }`}
            onClick={() => onSelect(item.id)}
          >
            <span>{item.name || item.modelId}</span>
            <small>{item.modelId}</small>
          </button>
        ))}
      </div>

      <div className="model-list-card__footer">
        <ActionButton
          testId="model-delete"
          tone="danger"
          disabled={provider.models.length <= 1}
          onClick={onDelete}
        >
          删除当前模型
        </ActionButton>
      </div>

      <select
        className="model-active-select-proxy"
        data-testid="model-active-select"
        aria-label="当前模型"
        value={provider.activeModelId}
        onChange={(event) => onSelect(event.target.value)}
      >
        {provider.models.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name || item.modelId}
          </option>
        ))}
      </select>
    </aside>
  );
}

function ProviderConnection({
  provider,
  developerMode = false,
  status,
  loading,
  apiKey,
  credentialHint,
  onApiKeyChange,
  onProviderUpdate,
  onSave,
  onClear
}) {
  return (
    <details className="model-config-card" open>
      <summary>
        <span>
          <strong>提供商连接</strong>
          <small>地址与凭据由该 Provider 下全部模型共享</small>
        </span>
        <span className="model-card-summary-status">
          {status.configured ? "已配置" : "未配置"}
        </span>
      </summary>

      <div className="model-config-card__body">
        <SettingsVisibility
          visibility="developer"
          developerMode={developerMode}
        >
        <SettingRow title="显示名称">
          <TextInput
            value={provider.name}
            onChange={(name) => onProviderUpdate({ name })}
          />
        </SettingRow>

        <SettingRow
          title="Base URL"
          description={
            provider.type === "ollama"
              ? "原生 Ollama SDK 使用 /api 地址；旧 /v1 地址会自动迁移。"
              : "填写当前 SDK 使用的 API 前缀。"
          }
        >
          <TextInput
            value={provider.baseURL}
            placeholder="https://api.example.com/v1"
            onChange={(baseURL) => onProviderUpdate({ baseURL })}
          />
        </SettingRow>

        <SettingRow title="凭据模式">
          <Select
            value={provider.credentialMode}
            options={CREDENTIAL_OPTIONS}
            onChange={(credentialMode) =>
              onProviderUpdate({ credentialMode })
            }
          />
        </SettingRow>

        <SettingRow
          title="环境变量"
          description="未保存本地密钥时，主进程会尝试读取该变量。"
        >
          <TextInput
            value={provider.environmentKey}
            placeholder="PROVIDER_API_KEY"
            onChange={(environmentKey) =>
              onProviderUpdate({
                environmentKey:
                  environmentKey.toUpperCase()
              })
            }
          />
        </SettingRow>
        </SettingsVisibility>

        {provider.credentialMode !== "none" && (
          <SettingRow
            title="API Key"
            description={
              credentialHint ??
              credentialDescription(
                provider,
                status,
                loading
              )
            }
          >
            <div className="settings-credential-control">
              <TextInput
                type="password"
                value={apiKey}
                placeholder={status.configured ? "输入新密钥以替换" : "sk-..."}
                autoComplete="off"
                onChange={onApiKeyChange}
              />
              <ActionButton onClick={onSave}>
                {status.configured ? "替换" : "保存"}
              </ActionButton>
              {status.configured && (
                <ActionButton tone="danger" onClick={onClear}>
                  清除
                </ActionButton>
              )}
            </div>
          </SettingRow>
        )}
      </div>
    </details>
  );
}

function ModelConfiguration({
  provider,
  model,
  onUpdate
}) {
  const modeOptions = apiModeOptions(provider);

  return (
    <>
      <details className="model-config-card" open>
        <summary>
          <span>
            <strong>模型标识与容量</strong>
            <small>决定请求目标、上下文上限与最大输出</small>
          </span>
          <span className="model-card-summary-status">
            {model.contextTokenBudget >= 1000000
              ? `${model.contextTokenBudget / 1000000}M`
              : `${Math.round(model.contextTokenBudget / 1000)}K`}
          </span>
        </summary>

        <div className="model-config-card__body">
          <SettingRow title="显示名称">
            <TextInput
              testId="model-display-name"
              value={model.name}
              onChange={(name) => onUpdate({ name })}
            />
          </SettingRow>

          <SettingRow
            title="模型 ID"
            description="发送给 Provider SDK 的真实模型名称。"
          >
            <TextInput
              testId="model-id-input"
              value={model.modelId}
              onChange={(modelId) => onUpdate({ modelId })}
            />
          </SettingRow>

          <SettingRow title="API 模式">
            <Select
              value={modeOptions.some((item) => item.value === model.apiMode)
                ? model.apiMode
                : modeOptions[0].value}
              options={modeOptions}
              onChange={(apiMode) => onUpdate({ apiMode })}
            />
          </SettingRow>

          <SettingRow title="上下文 Token 上限">
            <Select
              testId="model-context-limit"
              value={model.contextTokenBudget}
              options={CONTEXT_OPTIONS}
              onChange={(contextTokenBudget) =>
                onUpdate({
                  contextTokenBudget,
                  maxOutputTokens: Math.min(
                    model.maxOutputTokens,
                    contextTokenBudget
                  )
                })
              }
            />
          </SettingRow>

          <SettingRow title="最大输出 Tokens">
            <Select
              value={model.maxOutputTokens}
              options={OUTPUT_OPTIONS.filter(
                (item) => item.value <= model.contextTokenBudget
              )}
              onChange={(maxOutputTokens) => onUpdate({ maxOutputTokens })}
            />
          </SettingRow>
        </div>
      </details>

      <details className="model-config-card">
        <summary>
          <span>
            <strong>生成与推理</strong>
            <small>高级参数默认保持兼容值，需要时再调整</small>
          </span>
          <span className="model-card-summary-status">Advanced</span>
        </summary>

        <div className="model-config-card__body">
          <SettingRow title="Temperature">
            <Slider
              value={model.temperature}
              min={0}
              max={2}
              step={0.1}
              formatValue={(value) => Number(value).toFixed(1)}
              onChange={(temperature) => onUpdate({ temperature })}
            />
          </SettingRow>

          <SettingRow title="Top P">
            <Slider
              value={model.topP}
              min={0}
              max={1}
              step={0.05}
              formatValue={(value) => Number(value).toFixed(2)}
              onChange={(topP) => onUpdate({ topP })}
            />
          </SettingRow>

          <SettingRow
            title="Seed"
            description="留空表示随机；并非所有模型都支持固定种子。"
          >
            <TextInput
              type="number"
              value={model.seed ?? ""}
              placeholder="随机"
              onChange={(value) =>
                onUpdate({
                  seed: value === "" ? null : Number(value)
                })
              }
            />
          </SettingRow>

          <SettingRow title="失败重试">
            <Slider
              value={model.maxRetries}
              min={0}
              max={5}
              step={1}
              unit=" 次"
              onChange={(maxRetries) => onUpdate({ maxRetries })}
            />
          </SettingRow>

          <SettingRow title="推理模式">
            <Select
              value={model.reasoningMode}
              options={REASONING_MODE_OPTIONS}
              onChange={(reasoningMode) => onUpdate({ reasoningMode })}
            />
          </SettingRow>

          {(provider.type === "openai" || provider.type === "openai-compatible") && (
            <SettingRow title="推理强度">
              <Select
                value={model.reasoningEffort}
                options={REASONING_EFFORT_OPTIONS}
                onChange={(reasoningEffort) => onUpdate({ reasoningEffort })}
              />
            </SettingRow>
          )}

          {provider.type === "anthropic" && model.reasoningMode === "enabled" && (
            <SettingRow title="Thinking 预算">
              <Slider
                value={model.reasoningBudgetTokens}
                min={1024}
                max={Math.max(1024, model.maxOutputTokens)}
                step={1024}
                unit=" tokens"
                onChange={(reasoningBudgetTokens) => onUpdate({ reasoningBudgetTokens })}
              />
            </SettingRow>
          )}

          {provider.type === "openai" && (
            <SettingRow title="回答详细度">
              <Select
                value={model.textVerbosity}
                options={VERBOSITY_OPTIONS}
                onChange={(textVerbosity) => onUpdate({ textVerbosity })}
              />
            </SettingRow>
          )}

          <SettingRow title="请求超时">
            <Slider
              value={Math.round(model.timeoutMs / 1000)}
              min={15}
              max={600}
              step={5}
              unit=" 秒"
              onChange={(seconds) => onUpdate({ timeoutMs: seconds * 1000 })}
            />
          </SettingRow>
        </div>
      </details>
    </>
  );
}

export function ModelPanel({
  settings,
  developerMode = false,
  onUpdate
}) {
  const modelSettings = settings.model;
  const providerId = modelSettings.activeProvider;
  const provider =
    modelSettings.providers[providerId] ??
    Object.values(modelSettings.providers)[0];

  const activeModel = useMemo(
    () => provider.models.find(
      (item) => item.id === provider.activeModelId
    ) ?? provider.models[0],
    [provider.activeModelId, provider.models]
  );

  const [apiKey, setApiKey] = useState("");
  const [credentialAction, setCredentialAction] = useState("idle");
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  const {
    status,
    loading,
    saveApiKey,
    clearApiKey
  } = useModelCredentials(provider);

  const updateProvider = (patch) => {
    onUpdate({
      providers: {
        ...modelSettings.providers,
        [providerId]: {
          ...provider,
          ...patch
        }
      }
    });
  };

  const updateActiveModel = (patch) => {
    updateProvider({
      models: provider.models.map((item) =>
        item.id === activeModel.id
          ? { ...item, ...patch }
          : item
      )
    });
    setTestResult(null);
  };

  const addModel = () => {
    const model = createModelTemplate(provider);
    updateProvider({
      activeModelId: model.id,
      models: [...provider.models, model]
    });
  };

  const deleteModel = () => {
    if (provider.models.length <= 1) return;
    const models = provider.models.filter((item) => item.id !== activeModel.id);
    updateProvider({ models, activeModelId: models[0].id });
  };

  const credentialHint = {
    empty: "请输入 API Key。",
    saving: "正在保存…",
    saved: "API Key 已保存。",
    cleared: "已清除本地 API Key。",
    error: "操作失败，请查看控制台。"
  }[credentialAction];

  const handleSave = async () => {
    if (!apiKey.trim()) {
      setCredentialAction("empty");
      return;
    }
    setCredentialAction("saving");
    try {
      await saveApiKey(apiKey);
      setApiKey("");
      setCredentialAction("saved");
    } catch {
      setCredentialAction("error");
    }
  };

  const handleClear = async () => {
    setCredentialAction("saving");
    try {
      await clearApiKey();
      setApiKey("");
      setCredentialAction("cleared");
    } catch {
      setCredentialAction("error");
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await window.api?.testModelConnection?.(modelSettings);
      setTestResult(result ?? { ok: false, message: "未收到测试结果。" });
    } catch (error) {
      setTestResult({
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="model-panel">
      <ProviderSelector
        modelSettings={modelSettings}
        providerId={providerId}
        provider={provider}
        onSelect={(activeProvider) => {
          onUpdate({ activeProvider });
          setApiKey("");
          setCredentialAction("idle");
          setTestResult(null);
        }}
      />

      <div className="model-runtime-summary">
        <div>
          <span className="model-eyebrow">Active runtime</span>
          <strong>{provider.name} · {activeModel.name}</strong>
          <small>{providerSdkLabel(provider)} · {activeModel.modelId}</small>
        </div>

        <div className="model-runtime-summary__actions">
          {testResult && (
            <span className={`model-test-result${testResult.ok ? " is-success" : " is-error"}`}>
              {testResult.ok
                ? `连接成功 · ${testResult.latencyMs} ms`
                : testResult.message}
            </span>
          )}
          <ActionButton disabled={testing} onClick={() => void handleTest()}>
            {testing ? "测试中…" : "测试当前模型"}
          </ActionButton>
        </div>
      </div>

      <div className="model-workspace">
        <ModelList
          provider={provider}
          activeModel={activeModel}
          onSelect={(activeModelId) => updateProvider({ activeModelId })}
          onAdd={addModel}
          onDelete={deleteModel}
        />

        <div className="model-editor-stack">
          <ProviderConnection
            provider={provider}
            developerMode={developerMode}
            status={status}
            loading={loading}
            apiKey={apiKey}
            credentialHint={credentialHint}
            onApiKeyChange={(value) => {
              setApiKey(value);
              setCredentialAction("idle");
            }}
            onProviderUpdate={(patch) => {
              updateProvider(patch);
              setTestResult(null);
            }}
            onSave={() => void handleSave()}
            onClear={() => void handleClear()}
          />

          <SettingsVisibility
            visibility="developer"
            developerMode={developerMode}
          >
            <ModelConfiguration
              provider={provider}
              model={activeModel}
              onUpdate={updateActiveModel}
            />
          </SettingsVisibility>
        </div>
      </div>
    </div>
  );
}
