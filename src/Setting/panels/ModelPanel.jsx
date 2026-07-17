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
  256000,
  512000,
  1000000
].map((value) => ({
  value,
  label:
    value >= 1000000
      ? "1M"
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

function credentialDescription(
  status,
  loading
) {
  if (loading) {
    return "正在读取凭据状态…";
  }

  if (!status.configured) {
    return "尚未保存 API Key。密钥不会广播到其他渲染窗口。";
  }

  if (
    status.source ===
    "environment"
  ) {
    return "当前使用 .env 中的 DEEPSEEK_API_KEY。";
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
    ];

  const activeModel =
    useMemo(() => {
      return provider.models.find(
        (item) =>
          item.id ===
          provider.activeModelId
      ) ?? provider.models[0];
    }, [
      provider.activeModelId,
      provider.models
    ]);

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
  } = useModelCredentials();

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
    const id = createModelId();

    updateProvider({
      activeModelId: id,
      models: [
        ...provider.models,
        {
          id,
          name: "新模型",
          modelId:
            "deepseek-v4-flash",
          contextTokenBudget:
            1000000,
          temperature: 0.7,
          maxOutputTokens: 32768,
          timeoutMs: 120000
        }
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
        setCredentialAction(
          "empty"
        );
        return;
      }

      setCredentialAction(
        "saving"
      );

      try {
        await saveApiKey(apiKey);
        setApiKey("");
        setCredentialAction(
          "saved"
        );
      } catch (error) {
        console.error(
          "保存 API Key 失败：",
          error
        );
        setCredentialAction(
          "error"
        );
      }
    };

  const handleClearApiKey =
    async () => {
      setCredentialAction(
        "saving"
      );

      try {
        await clearApiKey();
        setApiKey("");
        setCredentialAction(
          "cleared"
        );
      } catch (error) {
        console.error(
          "清除 API Key 失败：",
          error
        );
        setCredentialAction(
          "error"
        );
      }
    };

  const handleTest =
    async () => {
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
    cleared:
      "已清除本地 API Key。",
    error:
      "操作失败，请查看控制台。"
  }[credentialAction];

  return (
    <div className="settings-panel-stack">
      <SettingsSection
        title="当前模型"
        description="一个提供商可以保存多个模型配置。这里选择的模型会用于下一次请求。"
      >
        <SettingRow
          title="提供商"
          description="当前阶段只启用 DeepSeek，后续提供商会复用同一套模型配置结构。"
        >
          <Select
            value={providerId}
            options={[
              {
                value: "deepseek",
                label: "DeepSeek"
              }
            ]}
            onChange={() => {}}
          />
        </SettingRow>

        <SettingRow
          title="使用模型"
          description={`${provider.models.length} 个已配置模型。`}
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
        description="Base URL 和 API Key 由同一提供商下的所有模型共享。"
      >
        <SettingRow
          title="Base URL"
          description="官方 OpenAI 兼容地址为 https://api.deepseek.com，也可填写兼容网关。"
        >
          <TextInput
            value={provider.baseURL}
            placeholder="https://api.deepseek.com"
            onChange={(baseURL) => {
              updateProvider({
                baseURL
              });
              setTestResult(null);
            }}
          />
        </SettingRow>

        <SettingRow
          title="API Key"
          description={
            credentialHint ??
            credentialDescription(
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
                setCredentialAction(
                  "idle"
                );
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
      </SettingsSection>

      <SettingsSection
        title="模型配置"
        description="上下文上限和生成参数分别保存在当前模型中，切换模型时会一起切换。"
      >
        <SettingRow
          title="显示名称"
          description="只用于设置页面识别，不会发送给提供商。"
        >
          <TextInput
            testId="model-display-name"
            value={activeModel.name}
            placeholder="DeepSeek V4 Flash"
            onChange={(name) => {
              updateActiveModel({
                name
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="模型 ID"
          description="填写 API 请求使用的实际模型名，例如 deepseek-v4-flash 或 deepseek-v4-pro。"
        >
          <TextInput
            testId="model-id-input"
            value={activeModel.modelId}
            placeholder="deepseek-v4-flash"
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
          description="用于上下文预算、输入剩余量和溢出提醒。该值应与实际模型规格一致。"
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
          description="控制单次回复允许生成的最大长度，并作为上下文预算中的输出预留。"
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
          description="数值越低越稳定，越高越发散。部分推理模型可能忽略该参数。"
        >
          <Slider
            value={
              activeModel.temperature
            }
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
            value={
              Math.round(
                activeModel.timeoutMs /
                1000
              )
            }
            min={15}
            max={300}
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
        description="使用当前选中的模型发送一个极短请求。"
      >
        <SettingRow
          title="测试当前模型"
          description={
            testResult
              ? testResult.ok
                ? `连接成功 · ${testResult.latencyMs} ms · ${testResult.text || "已响应"}`
                : `连接失败 · ${testResult.message}`
              : `${activeModel.name} · ${activeModel.modelId}`
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
