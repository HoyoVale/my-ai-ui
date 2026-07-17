import {
  cloneDefaultSettings
} from "./defaultSettings.js";

const PROVIDER_TYPES = [
  "deepseek",
  "anthropic",
  "openai-compatible"
];

const CREDENTIAL_MODES = [
  "required",
  "optional",
  "none"
];

const TYPOGRAPHY_WINDOWS = [
  "pet",
  "input",
  "response",
  "conversation",
  "memory",
  "setting"
];

const DENSITY_OPTIONS = [
  "compact",
  "comfortable",
  "spacious"
];

function clamp(value, min, max) {
  return Math.min(
    Math.max(value, min),
    max
  );
}

function numberValue(
  value,
  fallback,
  min,
  max
) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return clamp(numeric, min, max);
}

function integerValue(
  value,
  fallback,
  min,
  max
) {
  return Math.round(
    numberValue(
      value,
      fallback,
      min,
      max
    )
  );
}

function booleanValue(
  value,
  fallback
) {
  return typeof value === "boolean"
    ? value
    : fallback;
}

function enumValue(
  value,
  allowed,
  fallback
) {
  return allowed.includes(value)
    ? value
    : fallback;
}

function stringValue(
  value,
  fallback,
  maxLength = 120
) {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.slice(0, maxLength);
}

function nonEmptyStringValue(
  value,
  fallback,
  maxLength = 120
) {
  const normalized = stringValue(
    value,
    fallback,
    maxLength
  ).trim();

  return normalized || fallback;
}

function urlValue(value, fallback) {
  const normalized = nonEmptyStringValue(
    value,
    fallback,
    300
  ).replace(/\/+$/, "");

  try {
    const parsed = new URL(normalized);

    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:"
    ) {
      return fallback;
    }

    return normalized;
  } catch {
    return fallback;
  }
}

function colorValue(value, fallback) {
  if (
    typeof value !== "string" ||
    !/^#[0-9a-f]{6}$/i.test(value)
  ) {
    return fallback;
  }

  return value.toLowerCase();
}

function positionValue(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return null;
  }

  return {
    x: Math.round(x),
    y: Math.round(y)
  };
}

function sanitizeTypography(
  appearance,
  defaults,
  legacyInput,
  legacyResponse
) {
  const source =
    appearance.typography ?? {};

  const typography = {};

  for (
    const windowId
    of TYPOGRAPHY_WINDOWS
  ) {
    const fallback =
      defaults.typography[windowId];

    const sourceWindow =
      source[windowId] ?? {};

    const legacyFontSize =
      windowId === "input"
        ? legacyInput.fontSize
        : windowId === "response"
          ? legacyResponse.fontSize
          : undefined;

    const legacyLineHeight =
      windowId === "response"
        ? legacyResponse.lineHeight
        : undefined;

    typography[windowId] = {
      fontSize: integerValue(
        sourceWindow.fontSize ??
          legacyFontSize,
        fallback.fontSize,
        10,
        28
      ),
      lineHeight: numberValue(
        sourceWindow.lineHeight ??
          legacyLineHeight,
        fallback.lineHeight,
        1.1,
        2.4
      ),
      density: enumValue(
        sourceWindow.density,
        DENSITY_OPTIONS,
        fallback.density
      )
    };
  }

  return typography;
}

function sanitizeModelList(
  sourceModels,
  fallbackModels,
  legacyContextTokenBudget,
  providerId
) {
  const candidates =
    Array.isArray(sourceModels) &&
    sourceModels.length > 0
      ? sourceModels.slice(0, 50)
      : fallbackModels;

  const usedIds = new Set();

  return candidates.map(
    (sourceModel, index) => {
      const fallback =
        fallbackModels[index] ??
        fallbackModels[0] ?? {
          id: `${providerId}-model`,
          name: "模型",
          modelId: "model-id",
          contextTokenBudget: 64000,
          temperature: 0.7,
          maxOutputTokens: 8192,
          timeoutMs: 120000
        };

      let id = nonEmptyStringValue(
        sourceModel?.id,
        sourceModel?.modelId ??
          fallback.id ??
          `${providerId}-model-${index + 1}`,
        120
      );

      if (usedIds.has(id)) {
        id = `${id}-${index + 1}`;
      }

      usedIds.add(id);

      const contextTokenBudget =
        integerValue(
          sourceModel?.contextTokenBudget ??
            legacyContextTokenBudget,
          fallback.contextTokenBudget ??
            64000,
          8192,
          2000000
        );

      return {
        id,
        name: nonEmptyStringValue(
          sourceModel?.name,
          sourceModel?.modelId ??
            fallback.name ??
            `模型 ${index + 1}`,
          120
        ),
        modelId: nonEmptyStringValue(
          sourceModel?.modelId ??
            sourceModel?.model,
          fallback.modelId ??
            "model-id",
          160
        ),
        contextTokenBudget,
        temperature: numberValue(
          sourceModel?.temperature,
          fallback.temperature ?? 0.7,
          0,
          2
        ),
        maxOutputTokens: integerValue(
          sourceModel?.maxOutputTokens,
          Math.min(
            fallback.maxOutputTokens ??
              2048,
            contextTokenBudget
          ),
          128,
          Math.min(
            384000,
            contextTokenBudget
          )
        ),
        timeoutMs: integerValue(
          sourceModel?.timeoutMs,
          fallback.timeoutMs ??
            120000,
          15000,
          600000
        )
      };
    }
  );
}

