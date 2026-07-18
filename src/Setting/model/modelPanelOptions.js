export const CONTEXT_OPTIONS = [
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

export const OUTPUT_OPTIONS = [
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

export const CREDENTIAL_OPTIONS = [
  { value: "required", label: "必须" },
  { value: "optional", label: "可选" },
  { value: "none", label: "不使用" }
];

export const REASONING_MODE_OPTIONS = [
  { value: "auto", label: "自动" },
  { value: "disabled", label: "关闭" },
  { value: "enabled", label: "开启" },
  { value: "adaptive", label: "自适应" }
];

export const REASONING_EFFORT_OPTIONS = [
  { value: "default", label: "默认" },
  { value: "none", label: "None" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "XHigh" },
  { value: "max", label: "Max" }
];

export const VERBOSITY_OPTIONS = [
  { value: "default", label: "默认" },
  { value: "low", label: "简洁" },
  { value: "medium", label: "平衡" },
  { value: "high", label: "详细" }
];

export function apiModeOptions(provider) {
  if (provider.type === "openai") {
    return [
      { value: "responses", label: "Responses API" },
      { value: "chat", label: "Chat Completions" }
    ];
  }

  if (provider.type === "anthropic") {
    return [
      { value: "messages", label: "Messages API" }
    ];
  }

  return [
    { value: "chat", label: "Chat API" }
  ];
}

export function providerSdkLabel(provider) {
  return {
    deepseek: "DeepSeek SDK",
    openai: "OpenAI SDK",
    anthropic: "Anthropic SDK",
    ollama: "Ollama SDK",
    "openai-compatible": "OpenAI Compatible SDK"
  }[provider.type] ?? "AI SDK";
}

export function credentialDescription(
  provider,
  status,
  loading
) {
  if (provider.credentialMode === "none") {
    return "该提供商不会发送 API Key。";
  }

  if (loading) {
    return "正在读取凭据状态…";
  }

  if (!status.configured) {
    return provider.credentialMode === "optional"
      ? "API Key 可选，适用于本地或无鉴权服务。"
      : "尚未保存 API Key。密钥只保存在主进程凭据存储中。";
  }

  if (status.source === "environment") {
    return `当前使用环境变量 ${status.environmentKey || provider.environmentKey}。`;
  }

  return status.protected
    ? "API Key 已使用系统安全存储加密。"
    : "API Key 已保存，但当前系统未提供安全存储。";
}

export function createModelId() {
  return `model-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

export function createModelTemplate(provider) {
  const source = provider.models[0];

  return {
    id: createModelId(),
    name: "新模型",
    modelId:
      provider.id === "ollama"
        ? "gemma3"
        : source?.modelId ?? "model-id",
    apiMode:
      apiModeOptions(provider)[0].value,
    contextTokenBudget:
      source?.contextTokenBudget ?? 64000,
    temperature:
      source?.temperature ?? 0.7,
    topP: source?.topP ?? 1,
    seed: null,
    maxOutputTokens:
      Math.min(
        source?.maxOutputTokens ?? 8192,
        source?.contextTokenBudget ?? 64000
      ),
    maxRetries: source?.maxRetries ?? 1,
    timeoutMs: source?.timeoutMs ?? 120000,
    reasoningMode: "auto",
    reasoningEffort: "default",
    reasoningBudgetTokens: 4096,
    textVerbosity: "default"
  };
}
