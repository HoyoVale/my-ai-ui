import {
  useMemo,
  useState
} from "react";

import {
  ActionButton,
  Select,
  SettingRow,
  SettingsSection,
  Slider,
  TextInput
} from "../components/Controls.jsx";

import {
  useModelCredentials
} from "../hooks/useModelCredentials.js";

const CONTEXT_OPTIONS = [
  8192,
  16384,
  32768,
  64000,
  128000,
  200000,
  256000,
  512000,
  1000000,
  2000000
].map((value) => ({
  value,
  label:
    value >= 1000000
      ? `${value / 1000000}M`
      : `${Math.round(value / 1000)}K`
}));

const OUTPUT_OPTIONS = [
  2048,
  4096,
  8192,
  16384,
  32768,
  65536,
  131072,
  262144,
  384000
].map((value) => ({
  value,
  label:
    value >= 100000
      ? `${Math.round(value / 1000)}K`
      : `${Math.round(value / 1024)}K`
}));

const CREDENTIAL_OPTIONS = [
  {
    value: "required",
    label: "必须"
  },
  {
    value: "optional",
    label: "可选"
  },
  {
    value: "none",
    label: "不使用"
  }
];

function credentialDescription(
  provider,
  status,
  loading
) {
  if (
    provider.credentialMode ===
    "none"
  ) {
    return "该提供商不会发送 API Key。";
  }

  if (loading) {
    return "正在读取凭据状态…";
  }

  if (!status.configured) {
    if (
      provider.credentialMode ===
      "optional"
    ) {
      return "API Key 可选；适用于本地 Ollama、LM Studio 等无需鉴权的服务。";
    }

    return "尚未保存 API Key。密钥只保存在主进程凭据存储中。";
  }

  if (status.source === "environment") {
    return `当前使用环境变量 ${status.environmentKey || provider.environmentKey}。`;
  }

  if (status.protected) {
    return "API Key 已使用系统安全存储加密。";
  }

  return "API Key 已保存，但当前系统未提供安全存储。";
}