function sanitizeProvider(
  providerId,
  source,
  fallback,
  legacyContextTokenBudget
) {
  const normalizedId =
    nonEmptyStringValue(
      source?.id,
      providerId,
      80
    );

  const fallbackModels =
    Array.isArray(fallback?.models)
      ? fallback.models
      : [];

  const models = sanitizeModelList(
    source?.models,
    fallbackModels,
    legacyContextTokenBudget,
    normalizedId
  );

  const requestedActiveModelId =
    nonEmptyStringValue(
      source?.activeModelId,
      models[0].id,
      120
    );

  return {
    id: normalizedId,
    type: enumValue(
      source?.type,
      PROVIDER_TYPES,
      fallback?.type ??
        "openai-compatible"
    ),
    name: nonEmptyStringValue(
      source?.name,
      fallback?.name ??
        normalizedId,
      80
    ),
    baseURL: urlValue(
      source?.baseURL,
      fallback?.baseURL ??
        "http://localhost:1234/v1"
    ),
    credentialMode: enumValue(
      source?.credentialMode,
      CREDENTIAL_MODES,
      fallback?.credentialMode ??
        "required"
    ),
    environmentKey: stringValue(
      source?.environmentKey,
      fallback?.environmentKey ?? "",
      80
    )
      .trim()
      .replace(/[^A-Z0-9_]/gi, "")
      .toUpperCase(),
    activeModelId:
      models.some(
        (item) =>
          item.id ===
          requestedActiveModelId
      )
        ? requestedActiveModelId
        : models[0].id,
    models
  };
}

function sanitizeModelSettings(
  model,
  defaults,
  legacyContextTokenBudget
) {
  const hasLegacyShape =
    typeof model.model === "string" ||
    typeof model.baseURL === "string" ||
    typeof model.provider === "string" ||
    model.temperature !== undefined ||
    model.maxOutputTokens !== undefined ||
    model.timeoutMs !== undefined;

  const sourceProviders = {
    ...model.providers
  };

  if (hasLegacyShape) {
    sourceProviders.deepseek = {
      ...defaults.providers.deepseek,
      baseURL: model.baseURL,
      activeModelId: "migrated-model",
      models: [
        {
          id: "migrated-model",
          name:
            model.model ??
            "DeepSeek",
          modelId: model.model,
          contextTokenBudget:
            legacyContextTokenBudget,
          temperature:
            model.temperature,
          maxOutputTokens:
            model.maxOutputTokens,
          timeoutMs:
            model.timeoutMs
        }
      ]
    };
  }

  const providerIds = new Set([
    ...Object.keys(defaults.providers),
    ...Object.keys(sourceProviders)
  ]);

  const providers = {};

  for (
    const providerId
    of [...providerIds].slice(0, 20)
  ) {
    const fallback =
      defaults.providers[providerId] ??
      defaults.providers.compatible;

    providers[providerId] =
      sanitizeProvider(
        providerId,
        sourceProviders[providerId],
        fallback,
        providerId === "deepseek"
          ? legacyContextTokenBudget
          : undefined
      );
  }

  const requestedProvider =
    nonEmptyStringValue(
      model.activeProvider,
      defaults.activeProvider,
      80
    );

  return {
    activeProvider:
      providers[requestedProvider]
        ? requestedProvider
        : defaults.activeProvider,
    providers
  };
}

