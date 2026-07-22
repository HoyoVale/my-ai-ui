import {
  clone,
  sha256
} from "./canonical.js";

import {
  fingerprintTaskGraph,
  normalizeStoredTask,
  validateTaskGraph
} from "./TaskGraphContract.js";

import {
  normalizeStructuredHandoff
} from "./StructuredHandoff.js";

export const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "cancelled"
]);

export const TASK_STATUSES = new Set([
  "pending",
  "ready",
  "running",
  "review",
  "completed",
  "blocked",
  "failed",
  "cancelled",
  "continuable"
]);

export const AGENT_STATUSES = new Set([
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted"
]);

export const JOB_STATUSES = new Set([
  "queued",
  "scheduled",
  "running",
  "waiting_input",
  "waiting_approval",
  "waiting_external",
  "retry_scheduled",
  "paused",
  "completed",
  "failed",
  "cancelled"
]);

export const JOB_TRANSITIONS = Object.freeze({
  queued: new Set(["scheduled", "running", "waiting_input", "waiting_approval", "waiting_external", "paused", "cancelled"]),
  scheduled: new Set(["queued", "paused", "cancelled"]),
  running: new Set(["queued", "scheduled", "waiting_input", "waiting_approval", "waiting_external", "retry_scheduled", "paused", "completed", "failed", "cancelled"]),
  waiting_input: new Set(["queued", "paused", "cancelled"]),
  waiting_approval: new Set(["queued", "failed", "paused", "cancelled"]),
  waiting_external: new Set(["queued", "scheduled", "paused", "cancelled"]),
  retry_scheduled: new Set(["queued", "paused", "failed", "cancelled"]),
  paused: new Set(["queued", "scheduled", "waiting_input", "waiting_approval", "waiting_external", "retry_scheduled", "cancelled"]),
  completed: new Set(),
  failed: new Set(["queued", "retry_scheduled", "cancelled"]),
  cancelled: new Set()
});

export const TASK_TRANSITIONS = Object.freeze({
  pending: new Set(["ready", "blocked", "cancelled"]),
  ready: new Set(["running", "blocked", "cancelled"]),
  running: new Set(["review", "completed", "blocked", "failed", "cancelled", "continuable"]),
  review: new Set(["completed", "blocked", "failed", "continuable"]),
  completed: new Set(),
  blocked: new Set(["ready", "running", "cancelled", "continuable"]),
  failed: new Set(["ready", "running", "cancelled", "continuable"]),
  cancelled: new Set(),
  continuable: new Set(["ready", "running", "blocked", "failed", "cancelled", "completed"])
});

export const RUN_TRANSITIONS = Object.freeze({
  active: new Set(["paused", "continuable", "blocked", "failed", "cancelled", "completed"]),
  paused: new Set(["active", "cancelled"]),
  continuable: new Set(["active", "blocked", "failed", "cancelled", "completed"]),
  blocked: new Set(["active", "continuable", "failed", "cancelled"]),
  failed: new Set(["active", "continuable", "cancelled"]),
  cancelled: new Set(),
  completed: new Set()
});

export function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function createEmptyState() {
  return {
    version: 6,
    lastSequence: 0,
    lastEventHash: "",
    runs: {},
    jobs: {},
    approvals: {},
    notifications: {},
    lifecycle: {
      online: true,
      suspended: false,
      onBattery: false,
      lastChangedAt: 0,
      lastResumeAt: 0
    },
    leases: {},
    updatedAt: 0
  };
}

export function normalizeCriteria(criteria = []) {
  const ids = new Set();
  return (Array.isArray(criteria) ? criteria : [])
    .map((criterion, index) => {
      const source = typeof criterion === "string" ? { text: criterion } : criterion;
      const criterionText = text(source?.text, 500);
      if (!criterionText) return null;
      const base = text(source?.id, 120) || `criterion-${index + 1}`;
      let id = base;
      let suffix = 2;
      while (ids.has(id)) id = `${base.slice(0, 112)}-${suffix++}`;
      ids.add(id);
      return {
        id,
        text: criterionText,
        verificationKind: text(source?.verificationKind, 40) || "manual"
      };
    })
    .filter(Boolean)
    .slice(0, 12);
}

export function nonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

export function normalizeBudget(budget = {}) {
  return {
    tokenLimit: nonNegative(budget.tokenLimit, 0),
    stepLimit: nonNegative(budget.stepLimit, 0),
    timeLimitMs: nonNegative(budget.timeLimitMs, 0),
    tokensUsed: nonNegative(budget.tokensUsed, 0),
    stepsUsed: nonNegative(budget.stepsUsed, 0),
    elapsedMs: nonNegative(budget.elapsedMs, 0)
  };
}

