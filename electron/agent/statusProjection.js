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

const PUBLIC_STATUS_FIELDS = Object.freeze([
  "state",
  "runId",
  "conversationId",
  "startedAt",
  "lastError",
  "stopReason",
  "taskId",
  "phase",
  "outcome",
  "executionStopReason",
  "resumable",
  "publicStatus",
  "replaceMessageId",
  "stepNumber"
]);

function pick(source, keys) {
  const projected = {};
  for (const key of keys) {
    if (source[key] !== undefined) {
      projected[key] = clone(source[key]);
    }
  }
  return projected;
}

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
  if (!error) {
    return undefined;
  }

  const message = String(
    typeof error === "object"
      ? error.message ?? ""
      : error
  ).trim();

  if (!message) {
    return undefined;
  }

  return {
    code: String(
      typeof error === "object"
        ? error.code ?? "TOOL_EXECUTION_FAILED"
        : "AGENT_ERROR"
    ),
    message: message.slice(0, 400),
    retryable:
      typeof error === "object" &&
      error.retryable === true
  };
}


function publicChangePreview(result) {
  const source = result?.changePreview ?? result?.data?.data?.changePreview ?? result?.data?.changePreview;
  if (!source || typeof source !== "object") return undefined;
  const diff = String(source.diff ?? "").slice(0, 24040);
  if (!diff) return undefined;
  return {
    kind: "unified_diff",
    path: String(source.path ?? "").slice(0, 500),
    paths: Array.isArray(source.paths)
      ? source.paths.map((item) => String(item).slice(0, 500)).slice(0, 50)
      : undefined,
    diff,
    truncated: source.truncated === true
  };
}

function publicCommandPreview(result) {
  const source = result?.commandPreview ?? result?.data?.data ?? result?.data ??
    (result?.displayCommand ? result : undefined);
  if (!source || typeof source !== "object" || !source.displayCommand) return undefined;
  return {
    displayCommand: String(source.displayCommand).slice(0, 1200),
    command: String(source.command ?? "").slice(0, 500),
    args: Array.isArray(source.args) ? source.args.map((item) => String(item).slice(0, 1000)).slice(0, 64) : [],
    cwd: String(source.cwd ?? "").slice(0, 500),
    kind: String(source.kind ?? "process").slice(0, 80),
    script: String(source.script ?? "").slice(0, 120),
    exitCode: source.exitCode === undefined || source.exitCode === null
      ? null
      : Number(source.exitCode),
    durationMs: Math.max(0, Number(source.durationMs) || 0),
    stdout: String(source.stdout ?? "").slice(0, 24000),
    stderr: String(source.stderr ?? "").slice(0, 12000),
    stdoutTruncated: source.stdoutTruncated === true,
    stderrTruncated: source.stderrTruncated === true,
    terminated: source.terminated === true,
    terminationReason: String(source.terminationReason ?? "").slice(0, 120)
  };
}

function publicResult(result) {
  if (!result || typeof result !== "object") {
    return undefined;
  }

  const summary = String(result.summary ?? "").trim();
  const status = String(result.status ?? "").trim();
  const error = publicError(result.error);
  const changePreview = publicChangePreview(result);
  const commandPreview = publicCommandPreview(result);

  if (!summary && !status && !error && !changePreview && !commandPreview) {
    return undefined;
  }

  return {
    status,
    summary: summary.slice(0, 400),
    truncated: result.truncated === true,
    clipped: result.clipped === true,
    error,
    changePreview,
    commandPreview
  };
}

function publicRuntime(runtime) {
  if (!runtime || typeof runtime !== "object") {
    return undefined;
  }

  const state = String(runtime.state ?? "").trim();
  const recoveryAction = String(
    runtime.recoveryAction ?? runtime.recovery ?? ""
  ).trim();

  if (!state && !recoveryAction) {
    return undefined;
  }

  return {
    state,
    recoveryAction
  };
}

