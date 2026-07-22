import path from "node:path";

import {
  WORKER_RUNTIME_DEFAULTS,
  WORKER_RUNTIME_LIMITS
} from "../../src/shared/runtimeDefaults.js";

import {
  cloneDefaultSettings
} from "./defaultSettings.js";

import {
  PROVIDER_DEFAULTS
} from "./providerDefaults.js";

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

const LEGACY_TEMPLATE_MODELS = Object.freeze({
  deepseek: new Set([
    "deepseek-v4-flash",
    "deepseek-v4-pro"
  ]),
  openai: new Set([
    "gpt-5-2",
    "gpt-5.2",
    "gpt-4.1-mini",
    "gpt-4.1 mini"
  ]),
  anthropic: new Set([
    "claude-sonnet-4",
    "claude sonnet 4",
    "claude-sonnet-4-6",
    "claude sonnet 4.6"
  ]),
  ollama: new Set([
    "gemma3",
    "gemma 3"
  ]),
  compatible: new Set([
    "compatible-model",
    "compatible model",
    "model-id"
  ])
});

function normalizedTemplateValue(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isLegacyTemplateProvider(
  providerId,
  source,
  fallback
) {
  if (!source || typeof source !== "object") {
    return true;
  }

  const knownModels = LEGACY_TEMPLATE_MODELS[providerId];

  if (!knownModels) {
    return false;
  }

  const baseURL = normalizedTemplateValue(source.baseURL);
  const fallbackBaseURL = normalizedTemplateValue(fallback?.baseURL);
  const type = normalizedTemplateValue(source.type);
  const fallbackType = normalizedTemplateValue(fallback?.type);
  const name = normalizedTemplateValue(source.name);
  const fallbackName = normalizedTemplateValue(fallback?.name);

  if (
    baseURL &&
    fallbackBaseURL &&
    baseURL.replace(/\/+$/u, "") !==
      fallbackBaseURL.replace(/\/+$/u, "")
  ) {
    return false;
  }

  if (type && fallbackType && type !== fallbackType) {
    return false;
  }

  if (name && fallbackName && name !== fallbackName) {
    return false;
  }

  const models = Array.isArray(source.models)
    ? source.models
    : [];

  if (!models.length) {
    return true;
  }

  return models.every((model) => {
    const candidates = [
      model?.id,
      model?.name,
      model?.modelId,
      model?.model
    ]
      .map(normalizedTemplateValue)
      .filter(Boolean);

    return candidates.some((candidate) =>
      knownModels.has(candidate)
    );
  });
}

function inferProviderConfigured({
  providerId,
  source,
  fallback,
  activeProvider
}) {
  if (typeof source?.configured === "boolean") {
    return source.configured;
  }

  if (!source || typeof source !== "object") {
    return false;
  }

  if (providerId === activeProvider) {
    return true;
  }

  return !isLegacyTemplateProvider(
    providerId,
    source,
    fallback
  );
}

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

const TOOL_OVERRIDE_VALUES = [
  "inherit",
  "enabled",
  "disabled"
];

const MCP_TRANSPORTS = [
  "stdio",
  "streamable-http"
];

const MCP_AUTH_MODES = [
  "none",
  "bearer",
  "api-key",
  "oauth"
];

const CUSTOM_HTTP_METHODS = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE"
];

const CUSTOM_HTTP_AUTH_MODES = [
  "none",
  "bearer",
  "api-key"
];

const CUSTOM_HTTP_PARAMETER_LOCATIONS = [
  "path",
  "query",
  "header",
  "body"
];

const CUSTOM_HTTP_PARAMETER_TYPES = [
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array"
];

const MCP_SERVER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/u;
const MCP_ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]{0,63}$/u;
const MCP_SECRET_ENV_NAME_PATTERN = /(?:^|_)(?:TOKEN|API_KEY|KEY|SECRET|PASSWORD|PASSCODE|CREDENTIAL)(?:$|_)/u;
const EXTERNAL_TOOLSET_PATTERN = /^(?:mcp|custom)\.[a-z0-9][a-z0-9._-]{0,79}$/u;
const EXTERNAL_TOOL_NAME_PATTERN = /^(?=.{1,64}$)(?:mcp|custom)_[a-zA-Z0-9_-]+$/u;

function clamp(value, min, max) {
  return Math.min(
    Math.max(value, min),
    max
  );
}