function createModelId() {
  return `model-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

function createModelTemplate(
  provider
) {
  const source =
    provider.models[0];

  return {
    id: createModelId(),
    name: "新模型",
    modelId:
      provider.id === "ollama"
        ? "gemma3"
        : source?.modelId ??
          "model-id",
    contextTokenBudget:
      source?.contextTokenBudget ??
      64000,
    temperature:
      source?.temperature ?? 0.7,
    maxOutputTokens:
      Math.min(
        source?.maxOutputTokens ??
          8192,
        source?.contextTokenBudget ??
          64000
      ),
    timeoutMs:
      source?.timeoutMs ?? 120000
  };
}

export function ModelPanel({
  settings,
  onUpdate
}) {
  const modelSettings =
    settings.model;

  const providerId =
    modelSettings.activeProvider;

  const provider =
    modelSettings.providers[
      providerId
    ] ??
    Object.values(
      modelSettings.providers
    )[0];

  const activeModel = useMemo(
    () => {
      return provider.models.find(
        (item) =>
          item.id ===
          provider.activeModelId
      ) ?? provider.models[0];
    },
    [
      provider.activeModelId,
      provider.models
    ]
  );

  const [apiKey, setApiKey] =
    useState("");

  const [credentialAction, setCredentialAction] =
    useState("idle");

  const [testResult, setTestResult] =
    useState(null);

  const [testing, setTesting] =
    useState(false);

  const {
    status,
    loading,
    saveApiKey,
    clearApiKey
  } = useModelCredentials(provider);

  const updateProvider =
    (patch) => {
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

  const updateActiveModel =
    (patch) => {
      updateProvider({
        models:
          provider.models.map(
            (item) =>
              item.id ===
              activeModel.id
                ? {
                    ...item,
                    ...patch
                  }
                : item
          )
      });
    };

  const handleAddModel = () => {
    const model =
      createModelTemplate(provider);

    updateProvider({
      activeModelId: model.id,
      models: [
        ...provider.models,
        model
      ]
    });

    setTestResult(null);
  };

  const handleDeleteModel = () => {
    if (
      provider.models.length <= 1
    ) {
      return;
    }

    const remaining =
      provider.models.filter(
        (item) =>
          item.id !==
          activeModel.id
      );

    updateProvider({
      models: remaining,
      activeModelId:
        remaining[0].id
    });

    setTestResult(null);
  };

  const handleSaveApiKey =
    async () => {
      if (!apiKey.trim()) {
        setCredentialAction("empty");
        return;
      }

      setCredentialAction("saving");

      try {
        await saveApiKey(apiKey);
        setApiKey("");
        setCredentialAction("saved");
      } catch (error) {
        console.error(
          "保存 API Key 失败：",
          error
        );
        setCredentialAction("error");
      }
    };

  const handleClearApiKey =
    async () => {
      setCredentialAction("saving");

      try {
        await clearApiKey();
        setApiKey("");
        setCredentialAction("cleared");
      } catch (error) {
        console.error(
          "清除 API Key 失败：",
          error
        );
        setCredentialAction("error");
      }
    };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const result =
        await window.api
          ?.testModelConnection?.(
            modelSettings
          );

      setTestResult(
        result ?? {
          ok: false,
          message:
            "未收到测试结果。"
        }
      );
    } catch (error) {
      setTestResult({
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : String(error)
      });
    } finally {
      setTesting(false);
    }
  };

  const credentialHint = {
    empty: "请输入 API Key。",
    saving: "正在保存…",
    saved: "API Key 已保存。",
    cleared: "已清除本地 API Key。",
    error: "操作失败，请查看控制台。"
  }[credentialAction];

  const providerOptions =
    Object.values(
      modelSettings.providers
    ).map((item) => ({
      value: item.id,
      label: item.name
    }));

  return (
    <div className="settings-panel-stack">
      <SettingsSection
        title="当前模型"
        description="先选择提供商，再选择该提供商下实际使用的模型。"
      >
        <SettingRow
          title="提供商"
          description="DeepSeek 与 Anthropic 使用原生适配器；OpenAI、Ollama 和兼容服务使用 OpenAI-compatible 适配器。"
        >
          <Select
            testId="model-provider-select"
            value={providerId}
            options={providerOptions}
            onChange={(activeProvider) => {
              onUpdate({
                activeProvider
              });
              setApiKey("");
              setCredentialAction("idle");
              setTestResult(null);
            }}
          />
        </SettingRow>

        <SettingRow
          title="使用模型"
          description="模型参数与上下文容量会随选择一起切换。"
        >
          <div className="settings-model-picker">
            <Select
              testId="model-active-select"
              value={
                provider.activeModelId
              }
              options={
                provider.models.map(
                  (item) => ({
                    value: item.id,
                    label:
                      item.name ||
                      item.modelId
                  })
                )
              }
              onChange={(activeModelId) => {
                updateProvider({
                  activeModelId
                });
                setTestResult(null);
              }}
            />

            <ActionButton
              testId="model-add"
              onClick={handleAddModel}
            >
              添加模型
            </ActionButton>

            <ActionButton
              testId="model-delete"
              tone="danger"
              disabled={
                provider.models.length <= 1
              }
              onClick={handleDeleteModel}
            >
              删除
            </ActionButton>
          </div>
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="提供商配置"
        description="连接地址和凭据由当前提供商下的所有模型共享。"
      >
        <SettingRow
          title="显示名称"
          description="用于提供商选择器和错误提示。"
        >
          <TextInput
            value={provider.name}
            onChange={(name) => {
              updateProvider({ name });
            }}
          />
        </SettingRow>

        <SettingRow
          title="Base URL"
          description="填写 API 前缀；OpenAI-compatible 通常以 /v1 结尾。"
        >
          <TextInput
            value={provider.baseURL}
            placeholder="https://api.example.com/v1"
            onChange={(baseURL) => {
              updateProvider({
                baseURL
              });
              setTestResult(null);
            }}
          />
        </SettingRow>

        <SettingRow
          title="凭据模式"
          description="本地 Ollama 等服务可设为可选或不使用。"
        >
          <Select
            value={
              provider.credentialMode
            }
            options={CREDENTIAL_OPTIONS}
            onChange={(credentialMode) => {
              updateProvider({
                credentialMode
              });
              setTestResult(null);
            }}
          />
        </SettingRow>

        <SettingRow
          title="环境变量"
          description="没有保存本地密钥时，主进程会尝试读取该变量。留空表示不读取。"
        >
          <TextInput
            value={
              provider.environmentKey
            }
            placeholder="PROVIDER_API_KEY"
            onChange={(environmentKey) => {
              updateProvider({
                environmentKey:
                  environmentKey
                    .toUpperCase()
              });
            }}
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
                placeholder={
                  status.configured
                    ? "输入新密钥以替换"
                    : "sk-..."
                }
                autoComplete="off"
                onChange={(value) => {
                  setApiKey(value);
                  setCredentialAction("idle");
                }}
              />

              <ActionButton
                disabled={
                  credentialAction ===
                  "saving"
                }
                onClick={() => {
                  void handleSaveApiKey();
                }}
              >
                {status.configured
                  ? "替换"
                  : "保存"}
              </ActionButton>

              {status.configured && (
                <ActionButton
                  tone="danger"
                  disabled={
                    credentialAction ===
                    "saving"
                  }
                  onClick={() => {
                    void handleClearApiKey();
                  }}
                >
                  清除
                </ActionButton>
              )}
            </div>
          </SettingRow>
        )}
      </SettingsSection>

      <SettingsSection
        title="模型配置"
        description="每个模型独立保存上下文容量与生成参数。"
      >
        <SettingRow
          title="显示名称"
          description="只用于本地识别，不会发送给提供商。"
        >
          <TextInput
            testId="model-display-name"
            value={activeModel.name}
            placeholder="模型名称"
            onChange={(name) => {
              updateActiveModel({ name });
            }}
          />
        </SettingRow>

        <SettingRow
          title="模型 ID"
          description="填写 API 请求实际使用的模型名称。"
        >
          <TextInput
            testId="model-id-input"
            value={activeModel.modelId}
            placeholder="model-id"
            onChange={(modelId) => {
              updateActiveModel({
                modelId
              });
              setTestResult(null);
            }}
          />
        </SettingRow>

        <SettingRow
          title="上下文 Token 上限"
          description="Context 面板会使用该容量计算当前输入占用和最坏情况预算。"
        >
          <Select
            testId="model-context-limit"
            value={
              activeModel
                .contextTokenBudget
            }
            options={CONTEXT_OPTIONS}
            onChange={(
              contextTokenBudget
            ) => {
              updateActiveModel({
                contextTokenBudget,
                maxOutputTokens:
                  Math.min(
                    activeModel
                      .maxOutputTokens,
                    contextTokenBudget
                  )
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="最大输出 Tokens"
          description="作为单次生成上限，同时用于最坏情况请求预算。"
        >
          <Select
            value={
              activeModel
                .maxOutputTokens
            }
            options={
              OUTPUT_OPTIONS.filter(
                (item) =>
                  item.value <=
                  activeModel
                    .contextTokenBudget
              )
            }
            onChange={(maxOutputTokens) => {
              updateActiveModel({
                maxOutputTokens
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="Temperature"
          description="数值越低越稳定；部分推理模型可能忽略该参数。"
        >
          <Slider
            value={activeModel.temperature}
            min={0}
            max={2}
            step={0.1}
            formatValue={(value) =>
              Number(value).toFixed(1)
            }
            onChange={(temperature) => {
              updateActiveModel({
                temperature
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="请求超时"
          description="超过该时间后自动终止本次请求。"
        >
          <Slider
            value={Math.round(
              activeModel.timeoutMs /
              1000
            )}
            min={15}
            max={600}
            step={5}
            unit=" 秒"
            onChange={(seconds) => {
              updateActiveModel({
                timeoutMs:
                  seconds * 1000
              });
            }}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="连接测试"
        description="使用当前提供商与模型发送一个极短请求。"
      >
        <SettingRow
          title="测试当前模型"
          description={
            testResult
              ? testResult.ok
                ? `连接成功 · ${testResult.latencyMs} ms · ${testResult.text || "已响应"}`
                : `连接失败 · ${testResult.message}`
              : `${provider.name} · ${activeModel.name} · ${activeModel.modelId}`
          }
        >
          <ActionButton
            disabled={testing}
            onClick={() => {
              void handleTest();
            }}
          >
            {testing
              ? "测试中…"
              : "测试连接"}
          </ActionButton>
        </SettingRow>
      </SettingsSection>
    </div>
  );
}
