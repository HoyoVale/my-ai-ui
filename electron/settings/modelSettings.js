export function getActiveProviderConfig(
  modelSettings = {}
) {
  const providers =
    modelSettings.providers ?? {};

  const requestedProviderId = String(
    modelSettings.activeProvider ?? ""
  ).trim();

  const provider =
    providers[requestedProviderId] ??
    Object.values(providers)[0] ??
    null;

  if (!provider) {
    throw new Error(
      "尚未配置可用模型，请先在模型设置中添加提供商和模型。"
    );
  }

  return {
    providerId:
      provider.id ??
      requestedProviderId,
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
    apiMode:
      model.apiMode ?? "auto",
    contextTokenBudget:
      model.contextTokenBudget,
    temperature: model.temperature,
    topP: model.topP ?? 1,
    seed:
      Number.isInteger(model.seed)
        ? model.seed
        : null,
    maxOutputTokens:
      model.maxOutputTokens,
    maxRetries:
      model.maxRetries ?? 1,
    timeoutMs: model.timeoutMs,
    reasoningMode:
      model.reasoningMode ?? "auto",
    reasoningEffort:
      model.reasoningEffort ??
      "default",
    reasoningBudgetTokens:
      model.reasoningBudgetTokens ??
      4096,
    textVerbosity:
      model.textVerbosity ??
      "default"
  };
}
