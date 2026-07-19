const MODEL_DEFAULTS = {
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
  textVerbosity: "default"
};

function modelDefaults(overrides) {
  return {
    ...MODEL_DEFAULTS,
    ...overrides
  };
}

const PROVIDERS = {
  deepseek: {
    id: "deepseek",
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
};

export const FALLBACK_SETTINGS = {
  general: {
    launchAtLogin: false,
    rememberPetPosition: true,
    developerMode: false
  },
  pet: {
    scale: 1,
    opacity: 1,
    alwaysOnTop: true,
    showInTaskbar: false,
    shadowOpacity: 0.16,
    position: null
  },
  input: {
    extraWidth: 40,
    gap: 4,
    maxLines: 6,
    fontSize: 14,
    placeholder: "Type a message...",
    backgroundOpacity: 1,
    borderRadius: 10,
    alwaysOnTop: false
  },
  response: {
    gap: 12,
    anchorRatio: 0.16,
    preferredSide: "auto",
    bubbleMaxWidth: 420,
    contentMaxHeight: 240,
    fontSize: 14,
    lineHeight: 1.55,
    backgroundOpacity: 0.97,
    borderRadius: 16,
    alwaysOnTop: true,
    autoCloseSeconds: 0
  },
  appearance: {
    theme: "system",
    accentColor: "#10a37f",
    reducedMotion: false,
    fontFamily: "system",
    customFontFamily: "",
    typography: {
      pet: { fontSize: 13, lineHeight: 1.4, letterSpacing: 0, density: "comfortable" },
      input: { fontSize: 14, lineHeight: 1.45, letterSpacing: 0, density: "comfortable" },
      response: { fontSize: 14, lineHeight: 1.55, letterSpacing: 0, density: "comfortable" },
      conversation: {
        fontSize: 16,
        lineHeight: 1.75,
        letterSpacing: -0.006,
        density: "comfortable",
        contentWidth: 768,
        messageSpacing: 34,
        paragraphSpacing: 1
      },
      memory: { fontSize: 14, lineHeight: 1.55, letterSpacing: 0, density: "comfortable" },
      setting: { fontSize: 14, lineHeight: 1.5, letterSpacing: 0, density: "comfortable" }
    }
  },
  personality: {
    enabled: true,
    name: "Xixi",
    identity: "运行在用户桌面上的轻量 AI 助手",
    language: "auto",
    tone: "natural",
    responseLength: "balanced",
    customInstructions: ""
  },
  conversation: {
    contextTurns: 8,
    maxConversations: 100,
    autoTitle: true,
    saveAbortedReplies: true
  },
  context: {
    environment: {
      enabled: true,
      profile: "standard",
      includeTime: true,
      includeLocale: true,
      includeSystem: true,
      includeApplication: true,
      includeRuntimeVersions: false,
      includeModel: true,
      includeWorkspace: true,
      includeTools: true,
      workspaceDetail: "summary",
      toolDetail: "profile"
    }
  },
  tools: {
    enabled: true,
    mode: "coding",
    profile: "workspace",
    display: {
      detailLevel: "detailed"
    },
    runtime: {
      maxSteps: 6,
      maxSegments: 24,
      maxNoProgressSegments: 3,
      maxFinalizationAttempts: 1,
      finalizationTimeoutMs: 30000,
      maxToolCalls: 100,
      maxToolCallsPerStep: 16,
      maxToolCallsPerBatch: 24,
      maxTotalToolCalls: 2000,
      maxToolRetries: 1,
      runTimeoutMs: 1800000,
      defaultTimeoutMs: 15000,
      maxIdenticalCalls: 3,
      saveToolHistory: true
    },
    workspace: {
      enabled: true,
      includeProjectRoot: true,
      roots: [],
      maxTextFileBytes: 2000000,
      maxReadLines: 1000,
      maxDirectoryEntries: 200,
      maxSearchResults: 100,
      maxSearchDepth: 6,
      maxHashFileBytes: 50000000
    },
    developer: {
      toolsetOverrides: {
        "core.runtime": "inherit",
        "workspace.read": "inherit",
        "agent.internal": "inherit"
      },
      toolOverrides: {}
    },
    toolsets: {
      "core.runtime": true,
      "workspace.read": true,
      "agent.internal": true
    },
    overrides: {
      get_current_time: true,
      convert_time_zone: true,
      calculate_date: true,
      calculator: true,
      get_runtime_info: true,
      get_agent_status: true,
      get_workspace_info: true,
      list_directory: true,
      stat_path: true,
      read_text_file: true,
      search_files: true,
      search_text: true,
      detect_project: true,
      compute_file_hash: true,
      update_plan: true,
      read_tool_result: true
    }
  },
  memory: {
    enabled: true,
    maxInjected: 5,
    minPriority: 0.3
  },
  model: {
    activeProvider: "deepseek",
    providers: structuredClone(PROVIDERS)
  }
};