function allowedCommandValue(value) {
  const text = String(value ?? "").trim();
  const hasControlCharacter = [...text].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
  if (!text || text.length > 500 || hasControlCharacter) {
    return "";
  }
  if (path.isAbsolute(text) || path.win32.isAbsolute(text)) {
    return path.normalize(text);
  }
  return /^[a-zA-Z0-9_.-]{1,120}$/u.test(text)
    ? text
    : "";
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
  legacyContextTokenBudget,
  configured
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
    configured: Boolean(configured),
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
  const sourceModel =
    model &&
    typeof model === "object"
      ? model
      : {};

  const hasLegacyShape =
    typeof sourceModel.model === "string" ||
    typeof sourceModel.baseURL === "string" ||
    typeof sourceModel.provider === "string" ||
    sourceModel.temperature !== undefined ||
    sourceModel.maxOutputTokens !== undefined ||
    sourceModel.timeoutMs !== undefined;

  const sourceProviders = {
    ...(sourceModel.providers ?? {})
  };

  if (hasLegacyShape) {
    sourceProviders.deepseek = {
      ...PROVIDER_DEFAULTS.deepseek,
      configured: true,
      baseURL: sourceModel.baseURL,
      activeModelId: "migrated-model",
      models: [
        {
          id: "migrated-model",
          name:
            sourceModel.model ??
            "DeepSeek",
          modelId: sourceModel.model,
          contextTokenBudget:
            legacyContextTokenBudget,
          temperature:
            sourceModel.temperature,
          maxOutputTokens:
            sourceModel.maxOutputTokens,
          timeoutMs:
            sourceModel.timeoutMs
        }
      ]
    };
  }

  const requestedProvider =
    nonEmptyStringValue(
      sourceModel.activeProvider,
      defaults.activeProvider ?? "",
      80
    );

  const providers = {};

  for (
    const providerId
    of Object.keys(sourceProviders).slice(0, 20)
  ) {
    const fallback =
      PROVIDER_DEFAULTS[providerId] ??
      PROVIDER_DEFAULTS.compatible;

    const sourceProvider =
      sourceProviders[providerId];

    const configured =
      inferProviderConfigured({
        providerId,
        source: sourceProvider,
        fallback,
        activeProvider: requestedProvider
      });

    if (!configured) {
      continue;
    }

    providers[providerId] =
      sanitizeProvider(
        providerId,
        sourceProvider,
        fallback,
        providerId === "deepseek"
          ? legacyContextTokenBudget
          : undefined,
        true
      );
  }

  const activeProvider =
    providers[requestedProvider]
      ? requestedProvider
      : Object.keys(providers)[0] ?? "";

  const sanitizeRuntimeAssignment = (value) => {
    const providerId = nonEmptyStringValue(value?.providerId, "", 80);
    const modelConfigId = nonEmptyStringValue(value?.modelConfigId, "", 120);
    const provider = providers[providerId];
    if (!provider?.models?.some((item) => item.id === modelConfigId)) {
      return null;
    }
    return { providerId, modelConfigId };
  };

  return {
    activeProvider,
    providers,
    runtimeAssignments: {
      worker: sanitizeRuntimeAssignment(
        sourceModel.runtimeAssignments?.worker
      ),
      maxConcurrency: integerValue(
        sourceModel.runtimeAssignments?.maxConcurrency,
        defaults.runtimeAssignments?.maxConcurrency ??
          WORKER_RUNTIME_DEFAULTS.maxConcurrency,
        WORKER_RUNTIME_LIMITS.maxConcurrency.min,
        WORKER_RUNTIME_LIMITS.maxConcurrency.max
      ),
      tokenBudget: integerValue(
        sourceModel.runtimeAssignments?.tokenBudget,
        defaults.runtimeAssignments?.tokenBudget ??
          WORKER_RUNTIME_DEFAULTS.tokenBudget,
        WORKER_RUNTIME_LIMITS.tokenBudget.min,
        WORKER_RUNTIME_LIMITS.tokenBudget.max
      ),
      stepBudget: integerValue(
        sourceModel.runtimeAssignments?.stepBudget,
        defaults.runtimeAssignments?.stepBudget ??
          WORKER_RUNTIME_DEFAULTS.stepBudget,
        WORKER_RUNTIME_LIMITS.stepBudget.min,
        WORKER_RUNTIME_LIMITS.stepBudget.max
      ),
      timeBudgetMinutes: integerValue(
        sourceModel.runtimeAssignments?.timeBudgetMinutes,
        defaults.runtimeAssignments?.timeBudgetMinutes ??
          WORKER_RUNTIME_DEFAULTS.timeBudgetMinutes,
        WORKER_RUNTIME_LIMITS.timeBudgetMinutes.min,
        WORKER_RUNTIME_LIMITS.timeBudgetMinutes.max
      )
    }
  };
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

function normalizeWorkspacePath(value) {
  const requested = String(value ?? "").trim();

  if (/^[a-zA-Z]:[\\/]/u.test(requested)) {
    return path.win32.normalize(requested);
  }

  // A stored POSIX absolute path must stay POSIX even when settings are
  // validated on Windows. path.resolve("/projects/alpha") on Windows would
  // otherwise rewrite it to the current drive, changing workspace identity.
  if (requested.startsWith("/")) {
    return path.posix.normalize(requested);
  }

  return path.resolve(requested);
}

function workspaceBaseName(value) {
  return /^[a-zA-Z]:[\\/]/u.test(String(value ?? ""))
    ? path.win32.basename(String(value))
    : path.basename(String(value));
}

function workspaceIdFromPath(rootPath) {
  let hash = 2166136261;

  for (const character of String(rootPath ?? "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return `workspace-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function sanitizeWorkspaceRegistry(
  source,
  legacyRoots = []
) {
  const candidates = Array.isArray(source?.items)
    ? source.items
    : [];
  const migrated = candidates.length > 0
    ? candidates
    : (Array.isArray(legacyRoots) ? legacyRoots : []).map((rootPath) => ({
        rootPath
      }));
  const seen = new Set();
  const items = [];

  for (const candidate of migrated) {
    const requested = String(
      typeof candidate === "string"
        ? candidate
        : candidate?.rootPath ?? candidate?.canonicalPath ?? ""
    ).trim();

    if (!requested) {
      continue;
    }

    const rootPath = normalizeWorkspacePath(requested);
    const comparable = process.platform === "win32"
      ? rootPath.toLowerCase()
      : rootPath;

    if (seen.has(comparable)) {
      continue;
    }

    seen.add(comparable);
    const id = nonEmptyStringValue(
      candidate?.id,
      workspaceIdFromPath(comparable),
      120
    );
    const createdAt = Math.max(
      0,
      Math.round(Number(candidate?.createdAt) || 0)
    );
    const lastOpenedAt = Math.max(
      createdAt,
      Math.round(Number(candidate?.lastOpenedAt) || createdAt)
    );

    items.push({
      id,
      name: nonEmptyStringValue(
        candidate?.name,
        workspaceBaseName(rootPath) || rootPath,
        120
      ),
      rootPath,
      canonicalPath: normalizeWorkspacePath(
        candidate?.canonicalPath ?? rootPath
      ),
      createdAt,
      lastOpenedAt
    });
  }

  return { items };
}

function safeProcessArgument(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 1000) {
    return "";
  }
  const hasControlCharacter = [...text].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
  });
  return hasControlCharacter ? "" : text;
}


