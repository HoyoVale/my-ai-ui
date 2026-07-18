import {
  cloneDefaultSettings
} from "./defaultSettings.js";

import {
  SAFE_TOOL_NAMES,
  TOOLSET_IDS
} from "../tools/toolCatalog.js";

const PROVIDER_TYPES = [
  "deepseek",
  "openai",
  "anthropic",
  "ollama",
  "openai-compatible"
];

const API_MODES = [
  "auto",
  "responses",
  "chat",
  "messages"
];

const REASONING_MODES = [
  "auto",
  "disabled",
  "enabled",
  "adaptive"
];

const REASONING_EFFORTS = [
  "default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
];

const TEXT_VERBOSITIES = [
  "default",
  "low",
  "medium",
  "high"
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

const ENVIRONMENT_PROFILES = [
  "minimal",
  "standard",
  "detailed",
  "custom"
];

const WORKSPACE_DETAIL_OPTIONS = [
  "hidden",
  "summary",
  "full"
];

const TOOL_DETAIL_OPTIONS = [
  "hidden",
  "profile",
  "names"
];

const TOOL_MODES = [
  "chat",
  "coding"
];

const TOOL_DETAIL_LEVELS = [
  "detailed"
];

const TOOL_OVERRIDE_VALUES = [
  "inherit",
  "enabled",
  "disabled"
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

function nullableIntegerValue(
  value,
  fallback,
  min,
  max
) {
  if (
    value === null ||
    value === "" ||
    value === undefined
  ) {
    return fallback ?? null;
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback ?? null;
  }

  return Math.round(
    clamp(numeric, min, max)
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

    const sanitizedWindow = {
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
      letterSpacing: numberValue(
        sourceWindow.letterSpacing,
        fallback.letterSpacing ?? 0,
        -0.05,
        0.08
      ),
      density: enumValue(
        sourceWindow.density,
        DENSITY_OPTIONS,
        fallback.density
      )
    };

    if (windowId === "conversation") {
      sanitizedWindow.contentWidth =
        integerValue(
          sourceWindow.contentWidth,
          fallback.contentWidth,
          560,
          1080
        );

      sanitizedWindow.messageSpacing =
        integerValue(
          sourceWindow.messageSpacing,
          fallback.messageSpacing,
          16,
          72
        );

      sanitizedWindow.paragraphSpacing =
        numberValue(
          sourceWindow.paragraphSpacing,
          fallback.paragraphSpacing,
          0.5,
          1.8
        );
    }

    typography[windowId] =
      sanitizedWindow;
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
          apiMode: "auto",
          contextTokenBudget: 64000,
          temperature: 0.7,
          topP: 1,
          seed: null,
          maxOutputTokens: 8192,
          maxRetries: 1,
          timeoutMs: 120000,
          reasoningMode: "auto",
          reasoningEffort: "default",
          reasoningBudgetTokens: 4096,
          textVerbosity: "default"
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

      const maxOutputTokens =
        integerValue(
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
        apiMode: enumValue(
          sourceModel?.apiMode,
          API_MODES,
          fallback.apiMode ?? "auto"
        ),
        contextTokenBudget,
        temperature: numberValue(
          sourceModel?.temperature,
          fallback.temperature ?? 0.7,
          0,
          2
        ),
        topP: numberValue(
          sourceModel?.topP,
          fallback.topP ?? 1,
          0,
          1
        ),
        seed: nullableIntegerValue(
          sourceModel?.seed,
          fallback.seed ?? null,
          0,
          2147483647
        ),
        maxOutputTokens,
        maxRetries: integerValue(
          sourceModel?.maxRetries,
          fallback.maxRetries ?? 1,
          0,
          5
        ),
        timeoutMs: integerValue(
          sourceModel?.timeoutMs,
          fallback.timeoutMs ??
            120000,
          15000,
          600000
        ),
        reasoningMode: enumValue(
          sourceModel?.reasoningMode,
          REASONING_MODES,
          fallback.reasoningMode ??
            "auto"
        ),
        reasoningEffort: enumValue(
          sourceModel?.reasoningEffort,
          REASONING_EFFORTS,
          fallback.reasoningEffort ??
            "default"
        ),
        reasoningBudgetTokens:
          integerValue(
            sourceModel
              ?.reasoningBudgetTokens,
            Math.min(
              fallback
                .reasoningBudgetTokens ??
                4096,
              maxOutputTokens
            ),
            1024,
            Math.max(
              1024,
              maxOutputTokens
            )
          ),
        textVerbosity: enumValue(
          sourceModel?.textVerbosity,
          TEXT_VERBOSITIES,
          fallback.textVerbosity ??
            "default"
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

  let requestedType = source?.type;

  if (
    providerId === "openai" &&
    requestedType ===
      "openai-compatible"
  ) {
    requestedType = "openai";
  }

  if (
    providerId === "ollama" &&
    requestedType ===
      "openai-compatible"
  ) {
    requestedType = "ollama";
  }

  const type = enumValue(
    requestedType,
    PROVIDER_TYPES,
    fallback?.type ??
      "openai-compatible"
  );

  let baseURL = urlValue(
    source?.baseURL,
    fallback?.baseURL ??
      "http://localhost:1234/v1"
  );

  if (type === "ollama") {
    baseURL = baseURL
      .replace(/\/v1$/u, "/api")
      .replace(/\/+$/u, "");

    if (!/\/api$/u.test(baseURL)) {
      baseURL = `${baseURL}/api`;
    }
  }

  return {
    id: normalizedId,
    type,
    name: nonEmptyStringValue(
      source?.name,
      fallback?.name ??
        normalizedId,
      80
    ),
    baseURL,
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

function stringArrayValue(
  value,
  fallback = [],
  maxItems = 12,
  maxLength = 500
) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  return [
    ...new Set(
      value
        .slice(0, maxItems)
        .map((item) =>
          typeof item === "string"
            ? item.trim().slice(0, maxLength)
            : ""
        )
        .filter(Boolean)
    )
  ];
}

function sanitizeContextSettings(
  context,
  defaults
) {
  const environment =
    context?.environment ?? {};
  const fallback =
    defaults.environment;

  return {
    environment: {
      enabled: booleanValue(
        environment.enabled,
        fallback.enabled
      ),
      profile: enumValue(
        environment.profile,
        ENVIRONMENT_PROFILES,
        fallback.profile
      ),
      includeTime: booleanValue(
        environment.includeTime,
        fallback.includeTime
      ),
      includeLocale: booleanValue(
        environment.includeLocale,
        fallback.includeLocale
      ),
      includeSystem: booleanValue(
        environment.includeSystem,
        fallback.includeSystem
      ),
      includeApplication: booleanValue(
        environment.includeApplication,
        fallback.includeApplication
      ),
      includeRuntimeVersions: booleanValue(
        environment.includeRuntimeVersions,
        fallback.includeRuntimeVersions
      ),
      includeModel: booleanValue(
        environment.includeModel,
        fallback.includeModel
      ),
      includeWorkspace: booleanValue(
        environment.includeWorkspace,
        fallback.includeWorkspace
      ),
      includeTools: booleanValue(
        environment.includeTools,
        fallback.includeTools
      ),
      workspaceDetail: enumValue(
        environment.workspaceDetail,
        WORKSPACE_DETAIL_OPTIONS,
        fallback.workspaceDetail
      ),
      toolDetail: enumValue(
        environment.toolDetail,
        TOOL_DETAIL_OPTIONS,
        fallback.toolDetail
      )
    }
  };
}

function sanitizeToolSettings(
  tools,
  defaults
) {
  const runtime = tools?.runtime ?? {};
  const workspace = tools?.workspace ?? {};
  const display = tools?.display ?? {};
  const developer = tools?.developer ?? {};
  const sourceToolsetOverrides =
    developer.toolsetOverrides ?? {};
  const sourceToolOverrides =
    developer.toolOverrides ?? {};

  const legacyCustom =
    tools?.profile === "custom";

  const legacyMode =
    tools?.profile === "workspace"
      ? "coding"
      : tools?.profile === "chat"
        ? "chat"
        : legacyCustom
          ? tools?.toolsets?.[
              "workspace.read"
            ] === false
            ? "chat"
            : "coding"
          : defaults.mode;

  const mode = enumValue(
    tools?.mode === undefined
      ? legacyMode
      : tools.mode,
    TOOL_MODES,
    legacyMode
  );

  const toolsetOverrides = {};
  for (const id of TOOLSET_IDS) {
    const explicit =
      sourceToolsetOverrides[id];

    if (explicit !== undefined) {
      toolsetOverrides[id] = enumValue(
        explicit,
        TOOL_OVERRIDE_VALUES,
        "inherit"
      );
      continue;
    }

    const baseEnabled =
      id === "workspace.read"
        ? mode === "coding"
        : true;
    const legacyEnabled =
      tools?.toolsets?.[id];

    toolsetOverrides[id] =
      legacyCustom &&
      typeof legacyEnabled === "boolean" &&
      legacyEnabled !== baseEnabled
        ? legacyEnabled
          ? "enabled"
          : "disabled"
        : "inherit";
  }

  const toolOverrides = {};
  for (const name of SAFE_TOOL_NAMES) {
    const explicit =
      sourceToolOverrides[name];

    if (explicit !== undefined) {
      toolOverrides[name] = enumValue(
        explicit,
        TOOL_OVERRIDE_VALUES,
        "inherit"
      );
      continue;
    }

    if (
      (tools?.mode === undefined || legacyCustom) &&
      typeof tools?.overrides?.[name] ===
        "boolean" &&
      tools.overrides[name] === false
    ) {
      toolOverrides[name] = "disabled";
    }
  }

  const legacyToolsets = {};
  for (const id of TOOLSET_IDS) {
    legacyToolsets[id] = booleanValue(
      tools?.toolsets?.[id],
      defaults.toolsets[id]
    );
  }

  const legacyOverrides = {};
  for (const name of SAFE_TOOL_NAMES) {
    legacyOverrides[name] = booleanValue(
      tools?.overrides?.[name],
      defaults.overrides[name]
    );
  }

  return {
    enabled: booleanValue(
      tools?.enabled,
      defaults.enabled
    ),
    mode,
    profile:
      mode === "coding"
        ? "workspace"
        : "chat",
    display: {
      detailLevel: enumValue(
        display.detailLevel,
        TOOL_DETAIL_LEVELS,
        defaults.display.detailLevel
      )
    },
    runtime: {
      maxSteps: integerValue(
        runtime.maxSteps,
        defaults.runtime.maxSteps,
        1,
        12
      ),
      maxSegments: integerValue(
        runtime.maxSegments,
        defaults.runtime.maxSegments,
        1,
        12
      ),
      maxNoProgressSegments: integerValue(
        runtime.maxNoProgressSegments,
        defaults.runtime.maxNoProgressSegments,
        1,
        4
      ),
      maxFinalizationAttempts: integerValue(
        runtime.maxFinalizationAttempts,
        defaults.runtime.maxFinalizationAttempts,
        1,
        3
      ),
      maxToolCalls: integerValue(
        runtime.maxToolCalls,
        defaults.runtime.maxToolCalls,
        1,
        50
      ),
      maxToolRetries: integerValue(
        runtime.maxToolRetries,
        defaults.runtime.maxToolRetries,
        0,
        2
      ),
      runTimeoutMs: integerValue(
        runtime.runTimeoutMs,
        defaults.runtime.runTimeoutMs,
        10000,
        600000
      ),
      defaultTimeoutMs: integerValue(
        runtime.defaultTimeoutMs,
        defaults.runtime.defaultTimeoutMs,
        2000,
        120000
      ),
      maxIdenticalCalls: integerValue(
        runtime.maxIdenticalCalls,
        defaults.runtime.maxIdenticalCalls,
        1,
        5
      ),
      saveToolHistory: booleanValue(
        runtime.saveToolHistory,
        defaults.runtime.saveToolHistory
      )
    },
    workspace: {
      enabled: true,
      includeProjectRoot: booleanValue(
        workspace.includeProjectRoot,
        defaults.workspace.includeProjectRoot
      ),
      roots: stringArrayValue(
        workspace.roots,
        defaults.workspace.roots
      ),
      maxTextFileBytes: integerValue(
        workspace.maxTextFileBytes,
        defaults.workspace.maxTextFileBytes,
        65536,
        20000000
      ),
      maxReadLines: integerValue(
        workspace.maxReadLines,
        defaults.workspace.maxReadLines,
        50,
        5000
      ),
      maxDirectoryEntries: integerValue(
        workspace.maxDirectoryEntries,
        defaults.workspace.maxDirectoryEntries,
        20,
        1000
      ),
      maxSearchResults: integerValue(
        workspace.maxSearchResults,
        defaults.workspace.maxSearchResults,
        10,
        500
      ),
      maxSearchDepth: integerValue(
        workspace.maxSearchDepth,
        defaults.workspace.maxSearchDepth,
        1,
        12
      ),
      maxHashFileBytes: integerValue(
        workspace.maxHashFileBytes,
        defaults.workspace.maxHashFileBytes,
        1000000,
        200000000
      )
    },
    developer: {
      toolsetOverrides,
      toolOverrides
    },
    toolsets: legacyToolsets,
    overrides: legacyOverrides
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
  const context =
    source.context ?? {};
  const tools =
    source.tools ?? {};
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
        ),
      developerMode: booleanValue(
        general.developerMode,
        defaults.general.developerMode
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

    context: sanitizeContextSettings(
      context,
      defaults.context
    ),

    tools: sanitizeToolSettings(
      tools,
      defaults.tools
    ),

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
