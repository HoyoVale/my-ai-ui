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

function normalizeSelection(selection) {
  if (!selection || typeof selection !== "object") {
    return null;
  }

  const providerId = String(selection.providerId ?? "").trim();
  const modelConfigId = String(selection.modelConfigId ?? "").trim();
  return providerId && modelConfigId
    ? { providerId, modelConfigId }
    : null;
}

export function getModelConfigBySelection(
  modelSettings = {},
  selection = null
) {
  const normalized = normalizeSelection(selection);
  if (!normalized) {
    return getActiveModelConfig(modelSettings);
  }

  const provider = modelSettings.providers?.[normalized.providerId];
  const model = provider?.models?.find(
    (item) => item.id === normalized.modelConfigId
  );
  if (!provider || !model) {
    throw new Error("指定的运行时模型已不存在，请重新选择模型。");
  }

  return {
    providerId: normalized.providerId,
    provider,
    model
  };
}

function resolveModelConfig(modelSettings, selection) {
  const { providerId, provider, model } =
    getModelConfigBySelection(modelSettings, selection);

  return {
    provider: provider.type ?? providerId,
    providerId,
    providerName: provider.name ?? providerId,
    baseURL: provider.baseURL,
    credentialMode: provider.credentialMode ?? "required",
    environmentKey: provider.environmentKey ?? "",
    modelConfigId: model.id,
    modelName: model.name ?? model.modelId,
    model: model.modelId,
    apiMode: model.apiMode ?? "auto",
    contextTokenBudget: model.contextTokenBudget,
    temperature: model.temperature,
    topP: model.topP ?? 1,
    seed: Number.isInteger(model.seed) ? model.seed : null,
    maxOutputTokens: model.maxOutputTokens,
    maxRetries: model.maxRetries ?? 1,
    timeoutMs: model.timeoutMs,
    reasoningMode: model.reasoningMode ?? "auto",
    reasoningEffort: model.reasoningEffort ?? "default",
    reasoningBudgetTokens: model.reasoningBudgetTokens ?? 4096,
    textVerbosity: model.textVerbosity ?? "default"
  };
}

export function resolveActiveModelSettings(
  modelSettings = {}
) {
  return resolveModelConfig(modelSettings, null);
}

export function resolveWorkerModelSettings(modelSettings = {}) {
  const selection = modelSettings.runtimeAssignments?.worker ?? null;
  return resolveModelConfig(modelSettings, selection);
}
