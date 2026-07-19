export const SESSION_MODES = Object.freeze([
  "chat",
  "coding"
]);

export function normalizeSessionMode(
  value,
  fallback = "chat"
) {
  return SESSION_MODES.includes(value)
    ? value
    : fallback;
}

export function normalizeModelSelection(
  value
) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const providerId = String(
    value.providerId ?? ""
  ).trim();
  const modelConfigId = String(
    value.modelConfigId ?? value.modelId ?? ""
  ).trim();

  if (!providerId || !modelConfigId) {
    return null;
  }

  return {
    providerId,
    modelConfigId
  };
}

export function resolveModelBinding(
  modelSettings = {},
  selection = null
) {
  const providers = modelSettings.providers ?? {};
  const normalized = normalizeModelSelection(selection);
  const fallbackProvider =
    providers[modelSettings.activeProvider] ??
    providers.deepseek ??
    Object.values(providers)[0] ??
    null;
  const provider = normalized
    ? providers[normalized.providerId]
    : fallbackProvider;

  if (!provider) {
    return {
      selection: null,
      snapshot: null
    };
  }

  const models = Array.isArray(provider.models)
    ? provider.models
    : [];
  const model = normalized
    ? models.find(
        (item) => item.id === normalized.modelConfigId
      )
    : models.find(
        (item) => item.id === provider.activeModelId
      ) ?? models[0];

  if (!model) {
    return {
      selection: null,
      snapshot: null
    };
  }

  return {
    selection: {
      providerId: provider.id,
      modelConfigId: model.id
    },
    snapshot: {
      providerId: provider.id,
      providerName: String(provider.name ?? provider.id),
      modelConfigId: model.id,
      modelName: String(model.name ?? model.modelId ?? model.id),
      modelId: String(model.modelId ?? model.id)
    }
  };
}

export function applyModelSelection(
  modelSettings = {},
  selection = null
) {
  const binding = resolveModelBinding(
    modelSettings,
    selection
  );

  if (!binding.selection) {
    return structuredClone(modelSettings);
  }

  const output = structuredClone(modelSettings);
  const provider = output.providers?.[
    binding.selection.providerId
  ];

  if (!provider) {
    return output;
  }

  output.activeProvider = binding.selection.providerId;
  provider.activeModelId = binding.selection.modelConfigId;

  return output;
}