export function sanitizeSettings(
  source = {}
) {
  const defaults =
    cloneDefaultSettings();

  const general =
    source.general ?? {};
  const pet = source.pet ?? {};
  const input = source.input ?? {};
  const response =
    source.response ?? {};
  const appearance =
    source.appearance ?? {};
  const personality =
    source.personality ?? {};
  const conversation =
    source.conversation ?? {};
  const memory =
    source.memory ?? {};
  const model = source.model ?? {};

  const typography =
    sanitizeTypography(
      appearance,
      defaults.appearance,
      input,
      response
    );

  return {
    general: {
      launchAtLogin: booleanValue(
        general.launchAtLogin,
        defaults.general.launchAtLogin
      ),
      rememberPetPosition:
        booleanValue(
          general.rememberPetPosition,
          defaults.general
            .rememberPetPosition
        )
    },

    pet: {
      scale: numberValue(
        pet.scale,
        defaults.pet.scale,
        0.4,
        2
      ),
      opacity: numberValue(
        pet.opacity,
        defaults.pet.opacity,
        0.1,
        1
      ),
      alwaysOnTop: booleanValue(
        pet.alwaysOnTop,
        defaults.pet.alwaysOnTop
      ),
      showInTaskbar: booleanValue(
        pet.showInTaskbar,
        defaults.pet.showInTaskbar
      ),
      shadowOpacity: numberValue(
        pet.shadowOpacity,
        defaults.pet.shadowOpacity,
        0,
        1
      ),
      position: positionValue(
        pet.position
      )
    },

    input: {
      extraWidth: integerValue(
        input.extraWidth,
        defaults.input.extraWidth,
        0,
        600
      ),
      gap: integerValue(
        input.gap,
        defaults.input.gap,
        0,
        120
      ),
      maxLines: integerValue(
        input.maxLines,
        defaults.input.maxLines,
        1,
        20
      ),
      fontSize:
        typography.input.fontSize,
      placeholder: stringValue(
        input.placeholder,
        defaults.input.placeholder,
        80
      ),
      backgroundOpacity: numberValue(
        input.backgroundOpacity,
        defaults.input
          .backgroundOpacity,
        0.2,
        1
      ),
      borderRadius: integerValue(
        input.borderRadius,
        defaults.input.borderRadius,
        0,
        48
      ),
      alwaysOnTop: booleanValue(
        input.alwaysOnTop,
        defaults.input.alwaysOnTop
      )
    },

    response: {
      gap: integerValue(
        response.gap,
        defaults.response.gap,
        0,
        160
      ),
      anchorRatio: numberValue(
        response.anchorRatio,
        defaults.response.anchorRatio,
        0,
        1
      ),
      preferredSide: enumValue(
        response.preferredSide,
        ["auto", "left", "right"],
        defaults.response
          .preferredSide
      ),
      bubbleMaxWidth: integerValue(
        response.bubbleMaxWidth,
        defaults.response
          .bubbleMaxWidth,
        180,
        1000
      ),
      contentMaxHeight: integerValue(
        response.contentMaxHeight,
        defaults.response
          .contentMaxHeight,
        80,
        900
      ),
      fontSize:
        typography.response.fontSize,
      lineHeight:
        typography.response.lineHeight,
      backgroundOpacity: numberValue(
        response.backgroundOpacity,
        defaults.response
          .backgroundOpacity,
        0.2,
        1
      ),
      borderRadius: integerValue(
        response.borderRadius,
        defaults.response
          .borderRadius,
        0,
        48
      ),
      alwaysOnTop: booleanValue(
        response.alwaysOnTop,
        defaults.response
          .alwaysOnTop
      ),
      autoCloseSeconds: enumValue(
        Number(
          response.autoCloseSeconds
        ),
        [0, 3, 5, 10, 20, 30, 60],
        defaults.response
          .autoCloseSeconds
      )
    },

    appearance: {
      theme: enumValue(
        appearance.theme,
        ["system", "light", "dark"],
        defaults.appearance.theme
      ),
      accentColor: colorValue(
        appearance.accentColor,
        defaults.appearance
          .accentColor
      ),
      reducedMotion: booleanValue(
        appearance.reducedMotion,
        defaults.appearance
          .reducedMotion
      ),
      fontFamily: enumValue(
        appearance.fontFamily,
        [
          "system",
          "humanist",
          "serif",
          "monospace",
          "custom"
        ],
        defaults.appearance
          .fontFamily
      ),
      customFontFamily: stringValue(
        appearance.customFontFamily,
        defaults.appearance
          .customFontFamily,
        180
      ).trim(),
      typography
    },

    personality: {
      enabled: booleanValue(
        personality.enabled,
        defaults.personality.enabled
      ),
      name: nonEmptyStringValue(
        personality.name,
        defaults.personality.name,
        60
      ),
      identity: nonEmptyStringValue(
        personality.identity,
        defaults.personality.identity,
        180
      ),
      language: enumValue(
        personality.language,
        ["auto", "zh-CN", "en-US"],
        defaults.personality.language
      ),
      tone: enumValue(
        personality.tone,
        [
          "natural",
          "friendly",
          "professional",
          "direct"
        ],
        defaults.personality.tone
      ),
      responseLength: enumValue(
        personality.responseLength,
        [
          "concise",
          "balanced",
          "detailed"
        ],
        defaults.personality
          .responseLength
      ),
      customInstructions:
        stringValue(
          personality
            .customInstructions,
          defaults.personality
            .customInstructions,
          4000
        ).trim()
    },

    conversation: {
      contextTurns: integerValue(
        conversation.contextTurns,
        defaults.conversation
          .contextTurns,
        1,
        50
      ),
      maxConversations: integerValue(
        conversation.maxConversations,
        defaults.conversation
          .maxConversations,
        10,
        500
      ),
      autoTitle: booleanValue(
        conversation.autoTitle,
        defaults.conversation.autoTitle
      ),
      saveAbortedReplies:
        booleanValue(
          conversation
            .saveAbortedReplies,
          defaults.conversation
            .saveAbortedReplies
        )
    },

    memory: {
      enabled: booleanValue(
        memory.enabled,
        defaults.memory.enabled
      ),
      maxInjected: integerValue(
        memory.maxInjected,
        defaults.memory.maxInjected,
        1,
        20
      ),
      minPriority: numberValue(
        memory.minPriority ??
          memory.minImportance,
        defaults.memory.minPriority,
        0,
        1
      )
    },

    model: sanitizeModelSettings(
      model,
      defaults.model,
      conversation
        .contextTokenBudget
    )
  };
}
