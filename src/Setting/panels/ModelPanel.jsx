import {
  useMemo,
  useState
} from "react";

import {
  WORKER_RUNTIME_DEFAULTS,
  WORKER_RUNTIME_LIMITS
} from "../../shared/runtimeDefaults.js";

import {
  ActionButton,
  Select,
  SettingRow,
  Slider,
  TextInput
} from "../components/Controls.jsx";

import {
  useModelCredentials
} from "../hooks/useModelCredentials.js";

import {
  useConversations
} from "../hooks/useConversations.js";

import {
  MODEL_PROVIDER_TEMPLATES
} from "../../shared/defaultSettings.js";

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

function createProviderFromTemplate(
  templateId,
  existingProviders
) {
  const source =
    MODEL_PROVIDER_TEMPLATES[templateId];

  if (!source) {
    return null;
  }

  const provider =
    structuredClone(source);

  let providerId =
    provider.id;

  if (existingProviders[providerId]) {
    providerId =
      `${provider.id}-${Date.now().toString(36)}`;
  }

  provider.id = providerId;
  provider.configured = true;

  if (providerId !== source.id) {
    provider.name = `${provider.name} 2`;
  }

  return provider;
}

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

function encodeSelection(providerId, modelConfigId) {
  return `${providerId}::${modelConfigId}`;
}

function decodeSelection(value) {
  const [providerId, modelConfigId] = String(value ?? "").split("::");
  return providerId && modelConfigId
    ? { providerId, modelConfigId }
    : null;
}