export function normalizeRetryPolicy(policy = {}) {
  return {
    enabled: policy.enabled !== false,
    strategy: policy.strategy === "fixed" ? "fixed" : "exponential",
    baseDelayMs: Math.max(250, Math.min(24 * 60 * 60 * 1000, nonNegative(policy.baseDelayMs, 2_000))),
    maxDelayMs: Math.max(1_000, Math.min(7 * 24 * 60 * 60 * 1000, nonNegative(policy.maxDelayMs, 5 * 60 * 1000))),
    jitterRatio: Math.max(0, Math.min(0.5, Number(policy.jitterRatio) || 0)),
    retryableCodes: (Array.isArray(policy.retryableCodes) ? policy.retryableCodes : [])
      .map((value) => text(value, 160)).filter(Boolean).slice(0, 40),
    nonRetryableCodes: (Array.isArray(policy.nonRetryableCodes) ? policy.nonRetryableCodes : [])
      .map((value) => text(value, 160)).filter(Boolean).slice(0, 40),
    lastDelayMs: nonNegative(policy.lastDelayMs, 0),
    scheduledAt: nonNegative(policy.scheduledAt, 0) || null,
    lastErrorCode: text(policy.lastErrorCode, 160)
  };
}

export function normalizeWake(wake = {}) {
  const allowed = new Set(["immediate", "at", "network_online", "app_resume", "approval", "input", "external"]);
  return {
    policy: allowed.has(wake.policy) ? wake.policy : "immediate",
    at: nonNegative(wake.at, 0) || null,
    conditionKey: text(wake.conditionKey, 240),
    lastWakeAt: nonNegative(wake.lastWakeAt, 0) || null,
    wakeCount: nonNegative(wake.wakeCount, 0)
  };
}

export function normalizeJobRequirements(requirements = {}) {
  return {
    network: requirements.network === true,
    acPower: requirements.acPower === true
  };
}

export function summarizeJob(job) {
  return {
    id: job.id,
    platformRunId: job.platformRunId,
    type: job.type,
    title: job.title,
    status: job.status,
    statusReason: job.statusReason,
    waitingReason: job.waitingReason,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    priority: job.priority,
    budget: clone(job.budget),
    wake: clone(job.wake),
    retryPolicy: clone(job.retryPolicy),
    requirements: clone(job.requirements),
    approvalRequestId: job.approvalRequestId ?? null,
    inputRequest: job.inputRequest ? clone(job.inputRequest) : null,
    externalSignal: job.externalSignal ? clone(job.externalSignal) : null,
    checkpoint: job.checkpoint ? clone(job.checkpoint) : null,
    receiptCount: job.receipts?.length ?? 0,
    resultSummary: job.resultSummary,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    updatedAt: job.updatedAt
  };
}

export function taskDependenciesSettled(run, task) {
  return task.dependencies.every((dependencyId) =>
    run.tasks[dependencyId]?.status === "completed"
  );
}

export function summarizeRun(run) {
  const tasks = Object.values(run.tasks);
  const agents = Object.values(run.agentRuns);
  return {
    id: run.id,
    conversationId: run.conversationId,
    goalId: run.goalId,
    goalRevision: run.goalRevision,
    objective: run.objective,
    status: run.status,
    workspaceId: run.workspaceId,
    taskCounts: Object.fromEntries(
      [...TASK_STATUSES].map((status) => [
        status,
        tasks.filter((task) => task.status === status).length
      ])
    ),
    agentCounts: Object.fromEntries(
      [...AGENT_STATUSES].map((status) => [
        status,
        agents.filter((agent) => agent.status === status).length
      ])
    ),
    executionBridge: run.executionBridge
      ? {
          supervisorThreadId: run.executionBridge.supervisorThreadId ?? null,
          supervisorStatus: run.executionBridge.supervisorThread?.status ?? null,
          childThreadCount: Object.keys(run.executionBridge.childThreads ?? {}).length,
          bindingCount: Object.keys(run.executionBridge.agentRunBindings ?? {}).length
        }
      : null,
    integration: run.integration
      ? {
          status: run.integration.status,
          commit: run.integration.commit ?? null,
          conflictCount: run.integration.conflicts?.length ?? 0
        }
      : null,
    review: run.reviews?.at(-1)
      ? {
          status: run.reviews.at(-1).status,
          approved: run.reviews.at(-1).approved === true,
          integrationCommit: run.reviews.at(-1).integrationCommit ?? null
        }
      : null,
    evidence: {
      valid: (run.evidence ?? []).filter((item) => item.status === "valid").length,
      invalid: (run.evidence ?? []).filter((item) => item.status === "invalid").length,
      criteria: run.criteria?.length ?? 0
    },
    failure: run.failures?.at(-1)
      ? {
          type: run.failures.at(-1).type,
          code: run.failures.at(-1).code,
          requiresUserInput: run.failures.at(-1).requiresUserInput === true
        }
      : null,
    replanCount: run.replans?.length ?? 0,
    completionFingerprint: run.completionPermit?.fingerprint ?? null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  };
}


export {
  clone,
  sha256,
  fingerprintTaskGraph,
  normalizeStoredTask,
  validateTaskGraph,
  normalizeStructuredHandoff
};
