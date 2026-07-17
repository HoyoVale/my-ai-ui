import {
  PROVIDER_DEFAULTS
} from "./providerDefaults.js";

const FALLBACK_PROVIDER =
  PROVIDER_DEFAULTS.deepseek;

export function getActiveProviderConfig(
  modelSettings = {}
) {
  const providerId = String(
    modelSettings.activeProvider ??
      "deepseek"
  );

  const providers =
    modelSettings.providers ?? {};

  const provider =
    providers[providerId] ??
    providers.deepseek ??
    Object.values(providers)[0] ??
    FALLBACK_PROVIDER;

  return {
    providerId:
      provider.id ?? providerId,
    provider
  };
}

export function getActiveModelConfig(
  modelSettings = {}
) {
  const {
    providerId,
    provider
  } = getActiveProviderConfig(
    modelSettings
  );

  const models =
    Array.isArray(provider.models)
      ? provider.models
      : [];

  const model = models.find(
    (item) =>
      item.id ===
      provider.activeModelId
  ) ?? models[0];

  if (!model) {
    throw new Error(
      `提供商 ${provider.name ?? providerId} 没有可用模型。`
    );
  }

  return {
    providerId,
    provider,
    model
  };
}

export function resolveActiveModelSettings(
  modelSettings = {}
) {
  const {
    providerId,
    provider,
    model
  } = getActiveModelConfig(
    modelSettings
  );

  return {
    provider:
      provider.type ?? providerId,
    providerId,
    providerName:
      provider.name ?? providerId,
    baseURL: provider.baseURL,
    credentialMode:
      provider.credentialMode ??
      "required",
    environmentKey:
      provider.environmentKey ?? "",
    modelConfigId: model.id,
    modelName:
      model.name ?? model.modelId,
    model: model.modelId,
    contextTokenBudget:
      model.contextTokenBudget,
    temperature: model.temperature,
    maxOutputTokens:
      model.maxOutputTokens,
    timeoutMs: model.timeoutMs
  };
}
