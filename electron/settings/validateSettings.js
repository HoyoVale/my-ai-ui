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
        )
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

    model: {
      provider:
        enumValue(
          model.provider,
          [
            "deepseek"
          ],
          defaults.model.provider
        ),

      model:
        nonEmptyStringValue(
          model.model,
          defaults.model.model,
          120
        ),

      baseURL:
        urlValue(
          model.baseURL,
          defaults.model.baseURL
        ),

      temperature:
        numberValue(
          model.temperature,
          defaults.model.temperature,
          0,
          2
        ),

      maxOutputTokens:
        integerValue(
          model.maxOutputTokens,
          defaults.model
            .maxOutputTokens,
          128,
          16384
        ),

      timeoutMs:
        integerValue(
          model.timeoutMs,
          defaults.model.timeoutMs,
          15000,
          300000
        )
    }
  };
}