function sanitizeMcpHeaders(source = {}) {
  const output = {};
  const entries = source && typeof source === "object" && !Array.isArray(source)
    ? Object.entries(source)
    : [];
  for (const [rawName, rawValue] of entries.slice(0, 24)) {
    const name = String(rawName ?? "").trim();
    const value = String(rawValue ?? "").trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,80}$/u.test(name)) {
      continue;
    }
    if (!value || value.length > 2000 || /[\r\n]/u.test(value)) {
      continue;
    }
    const lower = name.toLowerCase();
    if (["authorization", "cookie", "proxy-authorization"].includes(lower)) {
      continue;
    }
    output[name] = value;
  }
  return output;
}

function sanitizeMcpUrl(value) {
  const text = String(value ?? "").trim().slice(0, 2000);
  const hasControlCharacter = [...text].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
  if (!text || hasControlCharacter) {
    return "";
  }
  try {
    const parsed = new URL(text);
    if (!["https:", "http:"].includes(parsed.protocol)) {
      return text;
    }
    if (parsed.username || parsed.password || parsed.hash) {
      return "";
    }
    return parsed.toString();
  } catch {
    // Preserve an unfinished address while the user is typing. The Runtime
    // performs strict validation before opening a network connection.
    return text;
  }
}

function sanitizeOAuthScopes(value) {
  const values = Array.isArray(value)
    ? value
    : String(value ?? "").split(/[\s,]+/u);
  return [...new Set(values
    .map((item) => String(item ?? "").trim())
    .filter((item) => /^[A-Za-z0-9._:/-]{1,120}$/u.test(item))
  )].slice(0, 24);
}

function sanitizeMcpEnvironment(source = {}) {
  const output = {};
  const entries = source && typeof source === "object" && !Array.isArray(source)
    ? Object.entries(source)
    : [];
  for (const [rawName, rawValue] of entries.slice(0, 32)) {
    const name = String(rawName ?? "").trim().toUpperCase();
    const value = String(rawValue ?? "");
    if (!MCP_ENV_NAME_PATTERN.test(name) || value.length > 4000) {
      continue;
    }
    output[name] = value;
  }
  return output;
}