function RuntimeAssignments({
  modelSettings,
  currentModelSelection,
  currentConversationId,
  onSelectCurrentModel,
  onUpdate
}) {
  const options = Object.values(modelSettings.providers ?? {})
    .flatMap((item) => (item.models ?? []).map((model) => ({
      value: encodeSelection(item.id, model.id),
      label: `${item.name} · ${model.name || model.modelId}`
    })));
  const activeProvider = modelSettings.providers?.[modelSettings.activeProvider];
  const defaultValue = activeProvider
    ? encodeSelection(
        activeProvider.id,
        activeProvider.activeModelId ?? activeProvider.models?.[0]?.id
      )
    : "";
  const selectedCurrentValue = currentModelSelection
    ? encodeSelection(
        currentModelSelection.providerId,
        currentModelSelection.modelConfigId
      )
    : "";
  const mainValue = options.some((item) => item.value === selectedCurrentValue)
    ? selectedCurrentValue
    : defaultValue;
  const workerSelection = modelSettings.runtimeAssignments?.worker;
  const workerValue = workerSelection
    ? encodeSelection(workerSelection.providerId, workerSelection.modelConfigId)
    : defaultValue;

  const selectMain = (value) => {
    const selection = decodeSelection(value);
    if (!selection) return;
    onSelectCurrentModel?.(selection);
  };

  const selectDefault = (value) => {
    const selection = decodeSelection(value);
    if (!selection) return;
    const selectedProvider = modelSettings.providers[selection.providerId];
    onUpdate({
      activeProvider: selection.providerId,
      providers: {
        ...modelSettings.providers,
        [selection.providerId]: {
          ...selectedProvider,
          activeModelId: selection.modelConfigId
        }
      }
    });
  };

  const selectWorker = (value) => {
    const selection = decodeSelection(value);
    if (!selection) return;
    onUpdate({
      runtimeAssignments: {
        ...(modelSettings.runtimeAssignments ?? {}),
        worker: selection
      }
    });
  };

  return (
    <section className="model-runtime-assignments" data-testid="model-runtime-assignments">
      <div>
        <span className="model-eyebrow">Runtime routing</span>
        <strong>主模型与 Worker 独立配置</strong>
        <small>会话由主模型负责；多 Agent 子任务统一使用 Worker 模型。</small>
      </div>
      <SettingRow title="主模型">
        <Select
          testId="main-model-assignment"
          value={mainValue}
          options={options}
          onChange={selectMain}
          disabled={!currentConversationId}
        />
      </SettingRow>
      <SettingRow title="新会话默认模型">
        <Select
          testId="default-model-assignment"
          value={defaultValue}
          options={options}
          onChange={selectDefault}
        />
      </SettingRow>
      <SettingRow title="Worker 模型">
        <Select
          testId="worker-model-assignment"
          value={workerValue}
          options={options}
          onChange={selectWorker}
        />
      </SettingRow>
      <SettingRow title="Worker 并发数">
        <Slider
          value={modelSettings.runtimeAssignments?.maxConcurrency ?? WORKER_RUNTIME_DEFAULTS.maxConcurrency}
          min={WORKER_RUNTIME_LIMITS.maxConcurrency.min}
          max={WORKER_RUNTIME_LIMITS.maxConcurrency.max}
          step={1}
          unit=" 个"
          onChange={(maxConcurrency) => onUpdate({
            runtimeAssignments: {
              ...(modelSettings.runtimeAssignments ?? {}),
              maxConcurrency
            }
          })}
        />
      </SettingRow>
      <SettingRow title="一次多 Agent 运行 Token 预算">
        <Slider
          value={modelSettings.runtimeAssignments?.tokenBudget ?? WORKER_RUNTIME_DEFAULTS.tokenBudget}
          min={WORKER_RUNTIME_LIMITS.tokenBudget.min}
          max={WORKER_RUNTIME_LIMITS.tokenBudget.max}
          step={WORKER_RUNTIME_LIMITS.tokenBudget.step}
          unit=" tokens"
          onChange={(tokenBudget) => onUpdate({
            runtimeAssignments: {
              ...(modelSettings.runtimeAssignments ?? {}),
              tokenBudget
            }
          })}
        />
      </SettingRow>
      <SettingRow title="一次多 Agent 运行步骤预算">
        <Slider
          value={modelSettings.runtimeAssignments?.stepBudget ?? WORKER_RUNTIME_DEFAULTS.stepBudget}
          min={WORKER_RUNTIME_LIMITS.stepBudget.min}
          max={WORKER_RUNTIME_LIMITS.stepBudget.max}
          step={WORKER_RUNTIME_LIMITS.stepBudget.step}
          unit=" 步"
          onChange={(stepBudget) => onUpdate({
            runtimeAssignments: {
              ...(modelSettings.runtimeAssignments ?? {}),
              stepBudget
            }
          })}
        />
      </SettingRow>
      <SettingRow title="一次多 Agent 运行时间预算">
        <Slider
          value={modelSettings.runtimeAssignments?.timeBudgetMinutes ?? WORKER_RUNTIME_DEFAULTS.timeBudgetMinutes}
          min={WORKER_RUNTIME_LIMITS.timeBudgetMinutes.min}
          max={WORKER_RUNTIME_LIMITS.timeBudgetMinutes.max}
          step={WORKER_RUNTIME_LIMITS.timeBudgetMinutes.step}
          unit=" 分钟"
          onChange={(timeBudgetMinutes) => onUpdate({
            runtimeAssignments: {
              ...(modelSettings.runtimeAssignments ?? {}),
              timeBudgetMinutes
            }
          })}
        />
      </SettingRow>
    </section>
  );
}

