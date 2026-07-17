const FALLBACK_PROVIDER = {
  id: "deepseek",
  type: "deepseek",
  name: "DeepSeek",
  baseURL: "https://api.deepseek.com",
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
    }
  ]
};

export function getActiveProviderConfig(
  modelSettings = {}
) {
  const providerId =
    String(
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

  const model =
    models.find(
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
    modelConfigId: model.id,
    modelName:
      model.name ?? model.modelId,
    model: model.modelId,
    contextTokenBudget:
      model.contextTokenBudget,
    temperature:
      model.temperature,
    maxOutputTokens:
      model.maxOutputTokens,
    timeoutMs:
      model.timeoutMs
  };
}
