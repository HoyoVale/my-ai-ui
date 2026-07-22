import crypto from "node:crypto";

import {
  sha256
} from "./canonical.js";

const ROLES = new Set([
  "planner",
  "explorer",
  "implementer",
  "tester",
  "reviewer",
  "integrator"
]);

const READ_ONLY_ROLES = new Set([
  "planner",
  "explorer",
  "tester",
  "reviewer"
]);

function normalizeResult(result) {
  const source = result && typeof result === "object" ? result : {};
  return {
    ok: source.ok !== false,
    status: source.status === "failed" ? "failed" : "completed",
    summary: String(source.summary ?? source.text ?? "").trim().slice(0, 2000),
    evidence: (Array.isArray(source.evidence) ? source.evidence : [])
      .slice(0, 40)
      .map((item) => String(item).slice(0, 500)),
    unresolved: (Array.isArray(source.unresolved) ? source.unresolved : [])
      .slice(0, 20)
      .map((item) => String(item).slice(0, 500)),
    error: String(source.error ?? "").slice(0, 1000),
    records: Array.isArray(source.records) ? source.records : []
  };
}

export class MultiAgentSupervisor {
  constructor({
    platformKernel,
    worktreeRuntime,
    workerRuntime,
    getWorkspaceRoot,
    maxConcurrency = 2,
    getMaxConcurrency = null,
    createId = () => crypto.randomUUID()
  } = {}) {
    if (!platformKernel || !worktreeRuntime || !workerRuntime) {
      throw new TypeError(
        "MultiAgentSupervisor requires PlatformKernel, WorktreeRuntime and WorkerRuntime."
      );
    }
    this.platformKernel = platformKernel;
    this.worktreeRuntime = worktreeRuntime;
    this.workerRuntime = workerRuntime;
    this.getWorkspaceRoot = typeof getWorkspaceRoot === "function"
      ? getWorkspaceRoot
      : () => "";
    this.maxConcurrency = Math.max(1, Math.min(4, Number(maxConcurrency) || 2));
    this.getMaxConcurrency = typeof getMaxConcurrency === "function"
      ? getMaxConcurrency
      : null;
    this.createId = createId;
    this.controllers = new Map();
    this.running = new Map();
    this.paused = new Set();
  }

  addTasks(platformRunId, tasks = []) {
    const results = [];
    for (const task of tasks) {
      const role = ROLES.has(task?.role) ? task.role : "implementer";
      results.push(this.platformKernel.addTask(platformRunId, {
        ...task,
        taskId: task?.taskId ?? task?.id,
        role
      }));
      if (!results.at(-1)?.ok) break;
    }
    return {
      ok: results.every((result) => result.ok),
      results
    };
  }

  pause(platformRunId) {
    this.paused.add(platformRunId);
    this.platformKernel.setRunStatus(platformRunId, "paused", "supervisor-paused");
    return { ok: true };
  }

  resume(platformRunId) {
    this.paused.delete(platformRunId);
    this.platformKernel.setRunStatus(platformRunId, "active", "supervisor-resumed");
    return { ok: true };
  }

  cancel(platformRunId) {
    for (const [agentRunId, entry] of this.controllers) {
      if (entry.platformRunId === platformRunId) {
        entry.controller.abort("supervisor-cancelled");
        this.controllers.delete(agentRunId);
      }
    }
    this.platformKernel.setRunStatus(platformRunId, "cancelled", "supervisor-cancelled");
    return { ok: true };
  }

