import {
  createAnthropic
} from "@ai-sdk/anthropic";

import {
  createDeepSeek
} from "@ai-sdk/deepseek";

import {
  createOpenAI
} from "@ai-sdk/openai";

import {
  createOpenAICompatible
} from "@ai-sdk/openai-compatible";

import {
  createOllama
} from "ollama-ai-provider-v2";

function trimTrailingSlash(value) {
  return String(value ?? "")
    .replace(/\/+$/u, "");
}

export function normalizeOllamaBaseURL(value) {
  const normalized =
    trimTrailingSlash(value) ||
    "http://127.0.0.1:11434/api";

  if (/\/v1$/u.test(normalized)) {
    return normalized.replace(
      /\/v1$/u,
      "/api"
    );
  }

  if (
    !/\/api$/u.test(normalized)
  ) {
    return `${normalized}/api`;
  }

  return normalized;
}

function providerOptionKey(value) {
  const words = String(value ?? "provider")
    .replace(/[^a-z0-9]+/giu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);

  if (words.length === 0) {
    return "provider";
  }

  return words
    .map((word, index) => {
      const lower = word.toLowerCase();

      return index === 0
        ? lower
        : `${lower[0]?.toUpperCase() ?? ""}${lower.slice(1)}`;
    })
    .join("");
}

function reasoningEnabled(modelSettings) {
  return [
    "enabled",
    "adaptive"
  ].includes(
    modelSettings.reasoningMode
  );
}

function buildOpenAIOptions(modelSettings) {
  const options = {};

  if (
    modelSettings.reasoningEffort &&
    modelSettings.reasoningEffort !==
      "default"
  ) {
    options.reasoningEffort =
      modelSettings.reasoningEffort;
  }

  if (
    modelSettings.textVerbosity &&
    modelSettings.textVerbosity !==
      "default"
  ) {
    options.textVerbosity =
      modelSettings.textVerbosity;
  }

  return options;
}

function buildAnthropicOptions(modelSettings) {
  const mode =
    modelSettings.reasoningMode;

  if (mode === "disabled") {
    return {
      sendReasoning: false,
      thinking: {
        type: "disabled"
      }
    };
  }

  if (mode === "enabled") {
    return {
      sendReasoning: true,
      thinking: {
        type: "enabled",
        budgetTokens:
          modelSettings
            .reasoningBudgetTokens
      }
    };
  }

  if (mode === "adaptive") {
    return {
      sendReasoning: true,
      thinking: {
        type: "adaptive",
        display: "summarized"
      }
    };
  }

  return {};
}

function buildOllamaOptions(modelSettings) {
  const options = {
    num_ctx:
      modelSettings
        .contextTokenBudget,
    num_predict:
      modelSettings
        .maxOutputTokens,
    top_p:
      modelSettings.topP
  };

  if (
    Number.isInteger(
      modelSettings.seed
    )
  ) {
    options.seed =
      modelSettings.seed;
  }

  const result = {
    options
  };

  if (
    modelSettings.reasoningMode ===
      "enabled"
  ) {
    result.think = true;
  }

  if (
    modelSettings.reasoningMode ===
      "disabled"
  ) {
    result.think = false;
  }

  return result;
}

function nonEmptyOptions(value) {
  return Object.keys(value).length > 0
    ? value
    : undefined;
}