function compactPlan(plan = []) {
  return (Array.isArray(plan) ? plan : []).map((item, index) => ({
    id: String(item?.id ?? `plan-${index}`),
    title: String(item?.title ?? item?.step ?? "未命名步骤").slice(0, 240),
    status: String(item?.status ?? "pending"),
    reason: item?.reason
      ? String(item.reason).slice(0, 300)
      : ""
  }));
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
    commandPreview: publicCommandPreview(record.commandPreview),
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
        "attention",
        "needs_reconciliation",
        "needs_confirmation"
      ].includes(event.status);

    return visible
      ? {
          ...clone(event),
          error: publicError(event.error)
        }
      : null;
  }

  if (event.type === "tool") {
    return {
      ...clone(event),
      tool: projectToolRecord(event.tool)
    };
  }

  if (["commentary", "plan", "batch", "skill"].includes(event.type)) {
    return clone(event);
  }

  return event.activityVisibility === "developer"
    ? null
    : clone(event);
}

export function projectActivitySnapshot(
  activity,
  {
    developerMode = false,
    maxEvents = Number.POSITIVE_INFINITY
  } = {}
) {
  if (!activity || typeof activity !== "object") {
    return activity ?? null;
  }

  if (developerMode) {
    return clone(activity);
  }

  const events = (activity.events ?? [])
    .map(publicEvent)
    .filter(Boolean);
  const limited = Number.isFinite(maxEvents)
    ? events.slice(-Math.max(0, maxEvents))
    : events;

  return {
    ...pick(activity, [
      "taskId",
      "runId",
      "status",
      "outcome",
      "resumable",
      "stopReason",
      "startedAt",
      "endedAt",
      "durationMs"
    ]),
    events: limited
  };
}

export function projectRuntimeRecovery(
  runtime,
  {
    unresolvedOnly = false,
    maxCalls = 50
  } = {}
) {
  if (!runtime || typeof runtime !== "object") {
    return null;
  }

  const calls = (Array.isArray(runtime.calls) ? runtime.calls : [])
    .filter((call) =>
      !unresolvedOnly ||
      ["needs_confirmation", "needs_reconciliation"].includes(
        String(call?.recovery ?? "")
      )
    );
  const limitedCalls = Number.isFinite(maxCalls)
    ? calls.slice(-Math.max(0, maxCalls))
    : calls;

  return {
    version: runtime.version,
    totalCalls: Number(runtime.totalCalls ?? 0),
    unresolvedCount: Number(runtime.unresolvedCount ?? 0),
    needsConfirmation: Number(runtime.needsConfirmation ?? 0),
    needsReconciliation: Number(runtime.needsReconciliation ?? 0),
    calls: limitedCalls.map((call) => ({
      callId: String(call.callId ?? ""),
      toolName: String(call.toolName ?? ""),
      state: String(call.state ?? ""),
      publicStatus: String(call.publicStatus ?? ""),
      recovery: String(call.recovery ?? ""),
      effect: String(call.effect ?? ""),
      hasReceipt: call.hasReceipt === true,
      actions: Array.isArray(call.actions)
        ? [...call.actions]
        : []
    }))
  };
}

function publicApproval(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return {
    id: String(value.id ?? ""),
    runId: String(value.runId ?? ""),
    taskId: String(value.taskId ?? ""),
    callId: String(value.callId ?? ""),
    toolId: String(value.toolId ?? ""),
    toolName: String(value.toolName ?? ""),
    title: String(value.title ?? value.toolName ?? "工具调用").slice(0, 160),
    source: String(value.source ?? "builtin").slice(0, 160),
    riskLevel: String(value.riskLevel ?? "medium"),
    effect: String(value.effect ?? "remote_write"),
    reason: String(value.reason ?? "该工具调用需要批准。").slice(0, 600),
    input: clone(value.input ?? {}),
    inputTruncated: value.inputTruncated === true,
    allowRunGrant: value.allowRunGrant === true,
    untrustedContent: value.untrustedContent === true,
    security: value.untrustedContent
      ? {
          suspiciousResults: Number(value.security?.suspiciousResults ?? 0),
          lastToolName: String(value.security?.lastToolName ?? "").slice(0, 160),
          lastSignals: (value.security?.lastSignals ?? [])
            .map((item) => String(item).slice(0, 120))
            .slice(0, 8)
        }
      : null,
    requestedAt: Number(value.requestedAt ?? 0),
    expiresAt: Number(value.expiresAt ?? 0),
    queuedCount: Math.max(1, Number(value.queuedCount ?? 1))
  };
}