function sanitizeMcpToolRules(source = {}) {
  const output = {};
  const entries = source && typeof source === "object" && !Array.isArray(source)
    ? Object.entries(source)
    : [];
  for (const [rawName, rawRule] of entries.slice(0, 512)) {
    const name = String(rawName ?? "").trim().slice(0, 256);
    if (!name) continue;
    output[name] = enumValue(rawRule, ["inherit", "allow", "deny"], "inherit");
  }
  return output;
}

function sanitizeMcpPermissions(source = {}, { readOnly = false } = {}) {
  const writable = readOnly !== true;
  return {
    localProcess: booleanValue(source?.localProcess, true),
    network: booleanValue(source?.network, true),
    account: booleanValue(source?.account, true),
    fileRead: booleanValue(source?.fileRead, true),
    fileWrite: booleanValue(source?.fileWrite, writable),
    externalWrite: booleanValue(source?.externalWrite, writable),
    destructive: booleanValue(source?.destructive, false),
    tools: sanitizeMcpToolRules(source?.tools)
  };
}

function sanitizeMcpServerRecovery(source = {}) {
  return {
    enabled: booleanValue(source?.enabled, true),
    maxAttempts: integerValue(source?.maxAttempts, 3, 0, 20)
  };
}

function sanitizeMcpServer(source, index) {
  const fallbackId = `mcp-${index + 1}`;
  const requestedId = String(source?.id ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  const id = MCP_SERVER_ID_PATTERN.test(requestedId)
    ? requestedId
    : fallbackId;
  const command = safeProcessArgument(source?.command);
  const args = Array.isArray(source?.args)
    ? source.args.map(safeProcessArgument).filter(Boolean).slice(0, 64)
    : [];
  const secretEnvKeys = Array.isArray(source?.secretEnvKeys)
    ? [...new Set(source.secretEnvKeys
        .map((value) => String(value ?? "").trim().toUpperCase())
        .filter((name) => MCP_ENV_NAME_PATTERN.test(name))
      )].slice(0, 16)
    : [];
  const sanitizedEnvironment = sanitizeMcpEnvironment(source?.env);
  let cwd = String(source?.cwd ?? "").trim();
  if (cwd && !(path.isAbsolute(cwd) || path.win32.isAbsolute(cwd))) {
    cwd = "";
  }
  if (cwd.length > 500) {
    cwd = cwd.slice(0, 500);
  }

  const transport = enumValue(source?.transport, MCP_TRANSPORTS, "stdio");
  const authMode = enumValue(source?.authMode, MCP_AUTH_MODES, "none");
  const url = sanitizeMcpUrl(source?.url);
  const apiKeyHeader = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,80}$/u.test(
    String(source?.apiKeyHeader ?? "").trim()
  )
    ? String(source.apiKeyHeader).trim()
    : "X-API-Key";
  const normalizedSecretKeys = [...secretEnvKeys];
  for (const name of Object.keys(sanitizedEnvironment)) {
    if (normalizedSecretKeys.includes(name) || MCP_SECRET_ENV_NAME_PATTERN.test(name)) {
      if (!normalizedSecretKeys.includes(name) && normalizedSecretKeys.length < 16) {
        normalizedSecretKeys.push(name);
      }
      delete sanitizedEnvironment[name];
    }
  }
  if (
    transport === "streamable-http" &&
    ["bearer", "api-key"].includes(authMode) &&
    !normalizedSecretKeys.includes("MCP_REMOTE_TOKEN")
  ) {
    normalizedSecretKeys.push("MCP_REMOTE_TOKEN");
  }
  const readOnly = booleanValue(source?.readOnly, false);

  return {
    id,
    name: nonEmptyStringValue(source?.name, id, 80),
    enabled: booleanValue(source?.enabled, false),
    autoConnect: booleanValue(source?.autoConnect, true),
    transport,
    url: transport === "streamable-http" ? url : "",
    authMode: transport === "streamable-http" ? authMode : "none",
    apiKeyHeader,
    oauthScopes: sanitizeOAuthScopes(source?.oauthScopes),
    headers: sanitizeMcpHeaders(source?.headers),
    command: transport === "stdio" ? command : "",
    args: transport === "stdio" ? args : [],
    cwd: transport === "stdio" ? cwd : "",
    env: transport === "stdio" ? sanitizedEnvironment : {},
    secretEnvKeys: normalizedSecretKeys.slice(0, 16),
    readOnly,
    permissions: sanitizeMcpPermissions(source?.permissions, { readOnly }),
    recovery: sanitizeMcpServerRecovery(source?.recovery),
    preset: enumValue(source?.preset, ["custom", "remote"], "custom"),
    connectTimeoutMs: integerValue(source?.connectTimeoutMs, 15000, 2000, 120000),
    callTimeoutMs: integerValue(source?.callTimeoutMs, 60000, 2000, 600000)
  };
}