const SDK_ADAPTERS = Object.freeze({
  deepseek: {
    label: "DeepSeek SDK",
    create({ modelSettings, apiKey, fetchImplementation }) {
      const provider = createDeepSeek({
        apiKey,
        baseURL:
          trimTrailingSlash(
            modelSettings.baseURL
          ),
        fetch: fetchImplementation
      });

      return {
        model: provider.chat(
          modelSettings.model
        ),
        providerOptions: undefined
      };
    }
  },

  openai: {
    label: "OpenAI SDK",
    create({ modelSettings, apiKey, fetchImplementation }) {
      const provider = createOpenAI({
        apiKey,
        baseURL:
          trimTrailingSlash(
            modelSettings.baseURL
          ),
        fetch: fetchImplementation
      });

      const apiMode =
        modelSettings.apiMode === "chat"
          ? "chat"
          : "responses";

      return {
        model:
          apiMode === "chat"
            ? provider.chat(
                modelSettings.model
              )
            : provider.responses(
                modelSettings.model
              ),
        providerOptions:
          nonEmptyOptions({
            openai:
              buildOpenAIOptions(
                modelSettings
              )
          }),
        apiMode
      };
    }
  },

  anthropic: {
    label: "Anthropic SDK",
    create({ modelSettings, apiKey, fetchImplementation }) {
      const provider =
        createAnthropic({
          apiKey,
          baseURL:
            trimTrailingSlash(
              modelSettings.baseURL
            ),
          fetch: fetchImplementation
        });

      const anthropicOptions =
        buildAnthropicOptions(
          modelSettings
        );

      return {
        model: provider.messages(
          modelSettings.model
        ),
        providerOptions:
          Object.keys(
            anthropicOptions
          ).length > 0
            ? {
                anthropic:
                  anthropicOptions
              }
            : undefined,
        apiMode: "messages"
      };
    }
  },

  ollama: {
    label: "Ollama SDK",
    create({ modelSettings, apiKey, fetchImplementation }) {
      const provider = createOllama({
        baseURL:
          normalizeOllamaBaseURL(
            modelSettings.baseURL
          ),
        compatibility: "strict",
        headers: apiKey
          ? {
              Authorization:
                `Bearer ${apiKey}`
            }
          : undefined,
        fetch: fetchImplementation
      });

      return {
        model: provider.chat(
          modelSettings.model
        ),
        providerOptions: {
          ollama:
            buildOllamaOptions(
              modelSettings
            )
        },
        apiMode: "chat"
      };
    }
  },

  "openai-compatible": {
    label:
      "OpenAI Compatible SDK",
    create({ modelSettings, apiKey, fetchImplementation }) {
      const optionKey =
        providerOptionKey(
          modelSettings.providerId
        );

      const provider =
        createOpenAICompatible({
          name: optionKey,
          apiKey:
            apiKey || undefined,
          baseURL:
            trimTrailingSlash(
              modelSettings.baseURL
            ),
          includeUsage: true,
          fetch: fetchImplementation
        });

      const compatibleOptions =
        buildOpenAIOptions(
          modelSettings
        );

      return {
        model: provider.chatModel(
          modelSettings.model
        ),
        providerOptions:
          Object.keys(
            compatibleOptions
          ).length > 0
            ? {
                [optionKey]:
                  compatibleOptions
              }
            : undefined,
        apiMode: "chat"
      };
    }
  }
});

export function getSdkAdapter(
  providerType
) {
  return SDK_ADAPTERS[
    providerType
  ] ?? null;
}

export function createSdkModel({
  modelSettings,
  apiKey,
  fetchImplementation
}) {
  const adapter = getSdkAdapter(
    modelSettings.provider
  );

  if (!adapter) {
    throw new Error(
      `暂不支持模型提供商：${modelSettings.provider}`
    );
  }

  const result = adapter.create({
    modelSettings,
    apiKey,
    fetchImplementation
  });

  return {
    ...result,
    sdk: adapter.label,
    apiMode:
      result.apiMode ??
      modelSettings.apiMode ??
      "auto",
    reasoningEnabled:
      reasoningEnabled(
        modelSettings
      )
  };
}

export function buildSdkRequestOptions(
  modelSettings,
  providerOptions
) {
  return {
    temperature:
      modelSettings.temperature,
    topP: modelSettings.topP,
    seed:
      Number.isInteger(
        modelSettings.seed
      )
        ? modelSettings.seed
        : undefined,
    maxOutputTokens:
      modelSettings
        .maxOutputTokens,
    maxRetries:
      modelSettings.maxRetries,
    providerOptions
  };
}

export const SDK_PROVIDER_TYPES =
  Object.freeze(
    Object.keys(SDK_ADAPTERS)
  );
