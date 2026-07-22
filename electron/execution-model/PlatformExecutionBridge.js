import crypto from "node:crypto";

import {
  createRunIdentity,
  RUN_RELATIONS,
  RUN_STATES_V2,
  sanitizeRunIdentity,
  transitionRunIdentity
} from "./RunIdentityContract.js";

const THREAD_STATUSES = new Set([
  "created",
  "active",
  "running",
  "waiting",
  "continuable",
  "completed",
  "failed",
  "cancelled",
  "archived"
]);

const CHILD_KINDS = new Set([
  "worker",
  "evaluator",
  "integrator",
  "reviewer"
]);

function text(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function timestamp(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

function stableId(prefix, ...parts) {
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(parts.map((part) => text(part, 500))))
    .digest("hex")
    .slice(0, 24);
  return `${prefix}-${hash}`;
}

function childKind(agentRun = {}) {
  const role = text(agentRun.role, 80).toLowerCase();
  if (role === "integrator") return "integrator";
  if (role === "reviewer") return "reviewer";
  if (agentRun.kind === "evaluator" || role === "evaluator") return "evaluator";
  return "worker";
}

function threadStateForAgentStatus(status) {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  if (status === "interrupted") return "continuable";
  if (status === "failed") return "failed";
  return "running";
}

function runStateForAgentStatus(status) {
  if (status === "completed") return RUN_STATES_V2.COMPLETED;
  if (status === "cancelled") return RUN_STATES_V2.CANCELLED;
  if (status === "interrupted") return RUN_STATES_V2.CONTINUABLE;
  if (status === "failed") return RUN_STATES_V2.FAILED;
  return RUN_STATES_V2.RUNNING;
}

function supervisorStateForPlatformStatus(status) {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  if (status === "failed") return "failed";
  if (["paused", "blocked"].includes(status)) return "waiting";
  if (status === "continuable") return "continuable";
  return "running";
}

function terminalRun(run, nextState, now) {
  let current = sanitizeRunIdentity(run);
  if (!current) return null;
  if (nextState === RUN_STATES_V2.COMPLETED && current.state === RUN_STATES_V2.RUNNING) {
    const finalizing = transitionRunIdentity(current, RUN_STATES_V2.FINALIZING, { now });
    if (!finalizing.ok) return current;
    current = finalizing.run;
  }
  const transitioned = transitionRunIdentity(current, nextState, { now });
  return transitioned.ok ? transitioned.run : current;
}

export function createPlatformExecutionBridge({
  platformRunId,
  conversationId = "",
  goalId = "",
  workspaceId = "",
  objective = "",
  status = "active",
  now = Date.now()
} = {}) {
  const normalizedRunId = text(platformRunId, 120);
  if (!normalizedRunId) return null;
  const supervisorThreadId = stableId("platform-supervisor-thread", normalizedRunId);
  return {
    version: 1,
    platformRunId: normalizedRunId,
    supervisorThreadId,
    supervisorThread: {
      version: 1,
      id: supervisorThreadId,
      kind: "supervisor",
      platformRunId: normalizedRunId,
      conversationId: text(conversationId, 120),
      goalId: text(goalId, 120),
      workspaceId: text(workspaceId, 120),
      objective: text(objective, 2000),
      status: supervisorStateForPlatformStatus(status),
      revision: 1,
      childThreadIds: [],
      createdAt: timestamp(now),
      updatedAt: timestamp(now),
      endedAt: null
    },
    childThreads: {},
    agentRunBindings: {},
    updatedAt: timestamp(now)
  };
}

export function createAgentExecutionBinding({
  platformRun,
  agentRun,
  now = Date.now()
} = {}) {
  const platformRunId = text(platformRun?.id, 120);
  const agentRunId = text(agentRun?.id, 120);
  if (!platformRunId || !agentRunId) return null;
  const bridge = platformRun?.executionBridge && typeof platformRun.executionBridge === "object"
    ? platformRun.executionBridge
    : createPlatformExecutionBridge({
        platformRunId,
        conversationId: platformRun?.conversationId,
        goalId: platformRun?.goalId,
        workspaceId: platformRun?.workspaceId,
        objective: platformRun?.objective,
        status: platformRun?.status,
        now: platformRun?.createdAt ?? now
      });
  const threadId = text(agentRun.executionThreadId, 120) ||
    stableId("platform-agent-thread", platformRunId, agentRunId);
  const executionRunId = text(agentRun.executionRunId, 120) ||
    stableId("platform-agent-run", platformRunId, agentRunId);
  const kind = childKind(agentRun);
  const createdAt = timestamp(agentRun.startedAt, timestamp(now));
  const executionRun = createRunIdentity({
    id: executionRunId,
    threadId,
    sequence: 1,
    state: runStateForAgentStatus(agentRun.status),
    relation: RUN_RELATIONS.INITIAL,
    now: createdAt
  });
  const childThread = {
    version: 1,
    id: threadId,
    parentThreadId: bridge.supervisorThreadId,
    platformRunId,
    conversationId: text(platformRun.conversationId, 120),
    goalId: text(platformRun.goalId, 120),
    taskId: text(agentRun.taskId, 120),
    agentRunId,
    role: text(agentRun.role, 80),
    kind,
    workspaceId: text(platformRun.workspaceId, 120),
    objective: text(platformRun.tasks?.[agentRun.taskId]?.title ?? platformRun.objective, 2000),
    status: threadStateForAgentStatus(agentRun.status),
    revision: 1,
    runs: executionRun ? [executionRun] : [],
    activeRunId: executionRunId,
    createdAt,
    updatedAt: timestamp(agentRun.endedAt, createdAt),
    endedAt: agentRun.endedAt == null ? null : timestamp(agentRun.endedAt)
  };
  return {
    threadId,
    executionRunId,
    kind,
    childThread,
    binding: {
      version: 1,
      agentRunId,
      threadId,
      executionRunId,
      taskId: childThread.taskId,
      kind,
      role: childThread.role,
      createdAt
    }
  };
}

function sanitizeChildThread(source, bridge, platformRun) {
  if (!source || typeof source !== "object") return null;
  const id = text(source.id, 120);
  const agentRunId = text(source.agentRunId, 120);
  if (!id || !agentRunId) return null;
  const runs = (Array.isArray(source.runs) ? source.runs : [])
    .map((run) => sanitizeRunIdentity({ ...run, threadId: id }))
    .filter(Boolean)
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-8);
  const kind = CHILD_KINDS.has(source.kind) ? source.kind : childKind(source);
  return {
    version: 1,
    id,
    parentThreadId: text(source.parentThreadId, 120) || bridge.supervisorThreadId,
    platformRunId: text(source.platformRunId, 120) || text(platformRun?.id, 120),
    conversationId: text(source.conversationId, 120) || text(platformRun?.conversationId, 120),
    goalId: text(source.goalId, 120) || text(platformRun?.goalId, 120),
    taskId: text(source.taskId, 120),
    agentRunId,
    role: text(source.role, 80),
    kind,
    workspaceId: text(source.workspaceId, 120) || text(platformRun?.workspaceId, 120),
    objective: text(source.objective, 2000),
    status: THREAD_STATUSES.has(source.status) ? source.status : "running",
    revision: Math.max(1, Math.round(Number(source.revision) || 1)),
    runs,
    activeRunId: text(source.activeRunId, 120) || runs.at(-1)?.id || "",
    createdAt: timestamp(source.createdAt, Date.now()),
    updatedAt: timestamp(source.updatedAt, Date.now()),
    endedAt: source.endedAt == null ? null : timestamp(source.endedAt)
  };
}