function sanitizeMcpSettings(source, defaults) {
  const servers = Array.isArray(source?.servers)
    ? source.servers.slice(0, 32).map(sanitizeMcpServer)
    : [];
  const deduplicated = [];
  const usedIds = new Set();
  for (const server of servers) {
    let id = server.id;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${server.id.slice(0, 42)}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    deduplicated.push({ ...server, id });
  }
  return {
    enabled: booleanValue(source?.enabled, defaults.enabled),
    autoConnect: booleanValue(source?.autoConnect, defaults.autoConnect),
    connectTimeoutMs: integerValue(source?.connectTimeoutMs, defaults.connectTimeoutMs, 2000, 120000),
    callTimeoutMs: integerValue(source?.callTimeoutMs, defaults.callTimeoutMs, 2000, 600000),
    maxToolsPerServer: integerValue(source?.maxToolsPerServer, defaults.maxToolsPerServer, 1, 512),
    logLevel: enumValue(source?.logLevel, ["user", "developer", "debug"], defaults.logLevel ?? "developer"),
    health: {
      enabled: booleanValue(source?.health?.enabled, defaults.health?.enabled ?? true),
      intervalMs: integerValue(source?.health?.intervalMs, defaults.health?.intervalMs ?? 30000, 5000, 3600000),
      timeoutMs: integerValue(source?.health?.timeoutMs, defaults.health?.timeoutMs ?? 8000, 1000, 60000),
      unhealthyThreshold: integerValue(source?.health?.unhealthyThreshold, defaults.health?.unhealthyThreshold ?? 2, 1, 10)
    },
    recovery: {
      enabled: booleanValue(source?.recovery?.enabled, defaults.recovery?.enabled ?? true),
      maxAttempts: integerValue(source?.recovery?.maxAttempts, defaults.recovery?.maxAttempts ?? 3, 0, 20),
      baseDelayMs: integerValue(source?.recovery?.baseDelayMs, defaults.recovery?.baseDelayMs ?? 1000, 250, 60000),
      maxDelayMs: integerValue(source?.recovery?.maxDelayMs, defaults.recovery?.maxDelayMs ?? 15000, 1000, 300000)
    },
    resultLimits: {
      maxTextBytes: integerValue(source?.resultLimits?.maxTextBytes, defaults.resultLimits?.maxTextBytes ?? 51200, 4096, 2000000),
      maxStructuredBytes: integerValue(source?.resultLimits?.maxStructuredBytes, defaults.resultLimits?.maxStructuredBytes ?? 1048576, 16384, 10000000),
      maxJsonFields: integerValue(source?.resultLimits?.maxJsonFields, defaults.resultLimits?.maxJsonFields ?? 10000, 100, 100000),
      maxContentBlocks: integerValue(source?.resultLimits?.maxContentBlocks, defaults.resultLimits?.maxContentBlocks ?? 128, 1, 512),
      stripHtml: booleanValue(source?.resultLimits?.stripHtml, defaults.resultLimits?.stripHtml ?? true)
    },
    servers: deduplicated
  };
}


function sanitizeCustomHttpParameter(source, index) {
  const requestedName = String(source?.name ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 48);
  const name = /^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/u.test(requestedName)
    ? requestedName
    : `param_${index + 1}`;
  return {
    name,
    location: enumValue(
      source?.location,
      CUSTOM_HTTP_PARAMETER_LOCATIONS,
      "query"
    ),
    type: enumValue(
      source?.type,
      CUSTOM_HTTP_PARAMETER_TYPES,
      "string"
    ),
    required: booleanValue(source?.required, false),
    description: stringValue(source?.description, "", 240),
    defaultValue:
      source?.defaultValue === undefined
        ? null
        : source.defaultValue
  };
}

