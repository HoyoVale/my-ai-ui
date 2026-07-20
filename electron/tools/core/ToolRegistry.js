import {
  normalizeToolRuntimeContract,
  publicToolRuntimeContract
} from "./ToolRuntimeContract.js";

const TOOL_RISK_LEVELS = new Set([
  "none",
  "low",
  "medium",
  "high"
]);

const TOOL_SIDE_EFFECTS = new Set([
  "none",
  "read",
  "write",
  "external"
]);

const TOOL_IDEMPOTENCY_MODES = new Set([
  "none",
  "natural",
  "required"
]);

const TOOL_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u;

const TOOL_ACTIVITY_VISIBILITY = new Set([
  "normal",
  "developer"
]);

function cloneMetadata(value) {
  return structuredClone(value);
}

function copyDefinition(definition) {
  return {
    ...definition,
    toolsets: [...(definition.toolsets ?? [])],
    retryPolicy: {
      ...definition.retryPolicy,
      retryOn: [
        ...(definition.retryPolicy?.retryOn ?? [])
      ]
    },
    runtimeContract: {
      ...definition.runtimeContract
    }
  };
}

function normalizeRetryPolicy(
  value,
  {
    sideEffect = "none"
  } = {}
) {
  const source =
    value && typeof value === "object"
      ? value
      : {};
  const safeToRetry = [
    "none",
    "read"
  ].includes(sideEffect);
  const maxAttempts = Math.max(
    1,
    Math.min(
      3,
      Number(source.maxAttempts) ||
        (safeToRetry ? 2 : 1)
    )
  );
  const retryOn = Array.isArray(
    source.retryOn
  )
    ? source.retryOn
        .map(String)
        .filter(Boolean)
    : safeToRetry
      ? ["TEMPORARY_FAILURE"]
      : [];

  return {
    maxAttempts,
    retryOn,
    backoffMs: Math.max(
      0,
      Math.min(
        3000,
        Number(source.backoffMs) || 120
      )
    )
  };
}

function normalizeDefinition(
  definition,
  defaults = {}
) {
  if (
    !definition ||
    typeof definition !== "object"
  ) {
    throw new TypeError(
      "Tool definition must be an object."
    );
  }

  const name = String(
    definition.name ?? ""
  ).trim();

  if (!name) {
    throw new TypeError(
      "Tool definition requires a name."
    );
  }

  if (!TOOL_NAME_PATTERN.test(name)) {
    throw new TypeError(
      `Tool name ${name} must match ${TOOL_NAME_PATTERN}.`
    );
  }

  if (
    typeof definition.execute !==
    "function"
  ) {
    throw new TypeError(
      `Tool ${name} requires execute().`
    );
  }

  if (!definition.inputSchema) {
    throw new TypeError(
      `Tool ${name} requires inputSchema.`
    );
  }

  const sideEffect =
    TOOL_SIDE_EFFECTS.has(
      definition.sideEffect
    )
      ? definition.sideEffect
      : TOOL_SIDE_EFFECTS.has(
          defaults.sideEffect
        )
        ? defaults.sideEffect
        : "none";
  const riskLevel =
    TOOL_RISK_LEVELS.has(
      definition.riskLevel
    )
      ? definition.riskLevel
      : TOOL_RISK_LEVELS.has(
          defaults.riskLevel
        )
        ? defaults.riskLevel
        : sideEffect === "none"
          ? "none"
          : "low";
  const version = Math.max(
    1,
    Math.round(Number(definition.version) || 1)
  );
  const source =
    String(
      definition.source ??
      defaults.source ??
      "builtin"
    ).trim() || "builtin";
  const toolsets = [
    ...new Set(
      (
        definition.toolsets ??
        defaults.toolsets ??
        [definition.toolset ?? defaults.toolset]
      )
        .flat()
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )
  ];
  const idempotency = TOOL_IDEMPOTENCY_MODES.has(
    definition.idempotency
  )
    ? definition.idempotency
    : ["none", "read"].includes(sideEffect)
      ? "natural"
      : "none";
  const explicitLimitAccounting =
    definition.countsTowardLimit ??
    defaults.countsTowardLimit;
  const countsTowardLimit =
    typeof explicitLimitAccounting === "boolean"
      ? explicitLimitAccounting
      : !(
          ["none", "low"].includes(riskLevel) &&
          ["none", "read"].includes(sideEffect)
        );
  const explicitRepeatAccounting =
    definition.countsTowardRepeatLimit ??
    defaults.countsTowardRepeatLimit;
  const countsTowardRepeatLimit =
    typeof explicitRepeatAccounting === "boolean"
      ? explicitRepeatAccounting
      : countsTowardLimit;
  const requestedVisibility =
    definition.activityVisibility ??
    defaults.activityVisibility;
  const activityVisibility =
    TOOL_ACTIVITY_VISIBILITY.has(requestedVisibility)
      ? requestedVisibility
      : sideEffect === "none" && riskLevel === "none"
        ? "developer"
        : "normal";
  const runtimeContract = normalizeToolRuntimeContract(
    definition.runtimeContract ?? defaults.runtimeContract,
    {
      sideEffect,
      idempotency,
      timeoutMs: definition.timeoutMs ?? defaults.timeoutMs
    }
  );
  const retryPolicy = normalizeRetryPolicy(
    definition.retryPolicy,
    { sideEffect }
  );
  if ([
    "manual_only",
    "reconcile_before_retry"
  ].includes(runtimeContract.retryMode)) {
    retryPolicy.maxAttempts = 1;
  }

  return {
    ...definition,
    name,
    version,
    id:
      String(definition.id ?? `${source}.${name}@${version}`).trim() ||
      `${source}.${name}@${version}`,
    title:
      String(
        definition.title ?? name
      ).trim() || name,
    description:
      String(
        definition.description ?? ""
      ).trim(),
    source,
    toolsets,
    riskLevel,
    sideEffect,
    idempotency,
    concurrencyKey:
      typeof definition.concurrencyKey === "function"
        ? definition.concurrencyKey
        : String(definition.concurrencyKey ?? "").trim() || null,
    countsTowardLimit,
    countsTowardRepeatLimit,
    activityVisibility,
    runtimeContract,
    timeoutMs:
      Number.isFinite(
        Number(definition.timeoutMs)
      )
        ? Math.max(
            0,
            Math.round(
              Number(
                definition.timeoutMs
              )
            )
          )
        : undefined,
    retryPolicy
  };
}