export function sanitizePlatformExecutionBridge(source, platformRun = {}) {
  const base = createPlatformExecutionBridge({
    platformRunId: platformRun.id ?? source?.platformRunId,
    conversationId: platformRun.conversationId,
    goalId: platformRun.goalId,
    workspaceId: platformRun.workspaceId,
    objective: platformRun.objective,
    status: platformRun.status,
    now: platformRun.createdAt ?? source?.updatedAt ?? Date.now()
  });
  if (!base) return null;
  const bridge = {
    ...base,
    ...(source && typeof source === "object" ? structuredClone(source) : {})
  };
  bridge.version = 1;
  bridge.platformRunId = base.platformRunId;
  bridge.supervisorThreadId = text(bridge.supervisorThreadId, 120) || base.supervisorThreadId;
  bridge.supervisorThread = {
    ...base.supervisorThread,
    ...(bridge.supervisorThread && typeof bridge.supervisorThread === "object"
      ? bridge.supervisorThread
      : {}),
    id: bridge.supervisorThreadId,
    platformRunId: base.platformRunId,
    conversationId: text(platformRun.conversationId, 120),
    goalId: text(platformRun.goalId, 120),
    workspaceId: text(platformRun.workspaceId, 120),
    objective: text(platformRun.objective, 2000),
    status: supervisorStateForPlatformStatus(platformRun.status),
    childThreadIds: [],
    updatedAt: timestamp(platformRun.updatedAt, Date.now())
  };
  bridge.childThreads = bridge.childThreads && typeof bridge.childThreads === "object"
    ? bridge.childThreads
    : {};
  bridge.agentRunBindings = bridge.agentRunBindings && typeof bridge.agentRunBindings === "object"
    ? bridge.agentRunBindings
    : {};

  const normalizedThreads = {};
  for (const candidate of Object.values(bridge.childThreads)) {
    const thread = sanitizeChildThread(candidate, bridge, platformRun);
    if (thread) normalizedThreads[thread.id] = thread;
  }
  bridge.childThreads = normalizedThreads;

  for (const agentRun of Object.values(platformRun.agentRuns ?? {})) {
    const binding = createAgentExecutionBinding({ platformRun: { ...platformRun, executionBridge: bridge }, agentRun });
    if (!binding) continue;
    const existing = bridge.childThreads[binding.threadId];
    bridge.childThreads[binding.threadId] = existing
      ? sanitizeChildThread({
          ...existing,
          ...binding.childThread,
          revision: Math.max(
            Number(existing.revision) || 1,
            Number(binding.childThread.revision) || 1
          ),
          createdAt: existing.createdAt ?? binding.childThread.createdAt
        }, bridge, platformRun)
      : binding.childThread;
    bridge.agentRunBindings[agentRun.id] = {
      ...(bridge.agentRunBindings[agentRun.id] ?? {}),
      ...binding.binding
    };
    agentRun.executionThreadId = binding.threadId;
    agentRun.executionRunId = binding.executionRunId;
    agentRun.parentExecutionThreadId = bridge.supervisorThreadId;
    agentRun.executionKind = binding.kind;
  }
  bridge.supervisorThread.childThreadIds = Object.keys(bridge.childThreads).sort();
  bridge.updatedAt = timestamp(platformRun.updatedAt, Date.now());
  return bridge;
}