function sanitizeCustomHttpTool(source, index) {
  const fallbackId = `http-tool-${index + 1}`;
  const requestedId = String(source?.id ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40);
  const id = /^[a-z0-9][a-z0-9_-]{0,39}$/u.test(requestedId)
    ? requestedId
    : fallbackId;
  const method = enumValue(
    String(source?.method ?? "GET").toUpperCase(),
    CUSTOM_HTTP_METHODS,
    "GET"
  );
  const authMode = enumValue(
    source?.authMode,
    CUSTOM_HTTP_AUTH_MODES,
    "none"
  );
  const rawParameters = Array.isArray(source?.parameters)
    ? source.parameters.slice(0, 48).map(sanitizeCustomHttpParameter)
    : [];
  const parameters = [];
  const usedNames = new Set();
  for (const parameter of rawParameters) {
    let name = parameter.name;
    let suffix = 2;
    while (usedNames.has(name)) {
      name = `${parameter.name.slice(0, 42)}_${suffix}`;
      suffix += 1;
    }
    usedNames.add(name);
    parameters.push({ ...parameter, name });
  }
  const apiKeyHeader = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,80}$/u.test(
    String(source?.apiKeyHeader ?? "").trim()
  )
    ? String(source.apiKeyHeader).trim()
    : "X-API-Key";
  return {
    id,
    name: nonEmptyStringValue(source?.name, id, 80),
    description: stringValue(source?.description, "", 1200),
    enabled: booleanValue(source?.enabled, false),
    method,
    url: sanitizeMcpUrl(source?.url),
    authMode,
    apiKeyHeader,
    headers: sanitizeMcpHeaders(source?.headers),
    parameters,
    responsePath: stringValue(source?.responsePath, "", 240)
      .trim()
      .replace(/^\.+|\.+$/gu, ""),
    timeoutMs: integerValue(source?.timeoutMs, 30000, 2000, 300000),
    maxResponseBytes: integerValue(
      source?.maxResponseBytes,
      262144,
      4096,
      2000000
    ),
    allowPrivateNetwork: booleanValue(source?.allowPrivateNetwork, false),
    allowDestructive: booleanValue(source?.allowDestructive, false)
  };
}

function sanitizeCustomToolSettings(source, defaults) {
  const rawTools = Array.isArray(source?.tools)
    ? source.tools.slice(0, 64).map(sanitizeCustomHttpTool)
    : [];
  const tools = [];
  const usedIds = new Set();
  for (const tool of rawTools) {
    let id = tool.id;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${tool.id.slice(0, 34)}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    tools.push({ ...tool, id });
  }
  return {
    enabled: booleanValue(source?.enabled, defaults.enabled),
    maxResponseBytes: integerValue(
      source?.maxResponseBytes,
      defaults.maxResponseBytes,
      4096,
      2000000
    ),
    tools
  };
}

