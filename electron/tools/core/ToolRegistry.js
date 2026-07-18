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

function cloneMetadata(value) {
  return structuredClone(value);
}

function copyDefinition(definition) {
  return {
    ...definition,
    retryPolicy: {
      ...definition.retryPolicy,
      retryOn: [
        ...(definition.retryPolicy?.retryOn ?? [])
      ]
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

  return {
    ...definition,
    name,
    title:
      String(
        definition.title ?? name
      ).trim() || name,
    description:
      String(
        definition.description ?? ""
      ).trim(),
    source:
      String(
        definition.source ??
        defaults.source ??
        "builtin"
      ).trim() || "builtin",
    riskLevel,
    sideEffect,
    countsTowardLimit:
      definition.countsTowardLimit !==
      false,
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
    retryPolicy:
      normalizeRetryPolicy(
        definition.retryPolicy,
        { sideEffect }
      )
  };
}

export class ToolRegistry {
  constructor() {
    this.definitions = new Map();
  }

  register(
    definition,
    defaults = {}
  ) {
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

    this.definitions.set(
      normalized.name,
      normalized
    );

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
        name: definition.name,
        title: definition.title,
        description:
          definition.description,
        source: definition.source,
        riskLevel:
          definition.riskLevel,
        sideEffect:
          definition.sideEffect,
        countsTowardLimit:
          definition.countsTowardLimit,
        retryPolicy:
          cloneMetadata(
            definition.retryPolicy
          )
      })
    );
  }
}

export {
  normalizeDefinition as normalizeToolDefinition
};