export function attachAgentExecutionThread(bridgeSource, platformRun, agentRun, now = Date.now()) {
  const bridge = sanitizePlatformExecutionBridge(bridgeSource, platformRun);
  const binding = createAgentExecutionBinding({ platformRun: { ...platformRun, executionBridge: bridge }, agentRun, now });
  if (!bridge || !binding) return bridge;
  bridge.childThreads[binding.threadId] = binding.childThread;
  bridge.agentRunBindings[agentRun.id] = binding.binding;
  bridge.supervisorThread.childThreadIds = Object.keys(bridge.childThreads).sort();
  bridge.supervisorThread.updatedAt = timestamp(now);
  bridge.updatedAt = timestamp(now);
  return bridge;
}

export function finishAgentExecutionThread(bridgeSource, platformRun, agentRun, now = Date.now()) {
  const bridge = sanitizePlatformExecutionBridge(bridgeSource, platformRun);
  if (!bridge || !agentRun) return bridge;
  const binding = bridge.agentRunBindings?.[agentRun.id] ?? createAgentExecutionBinding({
    platformRun: { ...platformRun, executionBridge: bridge },
    agentRun,
    now
  })?.binding;
  const thread = binding ? bridge.childThreads[binding.threadId] : null;
  if (!thread) return bridge;
  const nextRunState = runStateForAgentStatus(agentRun.status);
  const currentRun = thread.runs.find((run) => run.id === binding.executionRunId) ?? thread.runs.at(-1);
  const updatedRun = currentRun ? terminalRun(currentRun, nextRunState, now) : null;
  thread.runs = updatedRun
    ? thread.runs.map((run) => run.id === updatedRun.id ? updatedRun : run)
    : thread.runs;
  thread.status = threadStateForAgentStatus(agentRun.status);
  thread.revision += 1;
  thread.updatedAt = timestamp(now);
  thread.endedAt = ["running"].includes(agentRun.status) ? null : timestamp(now);
  bridge.updatedAt = timestamp(now);
  bridge.supervisorThread.updatedAt = timestamp(now);
  return bridge;
}