export class ToolRegistry {
  constructor() {
    this.definitions = new Map();
    this.ids = new Set();
    this.frozen = false;
  }

  register(
    definition,
    defaults = {}
  ) {
    if (this.frozen) {
      throw new Error("Tool registry is frozen.");
    }

    const normalized =
      normalizeDefinition(
        definition,
        defaults
      );

    if (
      this.definitions.has(
        normalized.name
      )
    ) {
      throw new Error(
        `Tool already registered: ${normalized.name}`
      );
    }

    if (this.ids.has(normalized.id)) {
      throw new Error(`Tool id already registered: ${normalized.id}`);
    }

    this.definitions.set(
      normalized.name,
      normalized
    );
    this.ids.add(normalized.id);

    return copyDefinition(normalized);
  }

  registerMany(
    definitions,
    defaults = {}
  ) {
    for (
      const definition
      of definitions ?? []
    ) {
      this.register(
        definition,
        defaults
      );
    }

    return this;
  }

  get(name) {
    const definition =
      this.definitions.get(
        String(name ?? "")
      );

    return definition
      ? copyDefinition(definition)
      : null;
  }

  list() {
    return [
      ...this.definitions.values()
    ].map(copyDefinition);
  }

  manifest() {
    return this.list().map(
      (definition) => ({
        id: definition.id,
        name: definition.name,
        version: definition.version,
        title: definition.title,
        description:
          definition.description,
        source: definition.source,
        toolsets: [...definition.toolsets],
        riskLevel:
          definition.riskLevel,
        sideEffect:
          definition.sideEffect,
        idempotency:
          definition.idempotency,
        countsTowardLimit:
          definition.countsTowardLimit,
        countsTowardRepeatLimit:
          definition.countsTowardRepeatLimit,
        activityVisibility:
          definition.activityVisibility,
        retryPolicy:
          cloneMetadata(
            definition.retryPolicy
          ),
        runtimeContract:
          publicToolRuntimeContract(
            definition.runtimeContract
          )
      })
    );
  }

  snapshot() {
    return new ToolRegistrySnapshot(this.list());
  }

  freeze() {
    this.frozen = true;
    return this.snapshot();
  }
}

export class ToolRegistrySnapshot {
  #definitions;

  constructor(definitions = []) {
    this.#definitions = new Map(
      definitions.map((definition) => [
        definition.name,
        copyDefinition(definition)
      ])
    );
    Object.freeze(this);
  }

  get(name) {
    const definition = this.#definitions.get(String(name ?? ""));
    return definition ? copyDefinition(definition) : null;
  }

  list() {
    return [...this.#definitions.values()].map(copyDefinition);
  }

  manifest() {
    return this.list().map((definition) => ({
      id: definition.id,
      name: definition.name,
      version: definition.version,
      title: definition.title,
      description: definition.description,
      source: definition.source,
      toolsets: [...definition.toolsets],
      riskLevel: definition.riskLevel,
      sideEffect: definition.sideEffect,
      idempotency: definition.idempotency,
      countsTowardLimit: definition.countsTowardLimit,
      countsTowardRepeatLimit: definition.countsTowardRepeatLimit,
      activityVisibility: definition.activityVisibility,
      retryPolicy: cloneMetadata(definition.retryPolicy),
      runtimeContract: publicToolRuntimeContract(
        definition.runtimeContract
      )
    }));
  }
}

export {
  normalizeDefinition as normalizeToolDefinition
};
