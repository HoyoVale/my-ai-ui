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
          0.7,
          1.4
        ),

      opacity:
        numberValue(
          pet.opacity,
          defaults.pet.opacity,
          0.4,
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
          0.45
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
          240
        ),

      gap:
        integerValue(
          input.gap,
          defaults.input.gap,
          0,
          40
        ),

      maxLines:
        integerValue(
          input.maxLines,
          defaults.input.maxLines,
          2,
          10
        ),

      fontSize:
        integerValue(
          input.fontSize,
          defaults.input.fontSize,
          12,
          18
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

          0.7,
          1
        ),

      borderRadius:
        integerValue(
          input.borderRadius,
          defaults.input
            .borderRadius,
          6,
          20
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
          4,
          40
        ),

      anchorRatio:
        numberValue(
          response.anchorRatio,
          defaults.response
            .anchorRatio,
          0,
          0.8
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

          240,
          620
        ),

      contentMaxHeight:
        integerValue(
          response
            .contentMaxHeight,

          defaults.response
            .contentMaxHeight,

          120,
          520
        ),

      fontSize:
        integerValue(
          response.fontSize,
          defaults.response
            .fontSize,
          12,
          18
        ),

      lineHeight:
        numberValue(
          response.lineHeight,
          defaults.response
            .lineHeight,
          1.35,
          1.9
        ),

      backgroundOpacity:
        numberValue(
          response
            .backgroundOpacity,

          defaults.response
            .backgroundOpacity,

          0.75,
          1
        ),

      borderRadius:
        integerValue(
          response.borderRadius,
          defaults.response
            .borderRadius,
          8,
          28
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
            5,
            10,
            20
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

    model: {
      provider:
        stringValue(
          model.provider,
          defaults.model.provider,
          80
        ),

      model:
        stringValue(
          model.model,
          defaults.model.model,
          120
        )
    }
  };
}
