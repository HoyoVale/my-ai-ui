import crypto from "node:crypto";
import path from "node:path";

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

import {
  CompletionAuthority
} from "./CompletionAuthority.js";

import {
  PlatformEventJournal
} from "./PlatformEventJournal.js";

import {
  PlatformSnapshotStore
} from "./PlatformSnapshotStore.js";

const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "cancelled"
]);

const TASK_STATUSES = new Set([
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

const AGENT_STATUSES = new Set([
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted"
]);

const JOB_STATUSES = new Set([
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled"
]);

const JOB_TRANSITIONS = Object.freeze({
  queued: new Set(["running", "paused", "cancelled"]),
  running: new Set(["queued", "paused", "completed", "failed", "cancelled"]),
  paused: new Set(["queued", "cancelled"]),
  completed: new Set(),
  failed: new Set(["queued", "cancelled"]),
  cancelled: new Set()
});

const TASK_TRANSITIONS = Object.freeze({
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

const RUN_TRANSITIONS = Object.freeze({
  active: new Set(["paused", "continuable", "blocked", "failed", "cancelled", "completed"]),
  paused: new Set(["active", "cancelled"]),
  continuable: new Set(["active", "blocked", "failed", "cancelled", "completed"]),
  blocked: new Set(["active", "continuable", "failed", "cancelled"]),
  failed: new Set(["active", "continuable", "cancelled"]),
  cancelled: new Set(),
  completed: new Set()
});

function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function createEmptyState() {
  return {
    version: 4,
    lastSequence: 0,
    lastEventHash: "",
    runs: {},
    jobs: {},
    leases: {},
    updatedAt: 0
  };
}

function normalizeCriteria(criteria = []) {
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

function nonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

function normalizeBudget(budget = {}) {
  return {
    tokenLimit: nonNegative(budget.tokenLimit, 0),
    stepLimit: nonNegative(budget.stepLimit, 0),
    timeLimitMs: nonNegative(budget.timeLimitMs, 0),
    tokensUsed: nonNegative(budget.tokensUsed, 0),
    stepsUsed: nonNegative(budget.stepsUsed, 0),
    elapsedMs: nonNegative(budget.elapsedMs, 0)
  };
}

function summarizeJob(job) {
  return {
    id: job.id,
    platformRunId: job.platformRunId,
    type: job.type,
    title: job.title,
    status: job.status,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    priority: job.priority,
    budget: clone(job.budget),
    resultSummary: job.resultSummary,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    updatedAt: job.updatedAt
  };
}

function taskDependenciesSettled(run, task) {
  return task.dependencies.every((dependencyId) =>
    run.tasks[dependencyId]?.status === "completed"
  );
}

function summarizeRun(run) {
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

export class PlatformKernel {
  constructor({
    getStorageDirectory,
    now = () => Date.now(),
    createId = () => crypto.randomUUID(),
    leaseTtlMs = 90_000,
    durableJournal = true,
    completionAuthority = null,
    onChange = () => {}
  } = {}) {
    if (typeof getStorageDirectory !== "function") {
      throw new TypeError("PlatformKernel requires getStorageDirectory().");
    }

    this.getStorageDirectory = getStorageDirectory;
    this.now = now;
    this.createId = createId;
    this.leaseTtlMs = Math.max(5_000, Number(leaseTtlMs) || 90_000);
    this.onChange = typeof onChange === "function" ? onChange : () => {};
    this.state = null;
    this.lastSnapshotError = null;

    const file = (name) => path.join(this.getStorageDirectory(), name);
    this.journal = new PlatformEventJournal({
      getFilePath: () => file("platform-journal.jsonl"),
      now,
      createId,
      durable: durableJournal
    });
    this.snapshots = new PlatformSnapshotStore({
      getFilePath: () => file("platform-snapshot.json")
    });
    this.completionAuthority = completionAuthority ?? new CompletionAuthority({
      getKeyPath: () => file("completion-authority.key"),
      now
    });
  }

  ensureLoaded() {
    if (this.state) return this.state;

    const journalEvents = this.journal.list();
    const journalCursor = this.journal.cursor();
    const snapshot = this.snapshots.load();
    const snapshotUsable = snapshot &&
      Number(snapshot.lastSequence) <= journalCursor.sequence &&
      (
        Number(snapshot.lastSequence) === 0 ||
        journalEvents.find((event) => event.sequence === snapshot.lastSequence)
          ?.hash === snapshot.lastEventHash
      );

    this.state = snapshotUsable ? snapshot : createEmptyState();
    this.state.jobs = this.state.jobs && typeof this.state.jobs === "object"
      ? this.state.jobs
      : {};
    for (const event of journalEvents) {
      if (event.sequence > this.state.lastSequence) {
        this.applyEvent(event);
      }
    }
    for (const run of Object.values(this.state.runs)) {
      run.version = Math.max(2, Number(run.version) || 1);
      run.artifacts = Array.isArray(run.artifacts) ? run.artifacts : [];
      run.evidence = Array.isArray(run.evidence) ? run.evidence : [];
      run.reviews = Array.isArray(run.reviews) ? run.reviews : [];
      run.criteria = normalizeCriteria(run.criteria);
      run.failures = Array.isArray(run.failures) ? run.failures : [];
      run.replans = Array.isArray(run.replans) ? run.replans : [];
      run.integration = run.integration && typeof run.integration === "object"
        ? run.integration
        : null;
      run.logs = Array.isArray(run.logs) ? run.logs : [];
      run.taskGraphRevision = Math.max(0, Number(run.taskGraphRevision) || 0);
      run.taskGraphFingerprint = text(run.taskGraphFingerprint, 128);
      run.tasks = run.tasks && typeof run.tasks === "object" ? run.tasks : {};
      for (const [taskId, task] of Object.entries(run.tasks)) {
        run.tasks[taskId] = normalizeStoredTask({ ...task, id: taskId });
      }
      run.taskGraphFingerprint = fingerprintTaskGraph(run.tasks);
      run.agentRuns = run.agentRuns && typeof run.agentRuns === "object"
        ? run.agentRuns
        : {};
      for (const agent of Object.values(run.agentRuns)) {
        agent.kind = text(agent.kind, 40) || "worker";
        agent.leaseIds = Array.isArray(agent.leaseIds) ? agent.leaseIds : [];
      }
    }
    this.state.version = 4;
    this.state.jobs = this.state.jobs && typeof this.state.jobs === "object"
      ? this.state.jobs
      : {};
    for (const job of Object.values(this.state.jobs)) {
      job.budget = normalizeBudget(job.budget);
      job.logs = Array.isArray(job.logs) ? job.logs : [];
    }
    return this.state;
  }

  applyEvent(event) {
    const state = this.state;
    const payload = event.payload ?? {};
    const run = payload.runId ? state.runs[payload.runId] : null;

    switch (event.type) {
      case "RUN_CREATED":
        state.runs[payload.run.id] = clone(payload.run);
        break;
      case "RUN_STATUS_CHANGED":
        if (run) {
          run.status = payload.status;
          run.statusReason = text(payload.reason);
          run.updatedAt = event.timestamp;
        }
        break;
      case "RUN_CRITERIA_UPDATED":
        if (run) {
          run.criteria = clone(payload.criteria);
          run.updatedAt = event.timestamp;
        }
        break;
      case "TASK_GRAPH_ADDED":
        if (run) {
          for (const task of payload.tasks ?? []) {
            run.tasks[task.id] = clone(task);
          }
          run.taskGraphRevision += 1;
          run.taskGraphFingerprint = text(payload.fingerprint, 128);
          run.updatedAt = event.timestamp;
        }
        break;
      case "TASK_ADDED":
        if (run) {
          run.tasks[payload.task.id] = clone(payload.task);
          run.taskGraphRevision += 1;
          run.taskGraphFingerprint = fingerprintTaskGraph(run.tasks);
          run.updatedAt = event.timestamp;
        }
        break;
      case "TASK_STATUS_CHANGED":
        if (run?.tasks[payload.taskId]) {
          const task = run.tasks[payload.taskId];
          task.status = payload.status;
          task.statusReason = text(payload.reason);
          task.updatedAt = event.timestamp;
          if (payload.status === "running" && !task.startedAt) {
            task.startedAt = event.timestamp;
          }
          if (["completed", "failed", "cancelled"].includes(payload.status)) {
            task.endedAt = event.timestamp;
          }
          run.updatedAt = event.timestamp;
        }
        break;
      case "AGENT_RUN_STARTED":
        if (run) {
          run.agentRuns[payload.agentRun.id] = clone(payload.agentRun);
          if (run.tasks[payload.agentRun.taskId]) {
            const task = run.tasks[payload.agentRun.taskId];
            if (payload.agentRun.kind !== "evaluator") {
              task.attemptCount = Math.max(
                Number(task.attemptCount) || 0,
                Number(payload.agentRun.attempt) || 1
              );
              task.assignedAgentId = payload.agentRun.id;
            }
          }
          run.updatedAt = event.timestamp;
        }
        break;
      case "AGENT_RUN_FINISHED":
        if (run?.agentRuns[payload.agentRunId]) {
          const agent = run.agentRuns[payload.agentRunId];
          agent.status = payload.status;
          agent.outcome = text(payload.outcome, 120);
          agent.stopReason = text(payload.stopReason, 240);
          agent.error = text(payload.error, 500);
          agent.endedAt = event.timestamp;
          const task = run.tasks[agent.taskId];
          if (task?.assignedAgentId === agent.id) {
            task.assignedAgentId = null;
          }
          run.updatedAt = event.timestamp;
        }
        break;
      case "AGENT_WORKTREE_ATTACHED":
        if (run?.agentRuns[payload.agentRunId]) {
          run.agentRuns[payload.agentRunId].worktreeId = payload.worktreeId;
          run.updatedAt = event.timestamp;
        }
        break;
      case "TASK_CHECKPOINT_RECORDED":
        if (run?.tasks[payload.taskId]) {
          run.tasks[payload.taskId].checkpoint = clone(payload.checkpoint);
          run.updatedAt = event.timestamp;
        }
        break;
      case "AGENT_HANDOFF_RECORDED":
        if (run?.agentRuns[payload.agentRunId]) {
          const agent = run.agentRuns[payload.agentRunId];
          agent.handoff = clone(payload.handoff);
          const task = run.tasks[agent.taskId];
          if (task && payload.handoff?.version >= 2) {
            task.checkpoint = {
              commit: payload.handoff.outputCommit ?? null,
              baselineCommit: payload.handoff.baselineCommit ?? null,
              changed: payload.handoff.changed === true,
              fingerprint: payload.handoff.fingerprint ?? null,
              recordedAt: payload.handoff.recordedAt ?? event.timestamp
            };
            task.receipts = Array.isArray(payload.handoff.receipts)
              ? [...payload.handoff.receipts]
              : [];
          }
          run.updatedAt = event.timestamp;
        }
        break;
      case "TASK_EVALUATION_RECORDED":
        if (run?.tasks[payload.taskId]) {
          const task = run.tasks[payload.taskId];
          task.evaluation = clone(payload.evaluation);
          task.evaluationHistory = Array.isArray(task.evaluationHistory)
            ? task.evaluationHistory
            : [];
          task.evaluationHistory.push(clone(payload.evaluation));
          if (task.evaluationHistory.length > 20) {
            task.evaluationHistory.splice(0, task.evaluationHistory.length - 20);
          }
          task.integrationStatus = payload.evaluation.approved === true
            ? "eligible"
            : "blocked";
          run.updatedAt = event.timestamp;
        }
        break;
      case "ARTIFACT_RECORDED":
        if (run) {
          run.artifacts.push(clone(payload.artifact));
          run.updatedAt = event.timestamp;
        }
        break;
      case "EVIDENCE_BOUND":
        if (run) {
          run.evidence = Array.isArray(run.evidence) ? run.evidence : [];
          run.evidence.push(clone(payload.evidence));
          run.updatedAt = event.timestamp;
        }
        break;
      case "EVIDENCE_INVALIDATED":
        if (run) {
          const ids = new Set(payload.evidenceIds ?? []);
          for (const evidence of run.evidence) {
            if (ids.has(evidence.id) && evidence.status === "valid") {
              evidence.status = "invalid";
              evidence.invalidatedAt = event.timestamp;
              evidence.invalidationReason = text(payload.reason, 500);
            }
          }
          run.updatedAt = event.timestamp;
        }
        break;
      case "FAILURE_RECORDED":
        if (run) {
          run.failures = Array.isArray(run.failures) ? run.failures : [];
          run.failures.push(clone(payload.failure));
          run.updatedAt = event.timestamp;
        }
        break;
      case "REPLAN_RECORDED":
        if (run) {
          run.replans = Array.isArray(run.replans) ? run.replans : [];
          run.replans.push(clone(payload.replan));
          run.updatedAt = event.timestamp;
        }
        break;
      case "RUN_LOG_APPENDED":
        if (run) {
          run.logs = Array.isArray(run.logs) ? run.logs : [];
          run.logs.push(clone(payload.log));
          if (run.logs.length > 1000) run.logs.splice(0, run.logs.length - 1000);
          run.updatedAt = event.timestamp;
        }
        if (state.jobs[payload.jobId]) {
          const job = state.jobs[payload.jobId];
          job.logs = Array.isArray(job.logs) ? job.logs : [];
          job.logs.push(clone(payload.log));
          if (job.logs.length > 400) job.logs.splice(0, job.logs.length - 400);
          job.updatedAt = event.timestamp;
        }
        break;
      case "JOB_ENQUEUED":
        state.jobs[payload.job.id] = clone(payload.job);
        break;
      case "JOB_STATUS_CHANGED":
        if (state.jobs[payload.jobId]) {
          const job = state.jobs[payload.jobId];
          job.status = payload.status;
          job.statusReason = text(payload.reason, 500);
          job.resultSummary = text(payload.resultSummary, 2000);
          job.error = text(payload.error, 2000);
          job.updatedAt = event.timestamp;
          if (payload.status === "running") {
            job.startedAt = event.timestamp;
            job.endedAt = null;
            job.attempt = Math.max(0, Number(job.attempt) || 0) + 1;
          }
          if (["completed", "failed", "cancelled"].includes(payload.status)) {
            job.endedAt = event.timestamp;
          }
        }
        break;
      case "JOB_BUDGET_USED":
        if (state.jobs[payload.jobId]) {
          const job = state.jobs[payload.jobId];
          job.budget = normalizeBudget({
            ...job.budget,
            tokensUsed: nonNegative(job.budget?.tokensUsed) + nonNegative(payload.tokens),
            stepsUsed: nonNegative(job.budget?.stepsUsed) + nonNegative(payload.steps),
            elapsedMs: nonNegative(job.budget?.elapsedMs) + nonNegative(payload.elapsedMs)
          });
          job.updatedAt = event.timestamp;
        }
        break;
      case "INTEGRATION_RECORDED":
        if (run) {
          run.integration = clone(payload.integration);
          run.updatedAt = event.timestamp;
        }
        break;
      case "REVIEW_RECORDED":
        if (run) {
          run.reviews = Array.isArray(run.reviews) ? run.reviews : [];
          run.reviews.push(clone(payload.review));
          run.updatedAt = event.timestamp;
        }
        break;
      case "LEASE_ACQUIRED":
        state.leases[payload.lease.id] = clone(payload.lease);
        break;
      case "LEASE_RENEWED":
        if (state.leases[payload.leaseId]) {
          state.leases[payload.leaseId].expiresAt = payload.expiresAt;
          state.leases[payload.leaseId].updatedAt = event.timestamp;
        }
        break;
      case "LEASE_RELEASED":
      case "LEASE_EXPIRED":
        if (state.leases[payload.leaseId]) {
          state.leases[payload.leaseId].status =
            event.type === "LEASE_EXPIRED" ? "expired" : "released";
          state.leases[payload.leaseId].updatedAt = event.timestamp;
          state.leases[payload.leaseId].releasedAt = event.timestamp;
          state.leases[payload.leaseId].releaseReason = text(payload.reason);
        }
        break;
      case "COMPLETION_ISSUED":
        if (run) {
          run.completionPermit = clone(payload.permit);
          run.updatedAt = event.timestamp;
        }
        break;
      case "COMPLETION_INVALIDATED":
        if (run) {
          run.completionPermit = null;
          run.updatedAt = event.timestamp;
        }
        break;
      default:
        break;
    }

    state.lastSequence = event.sequence;
    state.lastEventHash = event.hash;
    state.updatedAt = event.timestamp;
  }

  commit(type, payload) {
    this.ensureLoaded();
    const event = this.journal.append(type, payload);
    this.applyEvent(event);
    try {
      this.snapshots.save(this.state);
      this.lastSnapshotError = null;
    } catch (error) {
      this.lastSnapshotError = error;
      console.warn("Platform snapshot write failed; Journal remains authoritative.", error);
    }
    try {
      this.onChange(this.getSnapshot());
    } catch (error) {
      console.warn("Platform state observer failed after commit.", error);
    }
    return event;
  }

  invalidateCompletionState(platformRunId, reason, {
    invalidateEvidence = true
  } = {}) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
    const evidenceIds = invalidateEvidence
      ? run.evidence.filter((item) => item.status === "valid").map((item) => item.id)
      : [];
    const hadPermit = Boolean(run.completionPermit);
    if (evidenceIds.length > 0) {
      this.commit("EVIDENCE_INVALIDATED", {
        runId: run.id,
        evidenceIds,
        reason: text(reason, 500)
      });
    }
    if (hadPermit) {
      this.commit("COMPLETION_INVALIDATED", {
        runId: run.id,
        reason: text(reason, 500)
      });
    }
    return { ok: true, evidenceIds, permitInvalidated: hadPermit };
  }

  recordFailure(platformRunId, failure = {}) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
    const fingerprint = sha256({
      type: failure.type,
      code: failure.code,
      stage: failure.stage,
      summary: failure.summary,
      conflicts: failure.conflicts ?? []
    });
    const existing = [...run.failures].reverse().find((item) =>
      item.fingerprint === fingerprint && !item.resolvedAt
    );
    if (existing) return { ok: true, created: false, failure: clone(existing) };
    const normalized = {
      version: 1,
      id: this.createId(),
      fingerprint,
      type: text(failure.type, 80) || "implementation",
      code: text(failure.code, 160) || "platform-failure",
      stage: text(failure.stage, 120) || "execution",
      summary: text(failure.summary, 2000),
      conflicts: (Array.isArray(failure.conflicts) ? failure.conflicts : [])
        .map((item) => text(item, 500)).filter(Boolean).slice(0, 100),
      retryable: failure.retryable === true,
      requiresUserInput: failure.requiresUserInput === true,
      action: text(failure.action, 120),
      recordedAt: this.now(),
      resolvedAt: null
    };
    this.commit("FAILURE_RECORDED", { runId: run.id, failure: normalized });
    return { ok: true, created: true, failure: clone(normalized) };
  }

  recordReplan(platformRunId, replan = {}) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
    this.invalidateCompletionState(run.id, "task-graph-replanned", {
      invalidateEvidence: true
    });
    const normalized = {
      version: 1,
      id: text(replan.id, 120) || this.createId(),
      failureId: text(replan.failureId, 120),
      agentRunId: text(replan.agentRunId, 120),
      classification: text(replan.classification, 80),
      action: text(replan.action, 120),
      addedTaskIds: (Array.isArray(replan.addedTaskIds) ? replan.addedTaskIds : [])
        .map((item) => text(item, 120)).filter(Boolean).slice(0, 40),
      summary: text(replan.summary, 2000),
      graphRevision: run.taskGraphRevision,
      recordedAt: this.now()
    };
    this.commit("REPLAN_RECORDED", { runId: run.id, replan: normalized });
    return { ok: true, replan: clone(normalized) };
  }

  bindEvidence(platformRunId, binding = {}) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
    const criterion = run.criteria.find((item) => item.id === text(binding.criterionId, 120));
    if (!criterion) return { ok: false, code: "platform-evidence-criterion-not-found" };
    const artifact = run.artifacts.find((item) => item.id === text(binding.artifactId, 120));
    if (!artifact) return { ok: false, code: "platform-evidence-artifact-not-found" };
    if (artifact.goalRevision !== run.goalRevision) {
      return { ok: false, code: "platform-evidence-goal-stale" };
    }
    if (artifact.taskGraphRevision !== run.taskGraphRevision) {
      return { ok: false, code: "platform-evidence-task-graph-stale" };
    }
    if (
      run.integration?.digest &&
      artifact.integrationDigest &&
      artifact.integrationDigest !== run.integration.digest
    ) {
      return { ok: false, code: "platform-evidence-integration-stale" };
    }
    const existing = run.evidence.find((item) =>
      item.status === "valid" &&
      item.criterionId === criterion.id &&
      item.artifactId === artifact.id &&
      item.integrationDigest === (run.integration?.digest ?? null)
    );
    if (existing) return { ok: true, created: false, evidence: clone(existing) };
    if (run.completionPermit) {
      this.commit("COMPLETION_INVALIDATED", {
        runId: run.id,
        reason: "evidence-set-changed"
      });
    }
    const evidence = {
      version: 1,
      id: text(binding.id, 120) || this.createId(),
      criterionId: criterion.id,
      artifactId: artifact.id,
      sourceAgentRunId: artifact.agentRunId ?? null,
      receiptIds: [...new Set([
        ...(artifact.receiptIds ?? []),
        ...(Array.isArray(binding.receiptIds) ? binding.receiptIds : [])
      ])].map((item) => text(item, 120)).filter(Boolean).slice(0, 80),
      commit: artifact.commit ?? run.integration?.commit ?? null,
      integrationDigest: run.integration?.digest ?? artifact.integrationDigest ?? null,
      artifactDigest: artifact.digest,
      goalRevision: run.goalRevision,
      taskGraphRevision: run.taskGraphRevision,
      status: "valid",
      recordedAt: this.now(),
      invalidatedAt: null,
      invalidationReason: ""
    };
    this.commit("EVIDENCE_BOUND", { runId: run.id, evidence });
    return { ok: true, created: true, evidence: clone(evidence) };
  }

  findReusableRun(goalId, goalRevision) {
    return Object.values(this.ensureLoaded().runs)
      .filter((run) =>
        run.goalId === goalId &&
        run.goalRevision === goalRevision &&
        !TERMINAL_RUN_STATUSES.has(run.status)
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
  }

  ensureRun({
    conversationId,
    goalId,
    goalRevision = 1,
    objective,
    criteria = [],
    workspaceId = null,
    mode = "chat"
  } = {}) {
    const normalizedGoalId = text(goalId, 120);
    const normalizedConversationId = text(conversationId, 120);
    if (!normalizedGoalId || !normalizedConversationId || !text(objective, 4000)) {
      return { ok: false, code: "platform-run-input-invalid" };
    }

    const revision = Math.max(1, Math.round(Number(goalRevision) || 1));
    const existing = this.findReusableRun(normalizedGoalId, revision);
    if (existing) {
      const normalizedCriteria = normalizeCriteria(criteria);
      if (sha256(existing.criteria ?? []) !== sha256(normalizedCriteria)) {
        this.invalidateCompletionState(existing.id, "goal-criteria-changed", {
          invalidateEvidence: true
        });
        this.commit("RUN_CRITERIA_UPDATED", {
          runId: existing.id,
          criteria: normalizedCriteria
        });
      }
      return { ok: true, created: false, run: clone(this.state.runs[existing.id]) };
    }

    const timestamp = this.now();
    const run = {
      version: 2,
      id: this.createId(),
      conversationId: normalizedConversationId,
      goalId: normalizedGoalId,
      goalRevision: revision,
      objective: text(objective, 4000),
      workspaceId: text(workspaceId, 120) || null,
      mode: mode === "coding" ? "coding" : "chat",
      status: "active",
      statusReason: "",
      taskGraphRevision: 0,
      taskGraphFingerprint: "",
      criteria: normalizeCriteria(criteria),
      tasks: {},
      agentRuns: {},
      artifacts: [],
      evidence: [],
      reviews: [],
      failures: [],
      replans: [],
      integration: null,
      completionPermit: null,
      logs: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.commit("RUN_CREATED", { run });
    return { ok: true, created: true, run: clone(run) };
  }

  addTaskGraph(platformRunId, tasks = []) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };

    const requested = Array.isArray(tasks) ? tasks : [];
    const existing = requested
      .map((task) => text(task?.taskId ?? task?.id, 120))
      .filter((id) => id && run.tasks[id]);
    if (existing.length === requested.length && requested.length > 0) {
      return {
        ok: true,
        created: false,
        tasks: existing.map((id) => clone(run.tasks[id]))
      };
    }
    if (existing.length > 0) {
      return {
        ok: false,
        code: "task-graph-partial-duplicate",
        taskIds: existing
      };
    }

    const validated = validateTaskGraph(run.tasks, requested, {
      createId: this.createId
    });
    if (!validated.ok) return validated;

    const timestamp = this.now();
    const normalizedTasks = validated.tasks.map((definition) => normalizeStoredTask({
      ...definition,
      version: 2,
      attemptCount: 0,
      status: definition.dependencies.every((dependencyId) =>
        run.tasks[dependencyId]?.status === "completed" ||
        validated.tasks.find((task) => task.id === dependencyId)?.status === "completed"
      )
        ? "ready"
        : "pending",
      statusReason: "",
      assignedAgentId: null,
      checkpoint: null,
      receipts: [],
      evaluation: {
        status: "pending",
        attempt: 0,
        approved: false,
        evaluatorAgentRunId: null,
        summary: "",
        findings: [],
        recordedAt: null
      },
      evaluationHistory: [],
      integrationStatus: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      endedAt: null
    }));

    // Candidate dependencies may point to another task in the same atomic batch.
    const candidateIds = new Set(normalizedTasks.map((task) => task.id));
    for (const task of normalizedTasks) {
      task.status = task.dependencies.length === 0 || task.dependencies.every((dependencyId) =>
        run.tasks[dependencyId]?.status === "completed" ||
        (!candidateIds.has(dependencyId) && run.tasks[dependencyId]?.status === "completed")
      )
        ? "ready"
        : "pending";
    }

    this.invalidateCompletionState(run.id, "task-graph-changed", {
      invalidateEvidence: true
    });
    const fingerprint = fingerprintTaskGraph([
      ...Object.values(run.tasks),
      ...normalizedTasks
    ]);
    this.commit("TASK_GRAPH_ADDED", {
      runId: run.id,
      tasks: normalizedTasks,
      fingerprint
    });
    return {
      ok: true,
      created: true,
      tasks: normalizedTasks.map((task) => clone(task)),
      fingerprint
    };
  }

  addTask(platformRunId, task = {}) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
    const id = text(task?.taskId ?? task?.id, 120);
    if (id && run.tasks[id]) {
      return { ok: true, created: false, task: clone(run.tasks[id]) };
    }
    const result = this.addTaskGraph(platformRunId, [task]);
    return result.ok
      ? {
          ok: true,
          created: result.created,
          task: clone(result.tasks[0]),
          fingerprint: result.fingerprint
        }
      : result;
  }

  setTaskStatus(platformRunId, taskId, status, reason = "") {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    const task = run?.tasks[text(taskId, 120)];
    if (!task) return { ok: false, code: "platform-task-not-found" };
    if (!TASK_STATUSES.has(status)) {
      return { ok: false, code: "platform-task-status-invalid" };
    }
    if (status === "running" && !taskDependenciesSettled(run, task)) {
      return { ok: false, code: "task-dependencies-unsettled" };
    }
    if (task.status === status) {
      return { ok: true, changed: false, task: clone(task) };
    }
    if (!TASK_TRANSITIONS[task.status]?.has(status)) {
      return {
        ok: false,
        code: "platform-task-transition-invalid",
        from: task.status,
        to: status
      };
    }

    this.commit("TASK_STATUS_CHANGED", {
      runId: run.id,
      taskId: task.id,
      status,
      reason: text(reason)
    });
    this.promoteReadyTasks(run.id);
    return { ok: true, changed: true, task: clone(run.tasks[task.id]) };
  }

  promoteReadyTasks(platformRunId) {
    const run = this.ensureLoaded().runs[platformRunId];
    if (!run) return;
    for (const task of Object.values(run.tasks)) {
      if (task.status === "pending" && taskDependenciesSettled(run, task)) {
        this.commit("TASK_STATUS_CHANGED", {
          runId: run.id,
          taskId: task.id,
          status: "ready",
          reason: "dependencies-completed"
        });
      }
    }
  }

  acquireLease({
    platformRunId,
    agentRunId,
    resourceKey,
    mode = "exclusive",
    ttlMs = this.leaseTtlMs
  } = {}) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
    const key = text(resourceKey, 500);
    if (!key) return { ok: false, code: "lease-resource-invalid" };

    this.expireLeases();
    const requestedMode = mode === "shared" ? "shared" : "exclusive";
    const conflicts = Object.values(this.state.leases).filter((lease) =>
      lease.status === "active" &&
      lease.resourceKey === key &&
      lease.agentRunId !== agentRunId &&
      (requestedMode === "exclusive" || lease.mode === "exclusive")
    );
    if (conflicts.length > 0) {
      return {
        ok: false,
        code: "resource-lease-conflict",
        conflicts: conflicts.map((lease) => lease.id)
      };
    }

    const timestamp = this.now();
    const lease = {
      version: 1,
      id: this.createId(),
      platformRunId: run.id,
      agentRunId: text(agentRunId, 120),
      resourceKey: key,
      mode: requestedMode,
      status: "active",
      acquiredAt: timestamp,
      updatedAt: timestamp,
      expiresAt: timestamp + Math.max(5_000, Number(ttlMs) || this.leaseTtlMs),
      releasedAt: null,
      releaseReason: ""
    };
    this.commit("LEASE_ACQUIRED", { lease });
    return { ok: true, lease: clone(lease) };
  }

  renewLease(leaseId, ttlMs = this.leaseTtlMs) {
    const lease = this.ensureLoaded().leases[text(leaseId, 120)];
    if (!lease || lease.status !== "active") {
      return { ok: false, code: "resource-lease-not-active" };
    }
    const expiresAt = this.now() + Math.max(5_000, Number(ttlMs) || this.leaseTtlMs);
    this.commit("LEASE_RENEWED", { leaseId: lease.id, expiresAt });
    return { ok: true, lease: clone(lease) };
  }

  releaseLease(leaseId, reason = "released") {
    const lease = this.ensureLoaded().leases[text(leaseId, 120)];
    if (!lease || lease.status !== "active") {
      return { ok: true, changed: false };
    }
    this.commit("LEASE_RELEASED", {
      leaseId: lease.id,
      reason: text(reason)
    });
    return { ok: true, changed: true };
  }

  expireLeases() {
    const now = this.now();
    const expired = Object.values(this.ensureLoaded().leases)
      .filter((lease) => lease.status === "active" && lease.expiresAt <= now);
    for (const lease of expired) {
      this.commit("LEASE_EXPIRED", {
        leaseId: lease.id,
        reason: "lease-timeout"
      });
    }
    return expired.map((lease) => lease.id);
  }

  beginAgentRun({
    platformRunId,
    agentRunId,
    taskId,
    role = "implementer",
    kind = "worker",
    workspaceResource = "",
    leaseIds: providedLeaseIds = [],
    modelSelection = null
  } = {}) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    const task = run?.tasks[text(taskId, 120)];
    if (!task) return { ok: false, code: "platform-task-not-found" };
    const id = text(agentRunId, 120) || this.createId();
    const normalizedKind = kind === "evaluator" ? "evaluator" : "worker";

    if (run.agentRuns[id]) {
      return { ok: true, created: false, agentRun: clone(run.agentRuns[id]) };
    }

    if (normalizedKind === "evaluator") {
      if (task.status !== "review") {
        return {
          ok: false,
          code: "platform-task-not-in-review",
          status: task.status
        };
      }
    } else {
      const taskStart = this.setTaskStatus(run.id, task.id, "running", "agent-started");
      if (!taskStart.ok) return taskStart;
    }

    const leaseIds = [];
    for (const leaseId of Array.isArray(providedLeaseIds) ? providedLeaseIds : []) {
      const lease = this.state.leases[text(leaseId, 120)];
      if (
        !lease ||
        lease.status !== "active" ||
        lease.platformRunId !== run.id ||
        lease.agentRunId !== id
      ) {
        if (normalizedKind !== "evaluator" && task.status === "running") {
          this.setTaskStatus(run.id, task.id, "blocked", "worker-lease-invalid");
        }
        return { ok: false, code: "worker-lease-invalid", leaseId };
      }
      leaseIds.push(lease.id);
    }

    if (text(workspaceResource, 500)) {
      const lease = this.acquireLease({
        platformRunId: run.id,
        agentRunId: id,
        resourceKey: workspaceResource,
        mode: run.mode === "coding" ? "exclusive" : "shared"
      });
      if (!lease.ok) {
        if (normalizedKind !== "evaluator") {
          this.setTaskStatus(run.id, task.id, "blocked", lease.code);
        }
        for (const leaseId of leaseIds) this.releaseLease(leaseId, "agent-start-failed");
        return lease;
      }
      leaseIds.push(lease.lease.id);
    }

    const timestamp = this.now();
    const attempt = normalizedKind === "evaluator"
      ? Math.max(1, (task.evaluationHistory?.length ?? 0) + 1)
      : Math.max(0, Number(task.attemptCount) || 0) + 1;
    const agentRun = {
      version: 2,
      id,
      taskId: task.id,
      role: text(role, 80) || "implementer",
      kind: normalizedKind,
      attempt,
      modelSelection: modelSelection && typeof modelSelection === "object"
        ? {
            providerId: text(modelSelection.providerId, 80),
            modelConfigId: text(modelSelection.modelConfigId, 120)
          }
        : null,
      worktreeId: null,
      handoff: null,
      status: "running",
      outcome: "",
      stopReason: "",
      error: "",
      leaseIds,
      startedAt: timestamp,
      endedAt: null
    };
    this.commit("AGENT_RUN_STARTED", { runId: run.id, agentRun });
    return { ok: true, created: true, agentRun: clone(agentRun) };
  }

  attachAgentWorktree(platformRunId, agentRunId, worktreeId) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    const agent = run?.agentRuns[text(agentRunId, 120)];
    if (!agent) return { ok: false, code: "platform-agent-run-not-found" };
    this.commit("AGENT_WORKTREE_ATTACHED", {
      runId: run.id,
      agentRunId: agent.id,
      worktreeId: text(worktreeId, 120)
    });
    return { ok: true, agentRun: clone(run.agentRuns[agent.id]) };
  }

  recordTaskCheckpoint(platformRunId, taskId, checkpoint = {}) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    const task = run?.tasks[text(taskId, 120)];
    if (!task) return { ok: false, code: "platform-task-not-found" };
    const normalized = {
      version: 1,
      agentRunId: text(checkpoint.agentRunId, 120) || null,
      commit: text(checkpoint.commit, 120) || null,
      baselineCommit: text(checkpoint.baselineCommit, 120) || null,
      changed: checkpoint.changed === true,
      fingerprint: sha256({
        taskId: task.id,
        agentRunId: text(checkpoint.agentRunId, 120) || null,
        commit: text(checkpoint.commit, 120) || null,
        baselineCommit: text(checkpoint.baselineCommit, 120) || null,
        changed: checkpoint.changed === true
      }),
      recordedAt: Math.max(0, Number(checkpoint.recordedAt) || this.now())
    };
    this.commit("TASK_CHECKPOINT_RECORDED", {
      runId: run.id,
      taskId: task.id,
      checkpoint: normalized
    });
    return { ok: true, checkpoint: clone(normalized) };
  }

  recordAgentHandoff(platformRunId, agentRunId, handoff = {}) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    const agent = run?.agentRuns[text(agentRunId, 120)];
    if (!agent) return { ok: false, code: "platform-agent-run-not-found" };
    const normalized = Number(handoff?.version) >= 2
      ? normalizeStructuredHandoff(handoff)
      : {
          version: 1,
          inputRevision: Math.max(0, Number(handoff.inputRevision) || run.taskGraphRevision),
          outputCommit: text(handoff.outputCommit, 120) || null,
          summary: text(handoff.summary, 2000),
          evidence: (Array.isArray(handoff.evidence) ? handoff.evidence : [])
            .slice(0, 40)
            .map((item) => text(item, 500))
            .filter(Boolean),
          unresolved: (Array.isArray(handoff.unresolved) ? handoff.unresolved : [])
            .slice(0, 20)
            .map((item) => text(item, 500))
            .filter(Boolean),
          recordedAt: this.now()
        };
    this.commit("AGENT_HANDOFF_RECORDED", {
      runId: run.id,
      agentRunId: agent.id,
      handoff: normalized
    });
    return { ok: true, handoff: clone(normalized) };
  }

  recordTaskEvaluation(platformRunId, taskId, evaluation = {}) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    const task = run?.tasks[text(taskId, 120)];
    if (!task) return { ok: false, code: "platform-task-not-found" };
    const normalized = {
      version: 1,
      status: evaluation.approved === true ? "approved" : "rejected",
      attempt: Math.max(1, Math.round(Number(evaluation.attempt) || 1)),
      approved: evaluation.approved === true,
      evaluatorAgentRunId: text(evaluation.evaluatorAgentRunId, 120) || null,
      workerAgentRunId: text(evaluation.workerAgentRunId, 120) || null,
      handoffFingerprint: text(evaluation.handoffFingerprint, 128),
      taskGraphRevision: Math.max(0, Number(evaluation.taskGraphRevision) || run.taskGraphRevision),
      summary: text(evaluation.summary, 2000),
      findings: (Array.isArray(evaluation.findings) ? evaluation.findings : [])
        .map((item) => text(item, 500)).filter(Boolean).slice(0, 40),
      evidence: (Array.isArray(evaluation.evidence) ? evaluation.evidence : [])
        .map((item) => text(item, 500)).filter(Boolean).slice(0, 60),
      criteria: (Array.isArray(evaluation.criteria) ? evaluation.criteria : [])
        .map((item) => ({
          criterionId: text(item?.criterionId ?? item?.id, 120),
          passed: item?.passed === true,
          evidence: (Array.isArray(item?.evidence) ? item.evidence : [])
            .map((value) => text(value, 500)).filter(Boolean).slice(0, 20),
          note: text(item?.note ?? item?.summary, 500)
        }))
        .filter((item) => item.criterionId)
        .slice(0, 32),
      recordedAt: Math.max(0, Number(evaluation.recordedAt) || this.now())
    };
    this.commit("TASK_EVALUATION_RECORDED", {
      runId: run.id,
      taskId: task.id,
      evaluation: normalized
    });
    return { ok: true, evaluation: clone(normalized) };
  }

  recordArtifact(platformRunId, artifact = {}) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
    if (artifact.changed === true) {
      this.invalidateCompletionState(run.id, "code-artifact-changed", {
        invalidateEvidence: true
      });
    } else {
      this.invalidateCompletionState(run.id, "artifact-manifest-changed", {
        invalidateEvidence: false
      });
    }
    const integrationDigest = text(
      artifact.integrationDigest ?? run.integration?.digest,
      160
    ) || null;
    const receiptIds = (Array.isArray(artifact.receiptIds) ? artifact.receiptIds : [])
      .map((value) => text(value, 120)).filter(Boolean).slice(0, 80);
    const normalized = {
      version: 2,
      id: text(artifact.id, 120) || this.createId(),
      taskId: text(artifact.taskId, 120) || null,
      agentRunId: text(artifact.agentRunId, 120) || null,
      kind: text(artifact.kind, 80) || "worker-output",
      commit: text(artifact.commit, 120) || null,
      digest: text(artifact.digest, 160) || sha256({
        kind: artifact.kind,
        commit: artifact.commit,
        receiptIds,
        integrationDigest,
        summary: artifact.summary
      }),
      summary: text(artifact.summary, 1000),
      source: text(artifact.source, 120) || "platform",
      changed: artifact.changed === true,
      receiptIds,
      integrationDigest,
      goalRevision: run.goalRevision,
      taskGraphRevision: run.taskGraphRevision,
      inputCommits: (Array.isArray(artifact.inputCommits)
        ? artifact.inputCommits
        : [])
        .slice(0, 40)
        .map((value) => text(value, 120))
        .filter(Boolean),
      createdAt: this.now()
    };
    this.commit("ARTIFACT_RECORDED", { runId: run.id, artifact: normalized });
    return { ok: true, artifact: clone(normalized) };
  }

  appendRunLog(platformRunId, {
    jobId = null,
    level = "info",
    source = "platform",
    message = "",
    details = null
  } = {}) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
    const normalizedLevel = new Set(["debug", "info", "warn", "error"])
      .has(level) ? level : "info";
    const log = {
      version: 1,
      id: this.createId(),
      level: normalizedLevel,
      source: text(source, 120) || "platform",
      message: text(message, 2000),
      details: details && typeof details === "object" ? clone(details) : null,
      timestamp: this.now()
    };
    this.commit("RUN_LOG_APPENDED", {
      runId: run.id,
      jobId: text(jobId, 120) || null,
      log
    });
    return { ok: true, log: clone(log) };
  }

  enqueueJob(platformRunId, {
    type,
    title,
    payload = {},
    priority = 0,
    maxAttempts = 2,
    budget = {}
  } = {}) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
    const normalizedType = text(type, 120);
    if (!normalizedType) return { ok: false, code: "platform-job-type-invalid" };
    const timestamp = this.now();
    const job = {
      version: 1,
      id: this.createId(),
      platformRunId: run.id,
      type: normalizedType,
      title: text(title, 500) || normalizedType,
      payload: payload && typeof payload === "object" ? clone(payload) : {},
      status: "queued",
      statusReason: "",
      priority: Math.max(-100, Math.min(100, Math.round(Number(priority) || 0))),
      attempt: 0,
      maxAttempts: Math.max(1, Math.min(10, Math.round(Number(maxAttempts) || 2))),
      budget: normalizeBudget(budget),
      resultSummary: "",
      error: "",
      logs: [],
      createdAt: timestamp,
      startedAt: null,
      endedAt: null,
      updatedAt: timestamp
    };
    this.commit("JOB_ENQUEUED", { job });
    this.appendRunLog(run.id, {
      jobId: job.id,
      source: "queue",
      message: `已加入后台队列：${job.title}`
    });
    return { ok: true, job: clone(job) };
  }

  setJobStatus(jobId, status, {
    reason = "",
    resultSummary = "",
    error = ""
  } = {}) {
    const job = this.ensureLoaded().jobs[text(jobId, 120)];
    if (!job) return { ok: false, code: "platform-job-not-found" };
    if (!JOB_STATUSES.has(status)) {
      return { ok: false, code: "platform-job-status-invalid" };
    }
    if (job.status === status) {
      return { ok: true, changed: false, job: clone(job) };
    }
    if (!JOB_TRANSITIONS[job.status]?.has(status)) {
      return {
        ok: false,
        code: "platform-job-transition-invalid",
        from: job.status,
        to: status
      };
    }
    this.commit("JOB_STATUS_CHANGED", {
      jobId: job.id,
      status,
      reason,
      resultSummary,
      error
    });
    return { ok: true, changed: true, job: clone(this.state.jobs[job.id]) };
  }

  recordJobUsage(jobId, usage = {}) {
    const job = this.ensureLoaded().jobs[text(jobId, 120)];
    if (!job) return { ok: false, code: "platform-job-not-found" };
    this.commit("JOB_BUDGET_USED", {
      jobId: job.id,
      tokens: nonNegative(usage.tokens),
      steps: nonNegative(usage.steps),
      elapsedMs: nonNegative(usage.elapsedMs)
    });
    const current = this.state.jobs[job.id];
    const exceeded = [];
    if (current.budget.tokenLimit > 0 && current.budget.tokensUsed > current.budget.tokenLimit) {
      exceeded.push("tokens");
    }
    if (current.budget.stepLimit > 0 && current.budget.stepsUsed > current.budget.stepLimit) {
      exceeded.push("steps");
    }
    if (current.budget.timeLimitMs > 0 && current.budget.elapsedMs > current.budget.timeLimitMs) {
      exceeded.push("time");
    }
    return { ok: exceeded.length === 0, exceeded, job: clone(current) };
  }

  getJob(jobId) {
    const job = this.ensureLoaded().jobs[text(jobId, 120)];
    return job ? clone(job) : null;
  }

  listJobs({ platformRunId = "", statuses = [] } = {}) {
    const runId = text(platformRunId, 120);
    const allowedStatuses = new Set(
      (Array.isArray(statuses) ? statuses : []).filter((status) => JOB_STATUSES.has(status))
    );
    return Object.values(this.ensureLoaded().jobs)
      .filter((job) => !runId || job.platformRunId === runId)
      .filter((job) => allowedStatuses.size === 0 || allowedStatuses.has(job.status))
      .sort((left, right) =>
        right.priority - left.priority || left.createdAt - right.createdAt
      )
      .map(clone);
  }

  recoverInterruptedJobs() {
    const recoveredJobIds = [];
    for (const job of this.listJobs()) {
      if (job.status !== "running") continue;
      this.setJobStatus(job.id, "queued", {
        reason: "application-restart"
      });
      recoveredJobIds.push(job.id);
      this.appendRunLog(job.platformRunId, {
        jobId: job.id,
        level: "warn",
        source: "recovery",
        message: "应用重启后已将中断任务放回队列。"
      });
    }
    return { ok: true, recoveredJobIds };
  }

  recordIntegration(platformRunId, integration = {}) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
    const allowed = new Set([
      "pending",
      "running",
      "integrated",
      "published",
      "conflicted",
      "failed",
      "not-required"
    ]);
    const status = allowed.has(integration.status)
      ? integration.status
      : "failed";
    const normalized = {
      version: 1,
      status,
      taskId: text(integration.taskId, 120) || null,
      agentRunId: text(integration.agentRunId, 120) || null,
      worktreeId: text(integration.worktreeId, 120) || null,
      baselineCommit: text(integration.baselineCommit, 120) || null,
      commit: text(integration.commit, 120) || null,
      artifactIds: (Array.isArray(integration.artifactIds)
        ? integration.artifactIds
        : [])
        .slice(0, 80)
        .map((value) => text(value, 120))
        .filter(Boolean),
      inputCommits: (Array.isArray(integration.inputCommits)
        ? integration.inputCommits
        : [])
        .slice(0, 80)
        .map((value) => text(value, 120))
        .filter(Boolean),
      conflicts: (Array.isArray(integration.conflicts)
        ? integration.conflicts
        : [])
        .slice(0, 100)
        .map((value) => text(value, 500))
        .filter(Boolean),
      error: text(integration.error, 2000),
      digest: text(integration.digest, 160) || null,
      recordedAt: this.now()
    };
    const previousBinding = sha256({
      status: run.integration?.status ?? null,
      commit: run.integration?.commit ?? null,
      digest: run.integration?.digest ?? null,
      artifactIds: run.integration?.artifactIds ?? []
    });
    const nextBinding = sha256({
      status: normalized.status,
      commit: normalized.commit,
      digest: normalized.digest,
      artifactIds: normalized.artifactIds
    });
    if (previousBinding !== nextBinding) {
      this.invalidateCompletionState(run.id, "integration-result-changed", {
        invalidateEvidence: true
      });
    }
    this.commit("INTEGRATION_RECORDED", {
      runId: run.id,
      integration: normalized
    });
    return { ok: true, integration: clone(normalized) };
  }

  recordReview(platformRunId, review = {}) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
    this.invalidateCompletionState(run.id, "review-result-changed", {
      invalidateEvidence: false
    });
    const normalized = {
      version: 1,
      id: text(review.id, 120) || this.createId(),
      taskId: text(review.taskId, 120) || null,
      agentRunId: text(review.agentRunId, 120) || null,
      artifactId: text(review.artifactId, 120) || null,
      integrationCommit: text(review.integrationCommit, 120) || null,
      integrationDigest: text(review.integrationDigest, 160) || null,
      status: review.approved === true ? "approved" : "rejected",
      approved: review.approved === true,
      summary: text(review.summary, 2000),
      findings: (Array.isArray(review.findings) ? review.findings : [])
        .slice(0, 80)
        .map((value) => text(value, 1000))
        .filter(Boolean),
      evidence: (Array.isArray(review.evidence) ? review.evidence : [])
        .slice(0, 80)
        .map((value) => text(value, 1000))
        .filter(Boolean),
      reviewerVersion: Math.max(1, Number(review.reviewerVersion) || 1),
      recordedAt: this.now()
    };
    this.commit("REVIEW_RECORDED", { runId: run.id, review: normalized });
    return { ok: true, review: clone(normalized) };
  }

  ensureCriterionEvidence(run, verification, records = [], agentRunId = null) {
    if ((run.criteria ?? []).length === 0) {
      return { ok: true, evidence: [] };
    }
    const checks = new Map(
      (Array.isArray(verification?.checks) ? verification.checks : [])
        .filter((item) => item?.criterionId)
        .map((item) => [text(item.criterionId, 120), item])
    );
    const runtimeRecords = Array.isArray(records) ? records : [];
    const missing = [];

    for (const criterion of run.criteria) {
      const check = checks.get(criterion.id);
      if (!check || check.passed !== true) {
        missing.push(criterion.id);
        continue;
      }
      const references = (Array.isArray(check.evidence) ? check.evidence : [])
        .map((value) => text(value, 240)).filter(Boolean);
      const candidateIds = new Set();
      for (const reference of references) {
        for (const artifact of this.state.runs[run.id].artifacts) {
          if (
            artifact.id === reference ||
            artifact.commit === reference ||
            artifact.receiptIds?.includes(reference)
          ) {
            candidateIds.add(artifact.id);
          }
        }
        const record = runtimeRecords.find((item) =>
          item?.status === "completed" &&
          (text(item.id, 120) === reference || text(item.name, 120) === reference)
        );
        if (record) {
          const artifact = this.recordArtifact(run.id, {
            taskId: this.state.runs[run.id].agentRuns[agentRunId]?.taskId ?? null,
            agentRunId,
            kind: "tool-receipt",
            commit: run.integration?.commit ?? null,
            integrationDigest: run.integration?.digest ?? null,
            receiptIds: [text(record.id, 120) || text(record.name, 120)],
            digest: sha256({
              id: record.id,
              name: record.name,
              status: record.status,
              input: record.input ?? null,
              output: record.result ?? record.output ?? null
            }),
            summary: `${text(record.name, 120)}: ${text(record.status, 40)}`,
            source: "tool-runtime"
          }).artifact;
          candidateIds.add(artifact.id);
        }
      }

      if (candidateIds.size === 0 && criterion.verificationKind === "change") {
        const publication = [...this.state.runs[run.id].artifacts].reverse().find((artifact) =>
          ["workspace-publication", "integration-result", "git-commit"].includes(artifact.kind) &&
          artifact.changed === true &&
          (!run.integration?.digest || artifact.integrationDigest === run.integration.digest)
        );
        if (publication) candidateIds.add(publication.id);
      }
      if (candidateIds.size === 0 && references.includes("user-confirmed")) {
        const artifact = this.recordArtifact(run.id, {
          agentRunId: null,
          kind: "user-confirmation",
          commit: run.integration?.commit ?? null,
          integrationDigest: run.integration?.digest ?? null,
          receiptIds: ["user-confirmed"],
          digest: sha256({
            goalId: run.goalId,
            goalRevision: run.goalRevision,
            criterionId: criterion.id,
            confirmation: true
          }),
          summary: `用户确认完成标准：${criterion.text}`,
          source: "user"
        }).artifact;
        candidateIds.add(artifact.id);
      }

      for (const artifactId of candidateIds) {
        const bound = this.bindEvidence(run.id, {
          criterionId: criterion.id,
          artifactId
        });
        if (!bound.ok) continue;
      }
      const latest = this.state.runs[run.id];
      const valid = latest.evidence.some((item) =>
        item.status === "valid" &&
        item.criterionId === criterion.id &&
        item.goalRevision === latest.goalRevision &&
        item.taskGraphRevision === latest.taskGraphRevision &&
        item.integrationDigest === (latest.integration?.digest ?? null)
      );
      if (!valid) missing.push(criterion.id);
    }
    return {
      ok: missing.length === 0,
      code: missing.length === 0 ? null : "platform-criterion-evidence-required",
      missingCriterionIds: missing,
      evidence: this.state.runs[run.id].evidence.filter((item) => item.status === "valid")
    };
  }

  completionBinding(run) {
    const validEvidence = (run.evidence ?? []).filter((item) =>
      item.status === "valid" &&
      item.goalRevision === run.goalRevision &&
      item.taskGraphRevision === run.taskGraphRevision &&
      item.integrationDigest === (run.integration?.digest ?? null)
    );
    const artifacts = (run.artifacts ?? []).map((artifact) => ({
      id: artifact.id,
      digest: artifact.digest,
      commit: artifact.commit,
      integrationDigest: artifact.integrationDigest,
      receiptIds: artifact.receiptIds ?? [],
      goalRevision: artifact.goalRevision,
      taskGraphRevision: artifact.taskGraphRevision
    }));
    const changedWorkerArtifacts = run.artifacts.filter((artifact) => {
      const owner = run.agentRuns[artifact.agentRunId];
      const task = run.tasks[artifact.taskId];
      return artifact.kind === "git-commit" &&
        artifact.changed === true &&
        owner?.role === "implementer" &&
        owner.status === "completed" &&
        task?.evaluation?.approved === true &&
        task.evaluation.workerAgentRunId === owner.id &&
        task.evaluation.handoffFingerprint === owner.handoff?.fingerprint;
    });
    const integrationHash = changedWorkerArtifacts.length > 0
      ? run.integration?.digest
      : sha256({
          scope: "platform-kernel-runtime-result",
          runId: run.id,
          workspaceId: run.workspaceId,
          artifacts
        });
    const latestReview = [...(run.reviews ?? [])].reverse().find((review) =>
      review.approved === true &&
      review.integrationCommit === run.integration?.commit &&
      review.integrationDigest === run.integration?.digest
    ) ?? null;
    return {
      integrationHash,
      evidenceHash: sha256({
        criteria: run.criteria,
        evidence: validEvidence
      }),
      artifactManifestHash: sha256(artifacts),
      taskGraphHash: sha256({
        revision: run.taskGraphRevision,
        fingerprint: run.taskGraphFingerprint,
        tasks: Object.values(run.tasks).map((task) => ({
          schemaVersion: task.schemaVersion ?? task.version ?? 1,
          id: task.id,
          parentTaskId: task.parentTaskId ?? null,
          objective: task.objective ?? task.title,
          role: task.role,
          dependencies: task.dependencies,
          acceptanceCriteria: task.acceptanceCriteria ?? [],
          requiredCapabilities: task.requiredCapabilities ?? [],
          workspaceScope: task.workspaceScope ?? null,
          resourceLocks: task.resourceLocks ?? [],
          priority: task.priority ?? 50,
          status: task.status,
          attemptCount: task.attemptCount,
          checkpointFingerprint: task.checkpoint?.fingerprint ?? null,
          evaluation: task.evaluation
            ? {
                approved: task.evaluation.approved === true,
                evaluatorAgentRunId: task.evaluation.evaluatorAgentRunId ?? null,
                workerAgentRunId: task.evaluation.workerAgentRunId ?? null,
                handoffFingerprint: task.evaluation.handoffFingerprint ?? null,
                recordedAt: task.evaluation.recordedAt ?? null
              }
            : null,
          integrationStatus: task.integrationStatus ?? "pending"
        }))
      }),
      reviewHash: sha256(latestReview),
      validEvidence,
      latestReview
    };
  }

  finishAgentRun(platformRunId, agentRunId, {
    status = "completed",
    outcome = "",
    stopReason = "",
    error = "",
    taskStatus = null
  } = {}) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    const agent = run?.agentRuns[text(agentRunId, 120)];
    if (!agent) return { ok: false, code: "platform-agent-run-not-found" };
    if (agent.status !== "running") {
      return { ok: true, changed: false, agentRun: clone(agent) };
    }
    const normalizedStatus = AGENT_STATUSES.has(status) ? status : "failed";
    this.commit("AGENT_RUN_FINISHED", {
      runId: run.id,
      agentRunId: agent.id,
      status: normalizedStatus,
      outcome,
      stopReason,
      error
    });
    for (const leaseId of agent.leaseIds) {
      this.releaseLease(leaseId, `agent-${normalizedStatus}`);
    }
    const nextTaskStatus = taskStatus ?? (
      normalizedStatus === "completed" ? "continuable" :
        normalizedStatus === "cancelled" ? "cancelled" :
          normalizedStatus === "interrupted" ? "continuable" : "failed"
    );
    this.setTaskStatus(run.id, agent.taskId, nextTaskStatus, stopReason || outcome);
    return { ok: true, changed: true, agentRun: clone(run.agentRuns[agent.id]) };
  }

  authorizeCompletion({
    platformRunId,
    agentRunId,
    verification,
    records = []
  } = {}) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    const agent = run?.agentRuns[text(agentRunId, 120)];
    if (!run || !agent) {
      return { ok: false, code: "platform-completion-run-not-found" };
    }
    if (verification?.verified !== true || verification?.status !== "verified") {
      return { ok: false, code: "platform-completion-unverified" };
    }
    if (!["running", "completed"].includes(agent.status)) {
      return { ok: false, code: "platform-completion-agent-invalid" };
    }

    const changedWorkerArtifacts = run.artifacts.filter((artifact) => {
      const owner = run.agentRuns[artifact.agentRunId];
      return artifact.kind === "git-commit" &&
        artifact.changed === true &&
        owner?.role === "implementer" &&
        owner.status === "completed" &&
        owner.id !== agent.id;
    });
    if (changedWorkerArtifacts.length > 0) {
      const unevaluatedTaskIds = [...new Set(changedWorkerArtifacts
        .filter((artifact) => {
          const task = run.tasks[artifact.taskId];
          const worker = run.agentRuns[artifact.agentRunId];
          return !task ||
            task.evaluation?.approved !== true ||
            task.integrationStatus !== "eligible" ||
            task.evaluation?.workerAgentRunId !== worker?.id ||
            task.evaluation?.handoffFingerprint !== worker?.handoff?.fingerprint;
        })
        .map((artifact) => artifact.taskId))];
      if (unevaluatedTaskIds.length > 0) {
        return {
          ok: false,
          code: "platform-task-evaluation-required",
          taskIds: unevaluatedTaskIds
        };
      }
      if (
        !["integrated", "published"].includes(run.integration?.status) ||
        !run.integration.commit ||
        !run.integration.digest
      ) {
        return {
          ok: false,
          code: "platform-integration-required",
          artifactIds: changedWorkerArtifacts.map((item) => item.id)
        };
      }
      const review = [...run.reviews].reverse().find((item) =>
        item.approved === true &&
        item.integrationCommit === run.integration.commit &&
        item.integrationDigest === run.integration.digest
      );
      const reviewer = review
        ? run.agentRuns[review.agentRunId]
        : null;
      const reviewArtifact = review
        ? run.artifacts.find((item) => item.id === review.artifactId)
        : null;
      if (
        !review ||
        reviewer?.role !== "reviewer" ||
        reviewArtifact?.kind !== "independent-review" ||
        reviewArtifact?.agentRunId !== review.agentRunId ||
        reviewArtifact?.integrationDigest !== run.integration.digest ||
        changedWorkerArtifacts.some((item) => item.agentRunId === review.agentRunId)
      ) {
        return {
          ok: false,
          code: "platform-independent-review-required"
        };
      }
      if (run.integration.status !== "published") {
        return {
          ok: false,
          code: "platform-integration-publication-required"
        };
      }
    }

    const criterionEvidence = this.ensureCriterionEvidence(
      run,
      verification,
      records,
      agent.id
    );
    if (!criterionEvidence.ok) {
      return {
        ok: false,
        code: criterionEvidence.code,
        criterionIds: criterionEvidence.missingCriterionIds
      };
    }

    if (agent.status === "running") {
      this.finishAgentRun(run.id, agent.id, {
        status: "completed",
        outcome: "verified",
        stopReason: "goal-verified",
        taskStatus: "completed"
      });
    } else {
      this.setTaskStatus(run.id, agent.taskId, "completed", "goal-verified");
    }

    const unsettled = Object.values(run.tasks)
      .filter((task) => task.status !== "completed");
    if (unsettled.length > 0) {
      return {
        ok: false,
        code: "platform-completion-tasks-unsettled",
        taskIds: unsettled.map((task) => task.id)
      };
    }

    const binding = this.completionBinding(run);
    const permit = this.completionAuthority.issue({
      goalId: run.goalId,
      goalRevision: run.goalRevision,
      platformRunId: run.id,
      integrationHash: binding.integrationHash,
      evidenceHash: binding.evidenceHash,
      artifactManifestHash: binding.artifactManifestHash,
      taskGraphHash: binding.taskGraphHash,
      reviewHash: binding.reviewHash,
      verifierVersion: verification.version ?? 1
    });
    this.commit("COMPLETION_ISSUED", { runId: run.id, permit });
    const platformVerification = clone(verification);
    platformVerification.checks = (platformVerification.checks ?? []).map((check) => {
      if (!check.criterionId) return check;
      return {
        ...check,
        evidence: binding.validEvidence
          .filter((item) => item.criterionId === check.criterionId)
          .map((item) => item.artifactId)
      };
    });
    return {
      ok: true,
      permit: clone(permit),
      verification: platformVerification,
      evidence: clone(binding.validEvidence)
    };
  }

  verifyCompletionPermit(permit, expected = {}) {
    const verified = this.completionAuthority.verify(permit, expected);
    if (!verified.ok) return verified;
    const run = this.ensureLoaded().runs[text(expected.platformRunId, 120)];
    if (!run) return { ok: false, code: "completion-signature-run-missing" };
    if (run.completionPermit?.signature !== permit?.signature) {
      return { ok: false, code: "completion-signature-superseded" };
    }
    const binding = this.completionBinding(run);
    const payload = permit.payload;
    if (
      payload.integrationHash !== binding.integrationHash ||
      payload.evidenceHash !== binding.evidenceHash ||
      payload.artifactManifestHash !== binding.artifactManifestHash ||
      payload.taskGraphHash !== binding.taskGraphHash ||
      payload.reviewHash !== binding.reviewHash
    ) {
      return { ok: false, code: "completion-signature-stale" };
    }
    return verified;
  }

  setRunStatus(platformRunId, status, reason = "") {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
    const allowed = new Set([
      "active",
      "paused",
      "continuable",
      "blocked",
      "failed",
      "cancelled",
      "completed"
    ]);
    if (!allowed.has(status)) {
      return { ok: false, code: "platform-run-status-invalid" };
    }
    if (status === "completed") {
      if (!run.completionPermit) {
        return { ok: false, code: "platform-completion-permit-missing" };
      }
      const verified = this.verifyCompletionPermit(run.completionPermit, {
        goalId: run.goalId,
        goalRevision: run.goalRevision,
        platformRunId: run.id
      });
      if (!verified.ok) return verified;
    }
    if (run.status === status) {
      return { ok: true, changed: false, run: clone(run) };
    }
    if (!RUN_TRANSITIONS[run.status]?.has(status)) {
      return {
        ok: false,
        code: "platform-run-transition-invalid",
        from: run.status,
        to: status
      };
    }
    this.commit("RUN_STATUS_CHANGED", {
      runId: run.id,
      status,
      reason
    });
    return { ok: true, changed: true, run: clone(run) };
  }

  recoverInterruptedRuns() {
    this.ensureLoaded();
    const expiredLeaseIds = this.expireLeases();
    const recoveredAgentRunIds = [];
    const recoveredTaskIds = [];
    const recoveredRunIds = [];

    for (const run of Object.values(this.state.runs)) {
      if (TERMINAL_RUN_STATUSES.has(run.status)) continue;
      let recoveredThisRun = false;
      for (const agent of Object.values(run.agentRuns)) {
        if (agent.status !== "running") continue;
        this.finishAgentRun(run.id, agent.id, {
          status: "interrupted",
          outcome: "continuable",
          stopReason: "application-restart",
          taskStatus: "continuable"
        });
        recoveredAgentRunIds.push(agent.id);
        recoveredTaskIds.push(agent.taskId);
        recoveredThisRun = true;
      }
      for (const task of Object.values(run.tasks)) {
        if (task.status === "running") {
          this.setTaskStatus(
            run.id,
            task.id,
            "continuable",
            "orphaned-running-task"
          );
          recoveredTaskIds.push(task.id);
          recoveredThisRun = true;
          continue;
        }
        if (task.status === "review") {
          const evaluatorRunning = Object.values(run.agentRuns).some((agent) =>
            agent.taskId === task.id &&
            agent.kind === "evaluator" &&
            agent.status === "running"
          );
          if (!evaluatorRunning) {
            this.setTaskStatus(
              run.id,
              task.id,
              "continuable",
              "orphaned-review-task"
            );
            recoveredTaskIds.push(task.id);
            recoveredThisRun = true;
          }
        }
      }
      for (const lease of Object.values(this.state.leases)) {
        if (
          lease.platformRunId === run.id &&
          lease.status === "active" &&
          run.agentRuns[lease.agentRunId]?.status !== "running"
        ) {
          this.releaseLease(lease.id, "orphaned-agent-run");
        }
      }
      if (run.status === "active" && recoveredThisRun) {
        this.setRunStatus(run.id, "continuable", "application-restart");
        recoveredRunIds.push(run.id);
      }
      if (run.integration?.status === "running") {
        this.recordIntegration(run.id, {
          ...run.integration,
          status: "failed",
          error: "application-restart"
        });
      }
    }

    return {
      ok: true,
      expiredLeaseIds,
      recoveredAgentRunIds,
      recoveredTaskIds,
      recoveredRunIds,
      journal: clone(this.journal.loadReport),
      snapshotRecovered: this.lastSnapshotError === null
    };
  }

  prepareExecution({
    conversationId,
    goal,
    agentRunId,
    taskId,
    workspaceId = null,
    workspaceResource = "",
    mode = "chat"
  } = {}) {
    const ensured = this.ensureRun({
      conversationId,
      goalId: goal?.id,
      goalRevision: goal?.revision ?? 1,
      objective: goal?.objective,
      criteria: goal?.criteria ?? [],
      workspaceId,
      mode
    });
    if (!ensured.ok) return ensured;

    if (ensured.run.status !== "active") {
      const activated = this.setRunStatus(
        ensured.run.id,
        "active",
        "execution-started"
      );
      if (!activated.ok) return activated;
    }

    const task = this.addTask(ensured.run.id, {
      taskId,
      title: goal?.objective,
      role: "implementer"
    });
    if (!task.ok) return task;

    const agent = this.beginAgentRun({
      platformRunId: ensured.run.id,
      agentRunId,
      taskId: task.task.id,
      role: "implementer",
      workspaceResource
    });
    if (!agent.ok) return agent;

    return {
      ok: true,
      platformRunId: ensured.run.id,
      taskId: task.task.id,
      agentRunId: agent.agentRun.id,
      leaseIds: [...agent.agentRun.leaseIds]
    };
  }

  getRun(platformRunId) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    if (!run) return null;
    const output = clone(run);
    if (output.completionPermit) {
      output.completionPermit = {
        payload: clone(output.completionPermit.payload),
        fingerprint: output.completionPermit.fingerprint
      };
    }
    return output;
  }

  getSnapshot() {
    this.expireLeases();
    const state = this.ensureLoaded();
    const activeLeases = Object.values(state.leases)
      .filter((lease) => lease.status === "active")
      .map((lease) => ({
        id: lease.id,
        platformRunId: lease.platformRunId,
        resourceKey: lease.resourceKey,
        mode: lease.mode,
        expiresAt: lease.expiresAt
      }));
    return {
      version: state.version,
      revision: state.lastSequence,
      runs: Object.values(state.runs)
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map(summarizeRun),
      jobs: Object.values(state.jobs)
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map(summarizeJob),
      activeLeases,
      recovery: {
        loaded: this.journal.loadReport?.loaded ?? 0,
        ignoredTrailingLines:
          this.journal.loadReport?.ignoredTrailingLines ?? 0,
        integrityFailureAt:
          this.journal.loadReport?.integrityFailureAt ?? null,
        repairedTail: this.journal.loadReport?.repairedTail === true
      },
      persistence: {
        journalAuthoritative: true,
        snapshotHealthy: this.lastSnapshotError === null
      }
    };
  }
}
