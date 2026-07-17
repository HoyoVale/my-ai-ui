import {
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

const PROVIDERS = [
  {
    value: "deepseek",
    label: "DeepSeek"
  }
];

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

export function ModelPanel({
  settings,
  onUpdate
}) {
  const model =
    settings.model;

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
        await saveApiKey(
          apiKey
        );

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
              model
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
    empty:
      "请输入 API Key。",
    saving:
      "正在保存…",
    saved:
      "API Key 已保存。",
    cleared:
      "已清除本地 API Key。",
    error:
      "操作失败，请查看控制台。"
  }[credentialAction];

  return (
    <div className="settings-panel-stack">
      <SettingsSection
        title="模型服务"
        description="第一阶段仅接入 DeepSeek；后续可在同一层增加其他 Provider。"
      >
        <SettingRow
          title="供应商"
          description="模型请求只在 Electron 主进程中执行。"
        >
          <Select
            value={model.provider}
            options={PROVIDERS}
            onChange={(provider) => {
              onUpdate({
                provider
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="Base URL"
          description="官方地址为 https://api.deepseek.com，也可填写兼容网关地址。"
        >
          <TextInput
            value={model.baseURL}
            placeholder="https://api.deepseek.com"
            onChange={(baseURL) => {
              onUpdate({
                baseURL
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="模型 ID"
          description="常用值：deepseek-chat、deepseek-reasoner；也支持网关提供的自定义 ID。"
        >
          <TextInput
            value={model.model}
            placeholder="deepseek-chat"
            onChange={(modelId) => {
              onUpdate({
                model: modelId
              });
            }}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="API 凭据"
        description={
          credentialDescription(
            status,
            loading
          )
        }
      >
        <SettingRow
          title="API Key"
          description={
            credentialHint ??
            "输入后点击保存；设置 JSON 中不会出现明文密钥。"
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
        title="生成参数"
        description="这些参数从下一次消息开始生效。"
      >
        <SettingRow
          title="Temperature"
          description="数值越低越稳定，越高越发散。"
        >
          <Slider
            value={model.temperature}
            min={0}
            max={2}
            step={0.1}
            formatValue={(value) =>
              Number(value).toFixed(1)
            }
            onChange={(temperature) => {
              onUpdate({
                temperature
              });
            }}
          />
        </SettingRow>

        <SettingRow
          title="最大输出 Tokens"
          description="控制单次回复允许生成的最大长度。"
        >
          <Slider
            value={model.maxOutputTokens}
            min={128}
            max={16384}
            step={128}
            onChange={(maxOutputTokens) => {
              onUpdate({
                maxOutputTokens
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
                model.timeoutMs /
                1000
              )
            }
            min={15}
            max={300}
            step={5}
            unit=" 秒"
            onChange={(seconds) => {
              onUpdate({
                timeoutMs:
                  seconds * 1000
              });
            }}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="连接测试"
        description="发送一个极短请求，用于检查密钥、地址和模型名称。"
      >
        <SettingRow
          title="测试当前配置"
          description={
            testResult
              ? testResult.ok
                ? `连接成功 · ${testResult.latencyMs} ms · ${testResult.text || "已响应"}`
                : `连接失败 · ${testResult.message}`
              : "测试会产生极少量模型用量。"
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
