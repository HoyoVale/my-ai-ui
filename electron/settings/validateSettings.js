import {
  cloneDefaultSettings
} from "./defaultSettings.js";

function clamp(
  value,
  min,
  max
) {
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
  const numeric =
    Number(value);

  if (
    !Number.isFinite(
      numeric
    )
  ) {
    return fallback;
  }

  return clamp(
    numeric,
    min,
    max
  );
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
  return typeof value ===
    "boolean"
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
  if (
    typeof value !== "string"
  ) {
    return fallback;
  }

  return value
    .slice(0, maxLength);
}

function nonEmptyStringValue(
  value,
  fallback,
  maxLength = 120
) {
  const normalized =
    stringValue(
      value,
      fallback,
      maxLength
    ).trim();

  return normalized || fallback;
}

function urlValue(
  value,
  fallback
) {
  const normalized =
    nonEmptyStringValue(
      value,
      fallback,
      300
    ).replace(/\/+$/, "");

  try {
    const parsed =
      new URL(normalized);

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

function colorValue(
  value,
  fallback
) {
  if (
    typeof value !== "string" ||
    !/^#[0-9a-f]{6}$/i.test(
      value
    )
  ) {
    return fallback;
  }

  return value.toLowerCase();
}

function positionValue(
  value
) {
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

function sanitizeModelList(
  sourceModels,
  fallbackModels,
  legacyContextTokenBudget
) {
  const candidates =
    Array.isArray(sourceModels) &&
    sourceModels.length > 0
      ? sourceModels
      : fallbackModels;

  const usedIds = new Set();

  return candidates.map(
    (sourceModel, index) => {
      const fallback =
        fallbackModels[index] ??
        fallbackModels[0];

      let id =
        nonEmptyStringValue(
          sourceModel?.id,
          sourceModel?.modelId ??
          fallback?.id ??
          `model-${index + 1}`,
          120
        );

      if (usedIds.has(id)) {
        id = `${id}-${index + 1}`;
      }

      usedIds.add(id);

      const contextTokenBudget =
        integerValue(
          sourceModel
            ?.contextTokenBudget ??
          legacyContextTokenBudget,
          fallback
            ?.contextTokenBudget ??
          64000,
          8192,
          1000000
        );

      return {
        id,

        name:
          nonEmptyStringValue(
            sourceModel?.name,
            sourceModel?.modelId ??
            fallback?.name ??
            `模型 ${index + 1}`,
            120
          ),

        modelId:
          nonEmptyStringValue(
            sourceModel?.modelId ??
            sourceModel?.model,
            fallback?.modelId ??
            "deepseek-v4-flash",
            160
          ),

        contextTokenBudget,

        temperature:
          numberValue(
            sourceModel?.temperature,
            fallback?.temperature ??
            0.7,
            0,
            2
          ),

        maxOutputTokens:
          integerValue(
            sourceModel
              ?.maxOutputTokens,
            Math.min(
              fallback
                ?.maxOutputTokens ??
              2048,
              contextTokenBudget
            ),
            128,
            Math.min(
              384000,
              contextTokenBudget
            )
          ),

        timeoutMs:
          integerValue(
            sourceModel?.timeoutMs,
            fallback?.timeoutMs ??
            120000,
            15000,
            300000
          )
      };
    }
  );
}

function sanitizeModelSettings(
  model,
  defaults,
  legacyContextTokenBudget
) {
  const defaultProvider =
    defaults.providers.deepseek;

  const hasLegacyShape =
    typeof model.model === "string" ||
    typeof model.baseURL === "string" ||
    typeof model.provider === "string" ||
    model.temperature !== undefined ||
    model.maxOutputTokens !== undefined ||
    model.timeoutMs !== undefined;

  const providerSource =
    hasLegacyShape
      ? {
          id: "deepseek",
          type:
            model.provider ??
            "deepseek",
          name: "DeepSeek",
          baseURL:
            model.baseURL,
          activeModelId:
            "migrated-model",
          models: [
            {
              id: "migrated-model",
              name:
                model.model ??
                "DeepSeek",
              modelId:
                model.model,
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
        }
      : model.providers
          ?.deepseek ??
        defaultProvider;

  const models =
    sanitizeModelList(
      providerSource.models,
      defaultProvider.models,
      legacyContextTokenBudget
    );

  const requestedActiveModelId =
    nonEmptyStringValue(
      providerSource.activeModelId,
      models[0].id,
      120
    );

  const activeModelId =
    models.some(
      (item) =>
        item.id ===
        requestedActiveModelId
    )
      ? requestedActiveModelId
      : models[0].id;

  return {
    activeProvider: "deepseek",

    providers: {
      deepseek: {
        id: "deepseek",
        type: "deepseek",
        name:
          nonEmptyStringValue(
            providerSource.name,
            "DeepSeek",
            80
          ),
        baseURL:
          urlValue(
            providerSource.baseURL,
            defaultProvider.baseURL
          ),
        activeModelId,
        models
      }
    }
  };
}

export function sanitizeSettings(
  source = {}
) {
  const defaults =
    cloneDefaultSettings();

  const general =
    source.general ?? {};

  const pet =
    source.pet ?? {};

  const input =
    source.input ?? {};

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

  const model =
    source.model ?? {};

  return {
    general: {
      launchAtLogin:
        booleanValue(
          general.launchAtLogin,
          defaults.general
            .launchAtLogin
        ),

      rememberPetPosition:
        booleanValue(
          general
            .rememberPetPosition,

          defaults.general
            .rememberPetPosition
        )
    },

    pet: {
      scale:
        numberValue(
          pet.scale,
          defaults.pet.scale,
          0.4,
          2
        ),

      opacity:
        numberValue(
          pet.opacity,
          defaults.pet.opacity,
          0.1,
          1
        ),

      alwaysOnTop:
        booleanValue(
          pet.alwaysOnTop,
          defaults.pet
            .alwaysOnTop
        ),

      showInTaskbar:
        booleanValue(
          pet.showInTaskbar,
          defaults.pet
            .showInTaskbar
        ),

      shadowOpacity:
        numberValue(
          pet.shadowOpacity,
          defaults.pet
            .shadowOpacity,
          0,
          1
        ),

      position:
        positionValue(
          pet.position
        )
    },

    input: {
      extraWidth:
        integerValue(
          input.extraWidth,
          defaults.input
            .extraWidth,
          0,
          600
        ),

      gap:
        integerValue(
          input.gap,
          defaults.input.gap,
          0,
          120
        ),

      maxLines:
        integerValue(
          input.maxLines,
          defaults.input.maxLines,
          1,
          20
        ),

      fontSize:
        integerValue(
          input.fontSize,
          defaults.input.fontSize,
          10,
          28
        ),

      placeholder:
        stringValue(
          input.placeholder,
          defaults.input
            .placeholder,
          80
        ),

      backgroundOpacity:
        numberValue(
          input
            .backgroundOpacity,

          defaults.input
            .backgroundOpacity,

          0.2,
          1
        ),

      borderRadius:
        integerValue(
          input.borderRadius,
          defaults.input
            .borderRadius,
          0,
          48
        ),

      alwaysOnTop:
        booleanValue(
          input.alwaysOnTop,
          defaults.input
            .alwaysOnTop
        )
    },

    response: {
      gap:
        integerValue(
          response.gap,
          defaults.response.gap,
          0,
          160
        ),

      anchorRatio:
        numberValue(
          response.anchorRatio,
          defaults.response
            .anchorRatio,
          0,
          1
        ),

      preferredSide:
        enumValue(
          response.preferredSide,
          [
            "auto",
            "left",
            "right"
          ],
          defaults.response
            .preferredSide
        ),

      bubbleMaxWidth:
        integerValue(
          response
            .bubbleMaxWidth,

          defaults.response
            .bubbleMaxWidth,

          180,
          1000
        ),

      contentMaxHeight:
        integerValue(
          response
            .contentMaxHeight,

          defaults.response
            .contentMaxHeight,

          80,
          900
        ),

      fontSize:
        integerValue(
          response.fontSize,
          defaults.response
            .fontSize,
          10,
          28
        ),

      lineHeight:
        numberValue(
          response.lineHeight,
          defaults.response
            .lineHeight,
          1.1,
          2.4
        ),

      backgroundOpacity:
        numberValue(
          response
            .backgroundOpacity,

          defaults.response
            .backgroundOpacity,

          0.2,
          1
        ),

      borderRadius:
        integerValue(
          response.borderRadius,
          defaults.response
            .borderRadius,
          0,
          48
        ),

      alwaysOnTop:
        booleanValue(
          response.alwaysOnTop,
          defaults.response
            .alwaysOnTop
        ),

      autoCloseSeconds:
        enumValue(
          Number(
            response
              .autoCloseSeconds
          ),

          [
            0,
            3,
            5,
            10,
            20,
            30,
            60
          ],

          defaults.response
            .autoCloseSeconds
        )
    },

    appearance: {
      theme:
        enumValue(
          appearance.theme,
          [
            "system",
            "light",
            "dark"
          ],
          defaults.appearance
            .theme
        ),

      accentColor:
        colorValue(
          appearance.accentColor,
          defaults.appearance
            .accentColor
        ),

      reducedMotion:
        booleanValue(
          appearance
            .reducedMotion,

          defaults.appearance
            .reducedMotion
        )
    },

    personality: {
      enabled:
        booleanValue(
          personality.enabled,
          defaults.personality
            .enabled
        ),

      name:
        nonEmptyStringValue(
          personality.name,
          defaults.personality.name,
          60
        ),

      identity:
        nonEmptyStringValue(
          personality.identity,
          defaults.personality
            .identity,
          180
        ),

      language:
        enumValue(
          personality.language,
          [
            "auto",
            "zh-CN",
            "en-US"
          ],
          defaults.personality
            .language
        ),

      tone:
        enumValue(
          personality.tone,
          [
            "natural",
            "friendly",
            "professional",
            "direct"
          ],
          defaults.personality
            .tone
        ),

      responseLength:
        enumValue(
          personality
            .responseLength,
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
      contextTurns:
        integerValue(
          conversation
            .contextTurns,

          defaults.conversation
            .contextTurns,

          1,
          50
        ),

      maxConversations:
        integerValue(
          conversation
            .maxConversations,

          defaults.conversation
            .maxConversations,

          10,
          500
        ),

      autoTitle:
        booleanValue(
          conversation.autoTitle,
          defaults.conversation
            .autoTitle
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
      enabled:
        booleanValue(
          memory.enabled,
          defaults.memory.enabled
        ),

      maxInjected:
        integerValue(
          memory.maxInjected,
          defaults.memory
            .maxInjected,
          1,
          20
        ),

      minPriority:
        numberValue(
          memory.minPriority ??
          memory.minImportance,
          defaults.memory
            .minPriority,
          0,
          1
        )
    },

    model:
      sanitizeModelSettings(
        model,
        defaults.model,
        conversation
          .contextTokenBudget
      )
  };
}