function sanitizeToolSettings(
  tools,
  defaults
) {
  const runtime = tools?.runtime ?? {};
  const circuitBreakers = runtime.circuitBreakers ?? {};
  const defaultCircuitBreakers = defaults.runtime.circuitBreakers ?? {};
  const security = tools?.security ?? {};
  const approval = security.approval ?? {};
  const untrustedContent = security.untrustedContent ?? {};
  const workspace = tools?.workspace ?? {};
  const developer = tools?.developer ?? {};
  const sourceToolsetOverrides =
    developer.toolsetOverrides ?? {};
  const sourceToolOverrides =
    developer.toolOverrides ?? {};
  const journalMaxFileBytes = integerValue(
    runtime.journalMaxFileBytes,
    defaults.runtime.journalMaxFileBytes,
    256000,
    100000000
  );
  const journalMaxTotalBytes = Math.max(
    journalMaxFileBytes,
    integerValue(
      runtime.journalMaxTotalBytes,
      defaults.runtime.journalMaxTotalBytes,
      1000000,
      1000000000
    )
  );

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
      id === "workspace.write"
        ? mode === "coding"
        : id === "workspace.exec"
          ? false
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


  for (const [id, value] of Object.entries(sourceToolsetOverrides)) {
    if (EXTERNAL_TOOLSET_PATTERN.test(id)) {
      toolsetOverrides[id] = enumValue(
        value,
        TOOL_OVERRIDE_VALUES,
        "inherit"
      );
    }
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


  for (const [name, value] of Object.entries(sourceToolOverrides)) {
    if (EXTERNAL_TOOL_NAME_PATTERN.test(name)) {
      toolOverrides[name] = enumValue(
        value,
        TOOL_OVERRIDE_VALUES,
        "inherit"
      );
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
    runtime: {
      maxSteps: integerValue(
        runtime.maxSteps,
        defaults.runtime.maxSteps,
        1,
        32
      ),
      maxSegments: integerValue(
        runtime.maxSegments,
        defaults.runtime.maxSegments,
        1,
        100
      ),
      maxNoProgressSegments: integerValue(
        runtime.maxNoProgressSegments,
        defaults.runtime.maxNoProgressSegments,
        1,
        10
      ),
      maxFinalizationAttempts: integerValue(
        runtime.maxFinalizationAttempts,
        defaults.runtime.maxFinalizationAttempts,
        1,
        3
      ),
      finalizationTimeoutMs: integerValue(
        runtime.finalizationTimeoutMs,
        defaults.runtime.finalizationTimeoutMs,
        5000,
        120000
      ),
      maxToolCalls: integerValue(
        runtime.maxToolCalls,
        defaults.runtime.maxToolCalls,
        1,
        500
      ),
      maxToolCallsPerStep: integerValue(
        runtime.maxToolCallsPerStep,
        defaults.runtime.maxToolCallsPerStep,
        1,
        64
      ),
      maxToolCallsPerBatch: integerValue(
        runtime.maxToolCallsPerBatch,
        defaults.runtime.maxToolCallsPerBatch,
        1,
        128
      ),
      maxTotalToolCalls: integerValue(
        runtime.maxTotalToolCalls,
        defaults.runtime.maxTotalToolCalls,
        100,
        10000
      ),
      maxToolRetries: integerValue(
        runtime.maxToolRetries,
        defaults.runtime.maxToolRetries,
        0,
        2
      ),
      maxConcurrent: integerValue(
        runtime.maxConcurrent,
        defaults.runtime.maxConcurrent,
        1,
        16
      ),
      runTimeoutMs: integerValue(
        runtime.runTimeoutMs,
        defaults.runtime.runTimeoutMs,
        10000,
        14400000
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
        10
      ),
      saveToolHistory: booleanValue(
        runtime.saveToolHistory,
        defaults.runtime.saveToolHistory
      ),
      journalMaxFileBytes,
      journalMaxArchives: integerValue(
        runtime.journalMaxArchives,
        defaults.runtime.journalMaxArchives,
        1,
        32
      ),
      journalMaxTotalBytes,
      circuitBreakers: {
        provider: {
          failureThreshold: integerValue(
            circuitBreakers.provider?.failureThreshold,
            defaultCircuitBreakers.provider?.failureThreshold ?? 3,
            1,
            20
          ),
          failureWindowMs: integerValue(
            circuitBreakers.provider?.failureWindowMs,
            defaultCircuitBreakers.provider?.failureWindowMs ?? 90000,
            5000,
            1800000
          ),
          cooldownMs: integerValue(
            circuitBreakers.provider?.cooldownMs,
            defaultCircuitBreakers.provider?.cooldownMs ?? 45000,
            1000,
            1800000
          ),
          halfOpenMaxCalls: integerValue(
            circuitBreakers.provider?.halfOpenMaxCalls,
            defaultCircuitBreakers.provider?.halfOpenMaxCalls ?? 1,
            1,
            10
          )
        },
        tool: {
          failureThreshold: integerValue(
            circuitBreakers.tool?.failureThreshold,
            defaultCircuitBreakers.tool?.failureThreshold ?? 3,
            1,
            20
          ),
          failureWindowMs: integerValue(
            circuitBreakers.tool?.failureWindowMs,
            defaultCircuitBreakers.tool?.failureWindowMs ?? 60000,
            5000,
            1800000
          ),
          cooldownMs: integerValue(
            circuitBreakers.tool?.cooldownMs,
            defaultCircuitBreakers.tool?.cooldownMs ?? 30000,
            1000,
            1800000
          ),
          halfOpenMaxCalls: integerValue(
            circuitBreakers.tool?.halfOpenMaxCalls,
            defaultCircuitBreakers.tool?.halfOpenMaxCalls ?? 1,
            1,
            10
          )
        }
      }
    },
    security: {
      approval: {
        localWrite: booleanValue(
          approval.localWrite,
          defaults.security.approval.localWrite
        ),
        remoteWrite: booleanValue(
          approval.remoteWrite,
          defaults.security.approval.remoteWrite
        ),
        allowRunGrant: booleanValue(
          approval.allowRunGrant,
          defaults.security.approval.allowRunGrant
        ),
        timeoutMs: integerValue(
          approval.timeoutMs,
          defaults.security.approval.timeoutMs,
          30000,
          1800000
        )
      },
      untrustedContent: {
        requirePerCallApproval: booleanValue(
          untrustedContent.requirePerCallApproval,
          defaults.security.untrustedContent.requirePerCallApproval
        ),
        blockDestructive: booleanValue(
          untrustedContent.blockDestructive,
          defaults.security.untrustedContent.blockDestructive
        )
      }
    },
    workspace: {
      enabled: true,
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
      ),
      maxWriteFileBytes: integerValue(
        workspace.maxWriteFileBytes,
        defaults.workspace.maxWriteFileBytes,
        65536,
        20000000
      ),
      controlledProcess: booleanValue(
        workspace.controlledProcess,
        defaults.workspace.controlledProcess !== false
      ),
      allowedCommands: Array.isArray(workspace.allowedCommands)
        ? [...new Set(workspace.allowedCommands
            .map(allowedCommandValue)
            .filter(Boolean)
          )].slice(0, 32)
        : [...(defaults.workspace.allowedCommands ?? [])]
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
  const prompts =
    source.prompts ?? {};
  const conversation =
    source.conversation ?? {};
  const context =
    source.context ?? {};
  const tools =
    source.tools ?? {};
  const mcp =
    source.mcp ?? {};
  const customTools =
    source.customTools ?? {};
  const workspaces =
    source.workspaces ?? {};
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
      showInTray: booleanValue(
        pet.showInTray,
        defaults.pet.showInTray
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
        -1,
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
      latinFontFamily: enumValue(
        appearance.latinFontFamily ?? ({
          humanist: "segoe",
          serif: "georgia",
          monospace: "cascadia",
          custom: "custom"
        }[appearance.fontFamily] ?? appearance.fontFamily),
        ["system", "segoe", "inter", "arial", "georgia", "cascadia", "custom"],
        defaults.appearance.latinFontFamily
      ),
      chineseFontFamily: enumValue(
        appearance.chineseFontFamily ?? ({
          serif: "song",
          custom: "custom"
        }[appearance.fontFamily] ?? "system"),
        ["system", "yahei", "pingfang", "notoSans", "sourceHanSans", "song", "custom"],
        defaults.appearance.chineseFontFamily
      ),
      customLatinFontFamily: stringValue(
        appearance.customLatinFontFamily ?? appearance.customFontFamily,
        defaults.appearance.customLatinFontFamily,
        180
      ).trim(),
      customChineseFontFamily: stringValue(
        appearance.customChineseFontFamily ?? appearance.customFontFamily,
        defaults.appearance.customChineseFontFamily,
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
      responsePreferences: stringValue(
        personality.responsePreferences,
        personality.responsePreferences === undefined
          ? [
              personality.language === "zh-CN" ? "默认使用简体中文" : personality.language === "en-US" ? "默认使用英语" : "跟随用户使用的语言",
              personality.tone === "friendly" ? "语气友好" : personality.tone === "professional" ? "语气专业克制" : personality.tone === "direct" ? "表达直接" : "语气自然清晰",
              personality.responseLength === "concise" ? "回答尽量精简" : personality.responseLength === "detailed" ? "在必要时提供完整细节" : "篇幅根据问题复杂度调整"
            ].join("；") + "。"
          : defaults.personality.responsePreferences,
        2000
      ).trim(),
      language: enumValue(
        personality.language,
        ["auto", "zh-CN", "en-US"],
        defaults.personality.language
      ),
      tone: enumValue(
        personality.tone,
        ["natural", "friendly", "professional", "direct"],
        defaults.personality.tone
      ),
      responseLength: enumValue(
        personality.responseLength,
        ["concise", "balanced", "detailed"],
        defaults.personality.responseLength
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

    prompts: {
      modeOverrides: {
        chat: stringValue(
          prompts.modeOverrides?.chat,
          defaults.prompts.modeOverrides.chat,
          12000
        ).trim(),
        coding: stringValue(
          prompts.modeOverrides?.coding,
          defaults.prompts.modeOverrides.coding,
          12000
        ).trim()
      },
      developerInstructions: stringValue(
        prompts.developerInstructions,
        defaults.prompts.developerInstructions,
        20000
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
        ),
      executionRouting: {
        mode: enumValue(
          conversation.executionRouting?.mode,
          ["legacy", "shadow", "guarded", "authority"],
          defaults.conversation.executionRouting?.mode ?? "guarded"
        ),
        minimumSamples: integerValue(
          conversation.executionRouting?.minimumSamples,
          defaults.conversation.executionRouting?.minimumSamples ?? 12,
          0,
          500
        ),
        maxMismatchRate: numberValue(
          conversation.executionRouting?.maxMismatchRate,
          defaults.conversation.executionRouting?.maxMismatchRate ?? 0.35,
          0,
          1
        ),
        maxHighRiskMismatches: integerValue(
          conversation.executionRouting?.maxHighRiskMismatches,
          defaults.conversation.executionRouting?.maxHighRiskMismatches ?? 0,
          0,
          100
        ),
        windowSize: integerValue(
          conversation.executionRouting?.windowSize,
          defaults.conversation.executionRouting?.windowSize ?? 100,
          20,
          300
        ),
        autoRollback: booleanValue(
          conversation.executionRouting?.autoRollback,
          defaults.conversation.executionRouting?.autoRollback ?? true
        )
      }
    },

    context: sanitizeContextSettings(
      context,
      defaults.context
    ),

    mcp: sanitizeMcpSettings(
      mcp,
      defaults.mcp
    ),

    customTools: sanitizeCustomToolSettings(
      customTools,
      defaults.customTools
    ),

    workspaces: sanitizeWorkspaceRegistry(
      workspaces,
      tools?.workspace?.roots
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
