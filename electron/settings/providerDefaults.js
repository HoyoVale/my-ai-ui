function modelDefaults(overrides) {
  return {
    apiMode: "auto",
    contextTokenBudget: 64000,
    temperature: 0.7,
    topP: 1,
    seed: null,
    maxOutputTokens: 8192,
    maxRetries: 1,
    timeoutMs: 120000,
    reasoningMode: "auto",
    reasoningEffort: "default",
    reasoningBudgetTokens: 4096,
    textVerbosity: "default",
    ...overrides
  };
}

export const PROVIDER_DEFAULTS = Object.freeze({
  deepseek: {
    id: "deepseek",
    configured: false,
    type: "deepseek",
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    credentialMode: "required",
    environmentKey: "DEEPSEEK_API_KEY",
    activeModelId: "deepseek-v4-flash",
    models: [
      modelDefaults({
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        modelId: "deepseek-v4-flash",
        apiMode: "chat",
        contextTokenBudget: 1000000,
        maxOutputTokens: 32768
      }),
      modelDefaults({
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        modelId: "deepseek-v4-pro",
        apiMode: "chat",
        contextTokenBudget: 1000000,
        maxOutputTokens: 32768
      })
    ]
  },

  openai: {
    id: "openai",
    configured: false,
    type: "openai",
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    credentialMode: "required",
    environmentKey: "OPENAI_API_KEY",
    activeModelId: "gpt-5-2",
    models: [
      modelDefaults({
        id: "gpt-5-2",
        name: "GPT-5.2",
        modelId: "gpt-5.2",
        apiMode: "responses",
        contextTokenBudget: 128000,
        maxOutputTokens: 16384
      })
    ]
  },

  anthropic: {
    id: "anthropic",
    configured: false,
    type: "anthropic",
    name: "Anthropic",
    baseURL: "https://api.anthropic.com/v1",
    credentialMode: "required",
    environmentKey: "ANTHROPIC_API_KEY",
    activeModelId: "claude-sonnet-4-6",
    models: [
      modelDefaults({
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        modelId: "claude-sonnet-4-6",
        apiMode: "messages",
        contextTokenBudget: 200000,
        maxOutputTokens: 32768
      })
    ]
  },

  ollama: {
    id: "ollama",
    configured: false,
    type: "ollama",
    name: "Ollama",
    baseURL: "http://127.0.0.1:11434/api",
    credentialMode: "optional",
    environmentKey: "OLLAMA_API_KEY",
    activeModelId: "gemma3",
    models: [
      modelDefaults({
        id: "gemma3",
        name: "Gemma 3",
        modelId: "gemma3",
        apiMode: "chat",
        contextTokenBudget: 32768,
        maxOutputTokens: 8192,
        timeoutMs: 180000
      })
    ]
  },

  compatible: {
    id: "compatible",
    configured: false,
    type: "openai-compatible",
    name: "OpenAI-compatible",
    baseURL: "http://localhost:1234/v1",
    credentialMode: "optional",
    environmentKey: "",
    activeModelId: "compatible-model",
    models: [
      modelDefaults({
        id: "compatible-model",
        name: "Compatible model",
        modelId: "model-id",
        apiMode: "chat",
        contextTokenBudget: 32768,
        maxOutputTokens: 8192
      })
    ]
  }
});

export function cloneProviderDefaults() {
  return structuredClone(PROVIDER_DEFAULTS);
}
