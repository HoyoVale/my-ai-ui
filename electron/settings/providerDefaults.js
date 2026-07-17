export const PROVIDER_DEFAULTS = Object.freeze({
  deepseek: {
    id: "deepseek",
    type: "deepseek",
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    credentialMode: "required",
    environmentKey: "DEEPSEEK_API_KEY",
    activeModelId: "deepseek-v4-flash",
    models: [
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        modelId: "deepseek-v4-flash",
        contextTokenBudget: 1000000,
        temperature: 0.7,
        maxOutputTokens: 32768,
        timeoutMs: 120000
      },
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        modelId: "deepseek-v4-pro",
        contextTokenBudget: 1000000,
        temperature: 0.7,
        maxOutputTokens: 32768,
        timeoutMs: 120000
      }
    ]
  },

  openai: {
    id: "openai",
    type: "openai-compatible",
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    credentialMode: "required",
    environmentKey: "OPENAI_API_KEY",
    activeModelId: "gpt-4-1-mini",
    models: [
      {
        id: "gpt-4-1-mini",
        name: "GPT-4.1 mini",
        modelId: "gpt-4.1-mini",
        contextTokenBudget: 1000000,
        temperature: 0.7,
        maxOutputTokens: 32768,
        timeoutMs: 120000
      }
    ]
  },

  anthropic: {
    id: "anthropic",
    type: "anthropic",
    name: "Anthropic",
    baseURL: "https://api.anthropic.com/v1",
    credentialMode: "required",
    environmentKey: "ANTHROPIC_API_KEY",
    activeModelId: "claude-sonnet-4-20250514",
    models: [
      {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        modelId: "claude-sonnet-4-20250514",
        contextTokenBudget: 200000,
        temperature: 0.7,
        maxOutputTokens: 32768,
        timeoutMs: 120000
      }
    ]
  },

  ollama: {
    id: "ollama",
    type: "openai-compatible",
    name: "Ollama",
    baseURL: "http://localhost:11434/v1",
    credentialMode: "optional",
    environmentKey: "OLLAMA_API_KEY",
    activeModelId: "gemma3",
    models: [
      {
        id: "gemma3",
        name: "Gemma 3",
        modelId: "gemma3",
        contextTokenBudget: 32768,
        temperature: 0.7,
        maxOutputTokens: 8192,
        timeoutMs: 180000
      }
    ]
  },

  compatible: {
    id: "compatible",
    type: "openai-compatible",
    name: "OpenAI-compatible",
    baseURL: "http://localhost:1234/v1",
    credentialMode: "optional",
    environmentKey: "",
    activeModelId: "compatible-model",
    models: [
      {
        id: "compatible-model",
        name: "Compatible model",
        modelId: "model-id",
        contextTokenBudget: 32768,
        temperature: 0.7,
        maxOutputTokens: 8192,
        timeoutMs: 120000
      }
    ]
  }
});

export function cloneProviderDefaults() {
  return structuredClone(PROVIDER_DEFAULTS);
}