export function syncPlatformExecutionBridgeStatus(bridgeSource, platformRun, now = Date.now()) {
  const bridge = sanitizePlatformExecutionBridge(bridgeSource, platformRun);
  if (!bridge) return null;
  bridge.supervisorThread.status = supervisorStateForPlatformStatus(platformRun.status);
  bridge.supervisorThread.revision += 1;
  bridge.supervisorThread.updatedAt = timestamp(now);
  bridge.supervisorThread.endedAt = ["completed", "failed", "cancelled"].includes(platformRun.status)
    ? timestamp(now)
    : null;
  bridge.updatedAt = timestamp(now);
  return bridge;
}

function traceForThread(run, thread) {
  const artifactIds = (run.artifacts ?? [])
    .filter((artifact) => artifact.agentRunId === thread.agentRunId)
    .map((artifact) => artifact.id);
  const artifactSet = new Set(artifactIds);
  const evidenceIds = (run.evidence ?? [])
    .filter((evidence) => artifactSet.has(evidence.artifactId))
    .map((evidence) => evidence.id);
  const reviewIds = (run.reviews ?? [])
    .filter((review) => review.agentRunId === thread.agentRunId)
    .map((review) => review.id);
  const integrationIds = run.integration?.agentRunId === thread.agentRunId
    ? [run.integration.id ?? run.integration.digest ?? "integration"]
    : [];
  return { artifactIds, evidenceIds, reviewIds, integrationIds };
}

export function projectPlatformExecutionBridge(platformRun) {
  if (!platformRun || typeof platformRun !== "object") return null;
  const bridge = sanitizePlatformExecutionBridge(platformRun.executionBridge, platformRun);
  if (!bridge) return null;
  const children = Object.values(bridge.childThreads)
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .map((thread) => ({
      ...structuredClone(thread),
      trace: traceForThread(platformRun, thread)
    }));
  return {
    version: 1,
    platformRunId: platformRun.id,
    supervisor: {
      ...structuredClone(bridge.supervisorThread),
      taskGraphRevision: Math.max(0, Number(platformRun.taskGraphRevision) || 0),
      childThreadIds: children.map((thread) => thread.id),
      completionFingerprint: platformRun.completionPermit?.fingerprint ?? null
    },
    children,
    bindings: structuredClone(bridge.agentRunBindings),
    trace: {
      artifactIds: (platformRun.artifacts ?? []).map((item) => item.id),
      evidenceIds: (platformRun.evidence ?? []).map((item) => item.id),
      reviewIds: (platformRun.reviews ?? []).map((item) => item.id),
      integrationDigest: platformRun.integration?.digest ?? null,
      completionFingerprint: platformRun.completionPermit?.fingerprint ?? null
    }
  };
}

export function validatePlatformExecutionBridge(platformRun) {
  const projected = projectPlatformExecutionBridge(platformRun);
  if (!projected) return { ok: false, errors: ["platform-execution-bridge-missing"] };
  const errors = [];
  const threadIds = new Set();
  const executionRunIds = new Set();
  for (const thread of projected.children) {
    if (threadIds.has(thread.id)) errors.push("child-thread-id-duplicate");
    threadIds.add(thread.id);
    if (thread.parentThreadId !== projected.supervisor.id) {
      errors.push(`child-parent-mismatch:${thread.id}`);
    }
    const binding = projected.bindings[thread.agentRunId];
    if (!binding || binding.threadId !== thread.id) {
      errors.push(`agent-binding-missing:${thread.agentRunId}`);
    }
    if (thread.runs.length !== 1) {
      errors.push(`agent-thread-run-count-invalid:${thread.id}`);
    }
    for (const run of thread.runs) {
      if (run.threadId !== thread.id) errors.push(`execution-run-thread-mismatch:${run.id}`);
      if (executionRunIds.has(run.id)) errors.push(`execution-run-id-duplicate:${run.id}`);
      executionRunIds.add(run.id);
    }
  }
  for (const agentRun of Object.values(platformRun.agentRuns ?? {})) {
    const binding = projected.bindings[agentRun.id];
    if (!binding) errors.push(`agent-run-unbound:${agentRun.id}`);
  }
  return { ok: errors.length === 0, errors, bridge: projected };
}
