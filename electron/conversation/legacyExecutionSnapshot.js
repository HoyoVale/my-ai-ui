const MAX_THREADS = 48;
const MAX_ROUTING_DECISIONS = 200;
const MAX_RUNS = 120;

function text(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function timestamp(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.round(number))
    : fallback;
}

function boundedValue(value, {
  depth = 0,
  maxDepth = 5,
  maxArrayLength = 80,
  maxObjectKeys = 80,
  maxStringLength = 12000
} = {}) {
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    return value.slice(0, maxStringLength);
  }
  if (depth >= maxDepth) {
    try {
      return JSON.stringify(value).slice(0, maxStringLength);
    } catch {
      return String(value).slice(0, maxStringLength);
    }
  }
  if (Array.isArray(value)) {
    return value.slice(0, maxArrayLength).map((item) => boundedValue(item, {
      depth: depth + 1,
      maxDepth,
      maxArrayLength,
      maxObjectKeys,
      maxStringLength
    }));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, maxObjectKeys)
        .map(([key, item]) => [
          String(key).slice(0, 160),
          boundedValue(item, {
            depth: depth + 1,
            maxDepth,
            maxArrayLength,
            maxObjectKeys,
            maxStringLength
          })
        ])
    );
  }
  return String(value).slice(0, maxStringLength);
}

function sanitizeLegacyRun(source, threadId) {
  if (!source || typeof source !== "object") return null;
  const id = text(source.id, 120);
  if (!id) return null;
  return {
    version: Math.max(1, Math.round(Number(source.version) || 1)),
    id,
    threadId: text(source.threadId, 120) || threadId,
    sequence: Math.max(0, Math.round(Number(source.sequence) || 0)),
    state: text(source.state, 40),
    relation: text(source.relation, 40),
    parentRunId: text(source.parentRunId, 120),
    sourceRunId: text(source.sourceRunId, 120),
    createdAt: timestamp(source.createdAt),
    updatedAt: timestamp(source.updatedAt),
    endedAt: source.endedAt == null ? null : timestamp(source.endedAt),
    metadata: boundedValue(source.metadata ?? null, {
      maxDepth: 4,
      maxArrayLength: 40,
      maxObjectKeys: 60,
      maxStringLength: 4000
    })
  };
}

export function sanitizeLegacyExecutionThread(source) {
  if (!source || typeof source !== "object") return null;
  const id = text(source.id, 120);
  if (!id) return null;

  const runs = (Array.isArray(source.runs) ? source.runs : [])
    .map((run) => sanitizeLegacyRun(run, id))
    .filter(Boolean)
    .sort((left, right) =>
      left.sequence - right.sequence || left.createdAt - right.createdAt
    )
    .slice(-MAX_RUNS);

  return {
    version: Math.max(1, Math.round(Number(source.version) || 1)),
    id,
    taskId: text(source.taskId, 120),
    goalId: text(source.goalId, 120),
    platformRunId: text(source.platformRunId, 120),
    objective: text(source.objective, 2000),
    status: text(source.status, 40) || "archived",
    mode: source.mode === "coding" ? "coding" : "chat",
    workspaceId: text(source.workspaceId, 120),
    revision: Math.max(1, Math.round(Number(source.revision) || 1)),
    runs,
    lastRunId: text(source.lastRunId, 120) || runs.at(-1)?.id || "",
    lastAssistantMessageId: text(source.lastAssistantMessageId, 120),
    continuationCount: Math.max(
      0,
      Math.round(Number(source.continuationCount) || 0)
    ),
    stopReason: text(source.stopReason, 120),
    resumable: source.resumable === true,
    providerContinuation: boundedValue(source.providerContinuation ?? null, {
      maxDepth: 4,
      maxArrayLength: 20,
      maxObjectKeys: 40,
      maxStringLength: 4000
    }),
    checkpoint: boundedValue(source.checkpoint ?? null, {
      maxDepth: 5,
      maxArrayLength: 80,
      maxObjectKeys: 100,
      maxStringLength: 12000
    }),
    workingState: boundedValue(source.workingState ?? null, {
      maxDepth: 5,
      maxArrayLength: 80,
      maxObjectKeys: 100,
      maxStringLength: 12000
    }),
    planState: boundedValue(source.planState ?? source.plan ?? null, {
      maxDepth: 5,
      maxArrayLength: 80,
      maxObjectKeys: 100,
      maxStringLength: 12000
    }),
    createdAt: timestamp(source.createdAt),
    updatedAt: timestamp(source.updatedAt),
    completedAt: source.completedAt == null
      ? null
      : timestamp(source.completedAt)
  };
}