function ProviderConnection({
  provider,
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
  onUpdate
}) {
  const modelSettings = settings.model;
  const conversations = useConversations();
  const currentModelSelection =
    conversations.state.currentModelSelection ??
    conversations.state.currentConversation?.modelSelection ??
    null;
  const providers =
    modelSettings.providers ?? {};
  const providerId =
    modelSettings.activeProvider;
  const provider =
    providers[providerId] ??
    Object.values(providers)[0] ??
    null;

  const activeModel = useMemo(
    () => provider?.models?.find(
      (item) => item.id === provider.activeModelId
    ) ?? provider?.models?.[0] ?? null,
    [provider]
  );
  const currentProvider = currentModelSelection
    ? providers[currentModelSelection.providerId]
    : provider;
  const currentModel = currentProvider?.models?.find((item) =>
    item.id === currentModelSelection?.modelConfigId
  ) ?? currentProvider?.models?.find((item) =>
    item.id === currentProvider.activeModelId
  ) ?? currentProvider?.models?.[0] ?? null;

  const availableTemplateIds =
    Object.keys(MODEL_PROVIDER_TEMPLATES)
      .filter((templateId) => !providers[templateId]);

  const [providerTemplateId, setProviderTemplateId] =
    useState(availableTemplateIds[0] ?? "compatible");
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

  const addProvider = () => {
    const nextProvider =
      createProviderFromTemplate(
        providerTemplateId,
        providers
      );

    if (!nextProvider) {
      return;
    }

    onUpdate({
      activeProvider: nextProvider.id,
      providers: {
        ...providers,
        [nextProvider.id]: nextProvider
      }
    });

    setProviderTemplateId(
      availableTemplateIds.find((id) => id !== providerTemplateId) ??
      "compatible"
    );
  };

  const updateProvider = (patch) => {
    if (!provider) {
      return;
    }

    onUpdate({
      providers: {
        ...modelSettings.providers,
        [providerId]: {
          ...provider,
          configured: true,
          ...patch
        }
      }
    });
  };

  const selectCurrentModel = (selection) => {
    if (!selection?.providerId || !selection?.modelConfigId) {
      return;
    }
    void conversations.setModel(
      selection.providerId,
      selection.modelConfigId
    );
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
      updateProvider({ configured: true });
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

  if (!provider || !activeModel) {
    const templateOptions =
      Object.values(MODEL_PROVIDER_TEMPLATES).map((item) => ({
        value: item.id,
        label: item.name
      }));

    return (
      <div className="model-panel">
        <div className="model-runtime-summary">
          <div>
            <span className="model-eyebrow">Models</span>
            <strong>尚未添加模型</strong>
            <small>添加一个 Provider 后，模型才会出现在 Input 菜单中。</small>
          </div>

          <div className="model-runtime-summary__actions">
            <Select
              testId="model-provider-template-select"
              value={providerTemplateId}
              options={templateOptions}
              onChange={setProviderTemplateId}
            />
            <ActionButton
              testId="model-provider-add"
              onClick={addProvider}
            >
              添加提供商
            </ActionButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="model-panel">
      <RuntimeAssignments
        modelSettings={modelSettings}
        currentModelSelection={currentModelSelection}
        currentConversationId={conversations.state.currentConversationId}
        onSelectCurrentModel={selectCurrentModel}
        onUpdate={onUpdate}
      />

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
          <strong>
            {currentProvider?.name ?? "未配置"} · {currentModel?.name ?? "未配置"}
          </strong>
          <small>
            {currentProvider ? providerSdkLabel(currentProvider) : ""}
            {currentModel ? ` · ${currentModel.modelId}` : ""}
          </small>
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
            <ModelConfiguration
              provider={provider}
              model={activeModel}
              onUpdate={updateActiveModel}
            />
</div>
      </div>

      <details
        className="model-config-card"
        data-testid="model-provider-add-section"
      >
        <summary>
          <span>
            <strong>添加提供商</strong>
            <small>模板只用于创建配置，不会自动出现在 Input 模型列表。</small>
          </span>
        </summary>
        <div className="model-config-card__body">
          <SettingRow title="Provider 模板">
            <div className="settings-credential-control">
              <Select
                testId="model-provider-template-select"
                value={providerTemplateId}
                options={Object.values(MODEL_PROVIDER_TEMPLATES).map((item) => ({
                  value: item.id,
                  label: item.name
                }))}
                onChange={setProviderTemplateId}
              />
              <ActionButton
                testId="model-provider-add"
                onClick={addProvider}
              >
                添加
              </ActionButton>
            </div>
          </SettingRow>
        </div>
      </details>
    </div>
  );
}
