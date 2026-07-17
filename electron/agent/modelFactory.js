import {
  createDeepSeek
} from "@ai-sdk/deepseek";

import {
  getProviderApiKey
} from "./credentialStore.js";

import {
  AnthropicLanguageModel
} from "./providers/anthropicLanguageModel.js";

import {
  OpenAICompatibleLanguageModel
} from "./providers/openAICompatibleLanguageModel.js";

function getCredential(
  modelSettings
) {
  return getProviderApiKey({
    providerId:
      modelSettings.providerId,
    environmentKey:
      modelSettings.environmentKey
  });
}

export function getCredentialError(
  modelSettings
) {
  if (
    modelSettings.credentialMode !==
    "required"
  ) {
    return null;
  }

  if (getCredential(modelSettings)) {
    return null;
  }

  return `尚未配置 ${modelSettings.providerName} API Key。请先在 Setting → Model 中保存密钥。`;
}

function compatibleProviderName(
  providerId
) {
  return String(providerId ?? "provider")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "provider";
}

export function createConfiguredModel(
  modelSettings
) {
  const apiKey =
    getCredential(modelSettings);

  const credentialError =
    getCredentialError(
      modelSettings
    );

  if (credentialError) {
    throw new Error(
      credentialError
    );
  }

  if (
    modelSettings.provider ===
    "deepseek"
  ) {
    const provider = createDeepSeek({
      apiKey,
      baseURL:
        modelSettings.baseURL
    });

    return provider(
      modelSettings.model
    );
  }

  if (
    modelSettings.provider ===
    "anthropic"
  ) {
    return new AnthropicLanguageModel({
      apiKey,
      baseURL:
        modelSettings.baseURL,
      modelId:
        modelSettings.model
    });
  }

  if (
    modelSettings.provider ===
    "openai-compatible"
  ) {
    return new OpenAICompatibleLanguageModel({
      provider:
        compatibleProviderName(
          modelSettings.providerId
        ),
      apiKey:
        apiKey ||
        (modelSettings.providerId ===
        "ollama"
          ? "ollama"
          : ""),
      baseURL:
        modelSettings.baseURL,
      modelId:
        modelSettings.model
    });
  }

  throw new Error(
    `暂不支持模型提供商：${modelSettings.provider}`
  );
}