export function sanitizeLegacyRoutingDecision(source) {
  if (!source || typeof source !== "object") return null;
  const id = text(source.id, 120);
  if (!id) return null;
  return {
    version: Math.max(1, Math.round(Number(source.version) || 1)),
    id,
    command: text(source.command, 40),
    action: text(source.action, 40),
    state: text(source.state, 40),
    source: text(source.source, 60),
    conversationId: text(source.conversationId, 120),
    workspaceId: text(source.workspaceId, 120),
    messageId: text(source.messageId, 120),
    currentThreadId: text(source.currentThreadId, 120),
    targetThreadId: text(source.targetThreadId, 120),
    activeRunId: text(source.activeRunId, 120),
    sourceThreadId: text(source.sourceThreadId, 120),
    sourceRunId: text(source.sourceRunId, 120),
    targetRunId: text(source.targetRunId, 120),
    reason: text(source.reason, 500),
    evidence: (Array.isArray(source.evidence) ? source.evidence : [])
      .map((item) => text(item, 160))
      .filter(Boolean)
      .slice(0, 40),
    shadow: boundedValue(source.shadow ?? null, {
      maxDepth: 3,
      maxArrayLength: 20,
      maxObjectKeys: 30,
      maxStringLength: 2000
    }),
    rollout: boundedValue(source.rollout ?? null, {
      maxDepth: 4,
      maxArrayLength: 30,
      maxObjectKeys: 50,
      maxStringLength: 3000
    }),
    createdAt: timestamp(source.createdAt)
  };
}

export function sanitizeLegacyExecutionSnapshot(source = {}) {
  const legacyThread = sanitizeLegacyExecutionThread(source.executionThread);
  const candidates = Array.isArray(source.executionThreads)
    ? source.executionThreads
    : legacyThread
      ? [legacyThread]
      : [];
  const byId = new Map();

  for (const candidate of candidates) {
    const thread = sanitizeLegacyExecutionThread(candidate);
    if (!thread) continue;
    const current = byId.get(thread.id);
    if (!current || thread.updatedAt >= current.updatedAt) {
      byId.set(thread.id, thread);
    }
  }

  if (legacyThread) {
    const current = byId.get(legacyThread.id);
    if (!current || legacyThread.updatedAt >= current.updatedAt) {
      byId.set(legacyThread.id, legacyThread);
    }
  }

  const executionThreads = [...byId.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_THREADS);
  const requestedActiveId = text(
    source.activeExecutionThreadId || legacyThread?.id,
    120
  );
  const activeExecutionThreadId = executionThreads.some(
    (thread) => thread.id === requestedActiveId
  )
    ? requestedActiveId
    : executionThreads[0]?.id ?? null;

  const routingById = new Map();
  for (const candidate of Array.isArray(source.routingDecisions)
    ? source.routingDecisions
    : []) {
    const decision = sanitizeLegacyRoutingDecision(candidate);
    if (decision) routingById.set(decision.id, decision);
  }
  const routingDecisions = [...routingById.values()]
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(-MAX_ROUTING_DECISIONS);

  return {
    version: 1,
    readOnly: true,
    activeExecutionThreadId,
    executionThreads,
    routingDecisions
  };
}
