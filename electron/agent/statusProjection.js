function clone(value) {
  return value === undefined
    ? undefined
    : structuredClone(value);
}

const PUBLIC_TARGET_KEYS = Object.freeze([
  "path",
  "directory",
  "root",
  "query",
  "expression",
  "timezone",
  "targetTimezone"
]);

function publicInput(input) {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const projected = {};

  for (const key of PUBLIC_TARGET_KEYS) {
    if (input[key] === undefined) {
      continue;
    }

    const value = String(input[key]);
    projected[key] = value.length > 180
      ? `${value.slice(0, 176)}…`
      : value;
  }

  return Object.keys(projected).length > 0
    ? projected
    : undefined;
}

function publicError(error) {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const message = String(error.message ?? "").trim();

  if (!message) {
    return undefined;
  }

  return {
    code: String(error.code ?? "TOOL_EXECUTION_FAILED"),
    message: message.slice(0, 400),
    retryable: error.retryable === true
  };
}

function publicResult(result) {
  if (!result || typeof result !== "object") {
    return undefined;
  }

  const summary = String(result.summary ?? "").trim();
  const status = String(result.status ?? "").trim();

  if (!summary && !status) {
    return undefined;
  }

  return {
    status,
    summary: summary.slice(0, 400),
    truncated: result.truncated === true,
    clipped: result.clipped === true,
    error: publicError(result.error)
  };
}

function publicRuntime(runtime) {
  if (!runtime || typeof runtime !== "object") {
    return undefined;
  }

  const state = String(runtime.state ?? "").trim();
  const recoveryAction = String(
    runtime.recoveryAction ?? ""
  ).trim();

  if (!state && !recoveryAction) {
    return undefined;
  }

  return {
    state,
    recoveryAction
  };
}

export function projectToolRecord(
  record,
  { developerMode = false } = {}
) {
  if (!record || typeof record !== "object") {
    return record;
  }

  if (developerMode) {
    return clone(record);
  }

  return {
    id: record.id,
    name: record.name,
    title: record.title,
    source: record.source,
    riskLevel: record.riskLevel,
    sideEffect: record.sideEffect,
    countsTowardLimit: record.countsTowardLimit,
    countsTowardRepeatLimit: record.countsTowardRepeatLimit,
    activityVisibility: record.activityVisibility,
    gracefulBoundary: record.gracefulBoundary,
    status: record.status,
    batch: clone(record.batch),
    batchId: record.batchId,
    batchObjective: record.batchObjective,
    input: publicInput(record.input),
    result: publicResult(record.result),
    planStep: clone(record.planStep),
    queuedAt: record.queuedAt,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    durationMs: record.durationMs ?? 0,
    attempt: record.attempt ?? 0,
    maxAttempts: record.maxAttempts ?? 0,
    runtime: publicRuntime(record.runtime),
    lastError: publicError(record.lastError)
  };
}

function publicEvent(event) {
  if (!event || typeof event !== "object") {
    return null;
  }

  if (event.type === "status") {
    const visible =
      event.activityVisibility !== "developer" ||
      [
        "failed",
        "cancelled",
        "interrupted",
        "attention"
      ].includes(event.status);

    return visible
      ? clone(event)
      : null;
  }

  if (event.type === "tool") {
    return {
      ...clone(event),
      tool: projectToolRecord(event.tool)
    };
  }

  if (["commentary", "plan", "batch"].includes(event.type)) {
    return clone(event);
  }

  return event.activityVisibility === "developer"
    ? null
    : clone(event);
}

export function projectActivitySnapshot(
  activity,
  { developerMode = false } = {}
) {
  if (!activity || typeof activity !== "object") {
    return activity ?? null;
  }

  if (developerMode) {
    return clone(activity);
  }

  return {
    ...clone(activity),
    events: (activity.events ?? [])
      .map(publicEvent)
      .filter(Boolean)
  };
}

export function projectAgentStatus(
  status,
  { developerMode = false } = {}
) {
  const source = status && typeof status === "object"
    ? status
    : {};

  return {
    ...clone(source),
    activeToolCalls: (source.activeToolCalls ?? []).map(
      (record) => projectToolRecord(record, { developerMode })
    ),
    activity: projectActivitySnapshot(
      source.activity,
      { developerMode }
    ),
    ...(Array.isArray(source.toolRegistry)
      ? {
          toolRegistry: developerMode
            ? clone(source.toolRegistry)
            : source.toolRegistry.map((tool) => ({
                name: tool.name,
                title: tool.title,
                description: tool.description,
                riskLevel: tool.riskLevel,
                sideEffect: tool.sideEffect,
                activityVisibility: tool.activityVisibility
              }))
        }
      : {}),
    toolRuntimeDiagnostics: developerMode
      ? clone(source.toolRuntimeDiagnostics)
      : null
  };
}
