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
    version: 1,
    lastSequence: 0,
    lastEventHash: "",
    runs: {},
    leases: {},
    updatedAt: 0
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
    for (const event of journalEvents) {
      if (event.sequence > this.state.lastSequence) {
        this.applyEvent(event);
      }
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
      completionPermit: null,
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
      status: normalizedDependencies.length === 0 ? "ready" : "pending",
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
      createdAt: this.now()
    };
    this.commit("ARTIFACT_RECORDED", { runId: run.id, artifact: normalized });
    return { ok: true, artifact: clone(normalized) };
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
    const integrationHash = sha256({
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
