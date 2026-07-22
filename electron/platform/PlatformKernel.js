import crypto from "node:crypto";
import path from "node:path";

import {
  clone,
  sha256
} from "./canonical.js";

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
    version: 2,
    lastSequence: 0,
    lastEventHash: "",
    runs: {},
    jobs: {},
    leases: {},
    updatedAt: 0
  };
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

function detectCycle(tasks, candidate) {
  const graph = {
    ...tasks,
    [candidate.id]: candidate
  };
  const visiting = new Set();
  const visited = new Set();

  const visit = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const task = graph[id];
    for (const dependencyId of task?.dependencies ?? []) {
      if (graph[dependencyId] && visit(dependencyId)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  return Object.keys(graph).some(visit);
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
      run.artifacts = Array.isArray(run.artifacts) ? run.artifacts : [];
      run.evidence = Array.isArray(run.evidence) ? run.evidence : [];
      run.reviews = Array.isArray(run.reviews) ? run.reviews : [];
      run.integration = run.integration && typeof run.integration === "object"
        ? run.integration
        : null;
      run.logs = Array.isArray(run.logs) ? run.logs : [];
    }
    this.state.version = 2;
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
      case "TASK_ADDED":
        if (run) {
          run.tasks[payload.task.id] = clone(payload.task);
          run.taskGraphRevision += 1;
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
            run.tasks[payload.agentRun.taskId].attemptCount =
              Math.max(
                Number(run.tasks[payload.agentRun.taskId].attemptCount) || 0,
                Number(payload.agentRun.attempt) || 1
              );
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
          run.updatedAt = event.timestamp;
        }
        break;
      case "AGENT_WORKTREE_ATTACHED":
        if (run?.agentRuns[payload.agentRunId]) {
          run.agentRuns[payload.agentRunId].worktreeId = payload.worktreeId;
          run.updatedAt = event.timestamp;
        }
        break;
      case "AGENT_HANDOFF_RECORDED":
        if (run?.agentRuns[payload.agentRunId]) {
          run.agentRuns[payload.agentRunId].handoff = clone(payload.handoff);
          run.updatedAt = event.timestamp;
        }
        break;
      case "ARTIFACT_RECORDED":
        if (run) {
          run.artifacts.push(clone(payload.artifact));
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
      return { ok: true, created: false, run: clone(existing) };
    }

    const timestamp = this.now();
    const run = {
      version: 1,
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
      tasks: {},
      agentRuns: {},
      artifacts: [],
      evidence: [],
      reviews: [],
      integration: null,
      completionPermit: null,
      logs: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.commit("RUN_CREATED", { run });
    return { ok: true, created: true, run: clone(run) };
  }

  addTask(platformRunId, {
    taskId,
    title,
    dependencies = [],
    role = "implementer",
    instructions = "",
    maxAttempts = 2
  } = {}) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };

    const id = text(taskId, 120) || this.createId();
    if (run.tasks[id]) {
      return { ok: true, created: false, task: clone(run.tasks[id]) };
    }
    const normalizedDependencies = [...new Set(
      (Array.isArray(dependencies) ? dependencies : [])
        .map((value) => text(value, 120))
        .filter(Boolean)
    )];
    if (normalizedDependencies.some((dependencyId) => !run.tasks[dependencyId])) {
      return { ok: false, code: "task-dependency-not-found" };
    }

    const timestamp = this.now();
    const task = {
      version: 1,
      id,
      title: text(title, 500) || "未命名任务",
      role: text(role, 80) || "implementer",
      instructions: text(instructions, 4000),
      dependencies: normalizedDependencies,
      attemptCount: 0,
      maxAttempts: Math.max(1, Math.min(5, Math.round(Number(maxAttempts) || 2))),
      status: normalizedDependencies.length === 0 ||
        normalizedDependencies.every((dependencyId) =>
          run.tasks[dependencyId]?.status === "completed"
        )
        ? "ready"
        : "pending",
      statusReason: "",
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      endedAt: null
    };
    if (detectCycle(run.tasks, task)) {
      return { ok: false, code: "task-graph-cycle" };
    }

    this.commit("TASK_ADDED", { runId: run.id, task });
    return { ok: true, created: true, task: clone(task) };
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
    workspaceResource = "",
    modelSelection = null
  } = {}) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    const task = run?.tasks[text(taskId, 120)];
    if (!task) return { ok: false, code: "platform-task-not-found" };
    const id = text(agentRunId, 120) || this.createId();

    if (run.agentRuns[id]) {
      return { ok: true, created: false, agentRun: clone(run.agentRuns[id]) };
    }
    const taskStart = this.setTaskStatus(run.id, task.id, "running", "agent-started");
    if (!taskStart.ok) return taskStart;

    const leaseIds = [];
    if (text(workspaceResource, 500)) {
      const lease = this.acquireLease({
        platformRunId: run.id,
        agentRunId: id,
        resourceKey: workspaceResource,
        mode: run.mode === "coding" ? "exclusive" : "shared"
      });
      if (!lease.ok) {
        this.setTaskStatus(run.id, task.id, "blocked", lease.code);
        return lease;
      }
      leaseIds.push(lease.lease.id);
    }

    const timestamp = this.now();
    task.attemptCount = Math.max(0, Number(task.attemptCount) || 0) + 1;
    const agentRun = {
      version: 1,
      id,
      taskId: task.id,
      role: text(role, 80) || "implementer",
      attempt: task.attemptCount,
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

  recordAgentHandoff(platformRunId, agentRunId, handoff = {}) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    const agent = run?.agentRuns[text(agentRunId, 120)];
    if (!agent) return { ok: false, code: "platform-agent-run-not-found" };
    const normalized = {
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

  recordArtifact(platformRunId, artifact = {}) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
    const normalized = {
      version: 1,
      id: text(artifact.id, 120) || this.createId(),
      taskId: text(artifact.taskId, 120) || null,
      agentRunId: text(artifact.agentRunId, 120) || null,
      kind: text(artifact.kind, 80) || "worker-output",
      commit: text(artifact.commit, 120) || null,
      digest: text(artifact.digest, 160) || null,
      summary: text(artifact.summary, 1000),
      changed: artifact.changed === true,
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
    this.commit("INTEGRATION_RECORDED", {
      runId: run.id,
      integration: normalized
    });
    return { ok: true, integration: clone(normalized) };
  }

  recordReview(platformRunId, review = {}) {
    const run = this.ensureLoaded().runs[text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
    const normalized = {
      version: 1,
      id: text(review.id, 120) || this.createId(),
      taskId: text(review.taskId, 120) || null,
      agentRunId: text(review.agentRunId, 120) || null,
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
        owner.id !== agent.id;
    });
    if (changedWorkerArtifacts.length > 0) {
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
      if (
        !review ||
        reviewer?.role !== "reviewer" ||
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

    const evidenceHash = sha256({
      status: verification.status,
      checks: verification.checks ?? [],
      checkedAt: verification.checkedAt ?? 0
    });
    const integrationHash = changedWorkerArtifacts.length > 0
      ? run.integration.digest
      : sha256({
          scope: "platform-kernel-runtime-result",
          runId: run.id,
          workspaceId: run.workspaceId,
          records: (Array.isArray(records) ? records : []).map((record) => ({
            id: record?.id ?? "",
            name: record?.name ?? "",
            status: record?.status ?? "",
            resultHash: sha256(record?.result ?? record?.output ?? null)
          }))
        });
    const permit = this.completionAuthority.issue({
      goalId: run.goalId,
      goalRevision: run.goalRevision,
      platformRunId: run.id,
      integrationHash,
      evidenceHash,
      verifierVersion: verification.version ?? 1
    });
    this.commit("COMPLETION_ISSUED", { runId: run.id, permit });
    return { ok: true, permit: clone(permit) };
  }

  verifyCompletionPermit(permit, expected = {}) {
    return this.completionAuthority.verify(permit, expected);
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
        if (task.status !== "running") continue;
        this.setTaskStatus(
          run.id,
          task.id,
          "continuable",
          "orphaned-running-task"
        );
        recoveredTaskIds.push(task.id);
        recoveredThisRun = true;
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