function publicSkillRun(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return {
    id: String(value.id ?? "").slice(0, 120),
    name: String(value.name ?? value.id ?? "Skill").slice(0, 120),
    version: String(value.version ?? "").slice(0, 80),
    status: String(value.status ?? "running").slice(0, 40),
    selectedToolNames: (value.selectedToolNames ?? [])
      .map((item) => String(item).slice(0, 160))
      .slice(0, 100),
    missingRequired: (value.missingRequired ?? [])
      .map((item) => String(item).slice(0, 160))
      .slice(0, 32),
    startedAt: Number(value.startedAt ?? 0),
    endedAt: value.endedAt === null ? null : Number(value.endedAt ?? 0)
  };
}

function publicToolSecurity(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return {
    untrustedResults: Number(value.untrustedResults ?? 0),
    suspiciousResults: Number(value.suspiciousResults ?? 0),
    promptInjectionSuspected: value.promptInjectionSuspected === true,
    lastToolName: String(value.lastToolName ?? "").slice(0, 160),
    lastDetectedAt: Number(value.lastDetectedAt ?? 0) || null
  };
}

function basePublicStatus(source) {
  return {
    ...pick(source, PUBLIC_STATUS_FIELDS),
    lastError: publicError(source.lastError)?.message ?? null
  };
}

export function projectInputStatus(status) {
  const source = status && typeof status === "object"
    ? status
    : {};

  return {
    ...basePublicStatus(source),
    pendingApproval: publicApproval(source.pendingApproval)
  };
}

export function projectResponseStatus(status) {
  const source = status && typeof status === "object"
    ? status
    : {};

  return {
    ...basePublicStatus(source),
    pendingApproval: publicApproval(source.pendingApproval),
    toolSecurity: publicToolSecurity(source.toolSecurity),
    skillRun: publicSkillRun(source.skillRun),
    plan: compactPlan(source.plan),
    activity: projectActivitySnapshot(source.activity, {
      maxEvents: 30
    }),
    toolRuntime: projectRuntimeRecovery(source.toolRuntime, {
      unresolvedOnly: true,
      maxCalls: 12
    }),
    liveStepText: String(source.liveStepText ?? ""),
    liveStepRole: String(source.liveStepRole ?? "none"),
    finalText: String(source.finalText ?? ""),
    diffSummary: source.diffSummary && typeof source.diffSummary === "object"
      ? structuredClone(source.diffSummary)
      : null,
    assistantText: String(
      source.finalText || source.liveStepText || source.assistantText || ""
    )
  };
}

export function projectConversationStatus(status) {
  const source = status && typeof status === "object"
    ? status
    : {};

  return {
    ...basePublicStatus(source),
    pendingApproval: publicApproval(source.pendingApproval),
    toolSecurity: publicToolSecurity(source.toolSecurity),
    skillRun: publicSkillRun(source.skillRun),
    plan: compactPlan(source.plan),
    activeToolCalls: (source.activeToolCalls ?? [])
      .slice(-80)
      .map((record) => projectToolRecord(record)),
    activity: projectActivitySnapshot(source.activity, {
      maxEvents: 240
    }),
    toolRuntime: projectRuntimeRecovery(source.toolRuntime, {
      unresolvedOnly: true,
      maxCalls: 24
    }),
    liveStepText: String(source.liveStepText ?? ""),
    liveStepRole: String(source.liveStepRole ?? "none"),
    finalText: String(source.finalText ?? ""),
    diffSummary: source.diffSummary && typeof source.diffSummary === "object"
      ? structuredClone(source.diffSummary)
      : null,
    assistantText: String(
      source.finalText || source.liveStepText || source.assistantText || ""
    )
  };
}

export function projectAgentSnapshot(
  status,
  { target = "generic" } = {}
) {
  if (target === "response") {
    return projectResponseStatus(status);
  }

  if (target === "conversation") {
    return projectConversationStatus(status);
  }

  return projectInputStatus(status);
}

export function projectAgentStatus(
  status,
  { developerMode = false } = {}
) {
  const source = status && typeof status === "object"
    ? status
    : {};

  if (developerMode) {
    return clone(source);
  }

  return {
    ...projectConversationStatus(source),
    ...(Array.isArray(source.toolRegistry)
      ? {
          toolRegistry: source.toolRegistry.map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            riskLevel: tool.riskLevel,
            sideEffect: tool.sideEffect,
            activityVisibility: tool.activityVisibility
          }))
        }
      : {}),
    toolRuntimeDiagnostics: null,
    providerRuntimeDiagnostics: null
  };
}