  async executeTask(platformRunId, taskId) {
    const run = this.platformKernel.getRun(platformRunId);
    const task = run?.tasks?.[taskId];
    if (!task || task.status !== "ready") {
      return { ok: false, code: "supervisor-task-not-ready" };
    }
    const workspaceRoot = this.getWorkspaceRoot(run);
    if (!workspaceRoot) {
      this.platformKernel.setTaskStatus(run.id, task.id, "blocked", "workspace-unavailable");
      return { ok: false, code: "supervisor-workspace-unavailable" };
    }

    const model = this.workerRuntime.resolveModel();
    const agentRunId = this.createId();
    const begun = this.platformKernel.beginAgentRun({
      platformRunId: run.id,
      agentRunId,
      taskId: task.id,
      role: task.role,
      modelSelection: {
        providerId: model.providerId,
        modelConfigId: model.modelConfigId
      }
    });
    if (!begun.ok) return begun;

    const worktreeResult = this.worktreeRuntime.create({
      platformRunId: run.id,
      agentRunId,
      taskId: task.id,
      workspaceRoot,
      role: task.role,
      writable: !READ_ONLY_ROLES.has(task.role)
    });
    if (!worktreeResult.ok) {
      this.platformKernel.finishAgentRun(run.id, agentRunId, {
        status: "failed",
        error: worktreeResult.code,
        stopReason: "worktree-creation-failed",
        taskStatus: "failed"
      });
      return worktreeResult;
    }
    const worktree = worktreeResult.worktree;
    this.platformKernel.attachAgentWorktree(run.id, agentRunId, worktree.id);
    const controller = new AbortController();
    this.controllers.set(agentRunId, {
      platformRunId: run.id,
      controller
    });

    let normalized;
    try {
      normalized = normalizeResult(await this.workerRuntime.execute({
        run,
        task,
        agentRun: this.platformKernel.getRun(run.id).agentRuns[agentRunId],
        worktree,
        signal: controller.signal
      }));
    } catch (error) {
      normalized = normalizeResult({
        ok: false,
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.controllers.delete(agentRunId);
    }

    const checkpoint = this.worktreeRuntime.checkpoint(
      worktree.id,
      `${task.role}: ${task.title}`
    );
    const readOnlyViolation = READ_ONLY_ROLES.has(task.role) && checkpoint.ok && checkpoint.changed;
    if (readOnlyViolation) {
      normalized = normalizeResult({
        ok: false,
        status: "failed",
        error: "read-only-worker-modified-worktree",
        unresolved: ["只读 Worker 修改了隔离工作区，结果已拒绝。"]
      });
    }

    this.platformKernel.recordAgentHandoff(run.id, agentRunId, {
      inputRevision: run.taskGraphRevision,
      outputCommit: checkpoint.commit ?? null,
      summary: normalized.summary,
      evidence: normalized.evidence,
      unresolved: normalized.unresolved
    });
    if (checkpoint.ok) {
      this.platformKernel.recordArtifact(run.id, {
        taskId: task.id,
        agentRunId,
        kind: "git-commit",
        commit: checkpoint.commit,
        changed: checkpoint.changed === true,
        digest: sha256({
          commit: checkpoint.commit,
          baseline: worktree.baselineCommit
        }),
        summary: normalized.summary
      });
    }

    const cancelled = controller.signal.aborted ||
      this.platformKernel.getRun(run.id)?.status === "cancelled";
    this.worktreeRuntime.release(worktree.id, {
      reason: cancelled
        ? "worker-cancelled"
        : normalized.ok ? "worker-completed" : "worker-failed",
      remove: true
    });
    const success = !cancelled && normalized.ok && normalized.status === "completed";
    this.platformKernel.finishAgentRun(run.id, agentRunId, {
      status: cancelled ? "cancelled" : success ? "completed" : "failed",
      outcome: cancelled ? "cancelled" : success ? "handoff-recorded" : "worker-failed",
      stopReason: cancelled ? "supervisor-cancelled" : success ? "task-completed" : normalized.error,
      error: normalized.error,
      taskStatus: cancelled ? "cancelled" : success ? "completed" : "failed"
    });

    if (!success && !cancelled) {
      const latest = this.platformKernel.getRun(run.id).tasks[task.id];
      if (latest.attemptCount < latest.maxAttempts) {
        this.platformKernel.setTaskStatus(run.id, task.id, "ready", "worker-retry");
      }
    }
    return {
      ok: success,
      agentRunId,
      taskId: task.id,
      commit: checkpoint.commit ?? null,
      result: normalized
    };
  }

  async run(platformRunId, { taskIds = null } = {}) {
    if (this.running.has(platformRunId)) {
      return this.running.get(platformRunId);
    }
    const execution = this.runLoop(platformRunId, taskIds)
      .finally(() => this.running.delete(platformRunId));
    this.running.set(platformRunId, execution);
    return execution;
  }

  async runLoop(platformRunId, taskIds = null) {
    const outcomes = [];
    const scopedTaskIds = Array.isArray(taskIds) && taskIds.length > 0
      ? new Set(taskIds.map((value) => String(value)))
      : null;
    while (!this.paused.has(platformRunId)) {
      const run = this.platformKernel.getRun(platformRunId);
      if (!run || ["cancelled", "completed"].includes(run.status)) break;
      const ready = Object.values(run.tasks).filter((task) =>
        task.status === "ready" &&
        (!scopedTaskIds || scopedTaskIds.has(task.id))
      );
      if (ready.length === 0) break;
      const configuredConcurrency = this.getMaxConcurrency
        ? this.getMaxConcurrency()
        : this.maxConcurrency;
      const concurrency = Math.max(
        1,
        Math.min(4, Number(configuredConcurrency) || this.maxConcurrency)
      );
      const batch = ready.slice(0, concurrency);
      const results = await Promise.all(
        batch.map((task) => this.executeTask(platformRunId, task.id))
      );
      outcomes.push(...results);
    }

    const finalRun = this.platformKernel.getRun(platformRunId);
    const tasks = Object.values(finalRun?.tasks ?? {})
      .filter((task) => !scopedTaskIds || scopedTaskIds.has(task.id));
    const completed = tasks.length > 0 && tasks.every((task) => task.status === "completed");
    const blocked = tasks.filter((task) => ["blocked", "failed", "continuable"].includes(task.status));
    if (!completed && blocked.length > 0 && finalRun?.status === "active") {
      this.platformKernel.setRunStatus(platformRunId, "continuable", "supervisor-needs-attention");
    }
    return {
      ok: completed,
      completed,
      outcomes,
      blockedTaskIds: blocked.map((task) => task.id),
      run: this.platformKernel.getRun(platformRunId)
    };
  }
}
