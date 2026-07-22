import crypto from "node:crypto";

import {
  sha256
} from "./canonical.js";

import {
  createStructuredHandoff
} from "./StructuredHandoff.js";

import {
  isReadOnlySupervisorRole,
  SUPERVISOR_ROLES
} from "./TaskGraphContract.js";

import {
  DeterministicTaskEvaluator
} from "./DeterministicTaskEvaluator.js";

import {
  WORKER_RUNTIME_DEFAULTS,
  WORKER_RUNTIME_LIMITS
} from "../../src/shared/runtimeDefaults.js";

const ROLES = new Set(SUPERVISOR_ROLES);

function normalizeResult(result) {
  const source = result && typeof result === "object" ? result : {};
  return {
    ok: source.ok !== false,
    status: source.status === "failed" ? "failed" : "completed",
    summary: String(source.summary ?? source.text ?? "").trim().slice(0, 2000),
    evidence: (Array.isArray(source.evidence) ? source.evidence : [])
      .slice(0, 40)
      .map((item) => String(item).slice(0, 500)),
    acceptanceClaims: Array.isArray(source.acceptanceClaims ?? source.acceptance)
      ? structuredClone(source.acceptanceClaims ?? source.acceptance).slice(0, 32)
      : [],
    unresolved: (Array.isArray(source.unresolved) ? source.unresolved : [])
      .slice(0, 20)
      .map((item) => String(item).slice(0, 500)),
    error: String(source.error ?? "").slice(0, 1000),
    records: Array.isArray(source.records) ? source.records : [],
    usage: {
      totalTokens: Math.max(0, Number(source.usage?.totalTokens) || 0),
      steps: Math.max(0, Number(source.usage?.steps) || 0),
      reported: source.usage?.reported === true
    }
  };
}

function leaseResourceKeys(run, task) {
  return [
    { key: `task:${run.id}:${task.id}`, mode: "exclusive" },
    ...(Array.isArray(task.resourceLocks) ? task.resourceLocks : []),
    ...(task.workspaceScope?.path
      ? [{
          key: `workspace-scope:${run.workspaceId ?? "workspace"}:${task.workspaceScope.path}`,
          mode: task.workspaceScope.writable === false ? "shared" : "exclusive"
        }]
      : [])
  ];
}

export class MultiAgentSupervisor {
  constructor({
    platformKernel,
    worktreeRuntime,
    workerRuntime,
    taskEvaluator = null,
    getWorkspaceRoot,
    maxConcurrency = WORKER_RUNTIME_DEFAULTS.maxConcurrency,
    getMaxConcurrency = null,
    leaseTtlMs = 90_000,
    leaseHeartbeatMs = 20_000,
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
    this.taskEvaluator = taskEvaluator ?? new DeterministicTaskEvaluator({
      platformKernel,
      createId
    });
    this.maxConcurrency = Math.max(
      WORKER_RUNTIME_LIMITS.maxConcurrency.min,
      Math.min(
        WORKER_RUNTIME_LIMITS.maxConcurrency.max,
        Number(maxConcurrency) || WORKER_RUNTIME_DEFAULTS.maxConcurrency
      )
    );
    this.getMaxConcurrency = typeof getMaxConcurrency === "function"
      ? getMaxConcurrency
      : null;
    this.leaseTtlMs = Math.max(5_000, Number(leaseTtlMs) || 90_000);
    this.leaseHeartbeatMs = Math.max(
      1_000,
      Math.min(
        Math.floor(this.leaseTtlMs / 2),
        Number(leaseHeartbeatMs) || 20_000
      )
    );
    this.createId = createId;
    this.controllers = new Map();
    this.running = new Map();
    this.paused = new Set();
  }

  addTasks(platformRunId, tasks = []) {
    const normalized = (Array.isArray(tasks) ? tasks : []).map((task) => ({
      ...task,
      taskId: task?.taskId ?? task?.id,
      role: ROLES.has(task?.role) ? task.role : "implementer"
    }));
    const result = this.platformKernel.addTaskGraph(platformRunId, normalized);
    return result.ok
      ? {
          ok: true,
          created: result.created,
          fingerprint: result.fingerprint,
          results: result.tasks.map((task) => ({
            ok: true,
            created: result.created,
            task
          }))
        }
      : {
          ok: false,
          code: result.code,
          results: [result]
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

  acquireTaskLeases(run, task, agentRunId) {
    const leases = [];
    for (const resource of leaseResourceKeys(run, task)) {
      const acquired = this.platformKernel.acquireLease({
        platformRunId: run.id,
        agentRunId,
        resourceKey: resource.key,
        mode: resource.mode,
        ttlMs: this.leaseTtlMs
      });
      if (!acquired.ok) {
        for (const lease of leases) {
          this.platformKernel.releaseLease(lease.id, "task-claim-rollback");
        }
        return acquired;
      }
      leases.push(acquired.lease);
    }
    return { ok: true, leases };
  }

  startLeaseHeartbeat(leases, controller) {
    if (!Array.isArray(leases) || leases.length === 0) return () => {};
    const timer = setInterval(() => {
      for (const lease of leases) {
        const renewed = this.platformKernel.renewLease(lease.id, this.leaseTtlMs);
        if (!renewed.ok) {
          controller.abort(`worker-lease-lost:${lease.id}`);
          break;
        }
      }
    }, this.leaseHeartbeatMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  releaseTaskLeases(leases, reason) {
    for (const lease of leases ?? []) {
      this.platformKernel.releaseLease(lease.id, reason);
    }
  }

  async executeTask(
    platformRunId,
    taskId,
    {
      signal = null,
      onUsage = null
    } = {}
  ) {
    let run = this.platformKernel.getRun(platformRunId);
    let task = run?.tasks?.[taskId];
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
    const claimed = this.acquireTaskLeases(run, task, agentRunId);
    if (!claimed.ok) {
      return {
        ok: false,
        code: claimed.code,
        taskId: task.id,
        leased: claimed.code === "resource-lease-conflict"
      };
    }
    const begun = this.platformKernel.beginAgentRun({
      platformRunId: run.id,
      agentRunId,
      taskId: task.id,
      role: task.role,
      kind: "worker",
      modelSelection: {
        providerId: model.providerId,
        modelConfigId: model.modelConfigId
      }
    });
    if (!begun.ok) {
      this.releaseTaskLeases(claimed.leases, "worker-start-failed");
      return begun;
    }

    const worktreeResult = this.worktreeRuntime.create({
      platformRunId: run.id,
      agentRunId,
      taskId: task.id,
      workspaceRoot,
      role: task.role,
      writable: !isReadOnlySupervisorRole(task.role),
      baselineCommit: task.checkpoint?.commit ?? null
    });
    if (!worktreeResult.ok) {
      this.platformKernel.finishAgentRun(run.id, agentRunId, {
        status: "failed",
        error: worktreeResult.code,
        stopReason: "worktree-creation-failed",
        taskStatus: "failed"
      });
      this.releaseTaskLeases(claimed.leases, "worktree-creation-failed");
      return worktreeResult;
    }
    const worktree = worktreeResult.worktree;
    this.platformKernel.attachAgentWorktree(run.id, agentRunId, worktree.id);
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal?.reason ?? "job-aborted");
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener?.("abort", forwardAbort, { once: true });
    this.controllers.set(agentRunId, {
      platformRunId: run.id,
      controller
    });
    const stopHeartbeat = this.startLeaseHeartbeat(claimed.leases, controller);

    let leaseReleaseReason = "supervisor-task-finished";
    try {
      let normalized;
      try {
        normalized = normalizeResult(await this.workerRuntime.execute({
          run,
          task,
          agentRun: this.platformKernel.getRun(run.id).agentRuns[agentRunId],
          worktree,
          signal: controller.signal,
          onUsage
        }));
      } catch (error) {
        normalized = normalizeResult({
          ok: false,
          status: "failed",
          error: error instanceof Error ? error.message : String(error)
        });
      }

      if (typeof onUsage === "function" && normalized.usage.reported !== true) {
        onUsage({
          tokens: normalized.usage.totalTokens,
          steps: normalized.usage.steps || 1
        });
      }

      const checkpoint = this.worktreeRuntime.checkpoint(
        worktree.id,
        `${task.role}: ${task.title}`
      );
      const readOnlyViolation =
        isReadOnlySupervisorRole(task.role) && checkpoint.ok && checkpoint.changed;
      if (readOnlyViolation) {
        normalized = normalizeResult({
          ok: false,
          status: "failed",
          error: "read-only-worker-modified-worktree",
          unresolved: ["只读 Worker 修改了隔离工作区，结果已拒绝。"]
        });
      }
      if (!checkpoint.ok) {
        normalized = normalizeResult({
          ok: false,
          status: "failed",
          error: checkpoint.code ?? "worker-checkpoint-failed",
          unresolved: ["Worker Checkpoint 未能持久化。"]
        });
      }

      run = this.platformKernel.getRun(run.id);
      task = run.tasks[task.id];
      const handoff = createStructuredHandoff({
        run,
        task,
        agentRun: run.agentRuns[agentRunId],
        checkpoint: {
          ...checkpoint,
          baselineCommit: worktree.baselineCommit
        },
        result: normalized
      });
      this.platformKernel.recordAgentHandoff(run.id, agentRunId, handoff);

      if (checkpoint.ok) {
        for (const record of normalized.records
          .filter((item) => item?.status === "completed")
          .slice(-40)) {
          this.platformKernel.recordArtifact(run.id, {
            taskId: task.id,
            agentRunId,
            kind: "worker-tool-receipt",
            commit: checkpoint.commit ?? null,
            changed: false,
            receiptIds: [record.id ?? record.name],
            digest: sha256({
              id: record.id,
              name: record.name,
              status: record.status,
              input: record.input ?? null,
              output: record.result ?? record.output ?? null
            }),
            summary: `${record.name}: ${record.status}`,
            source: "worker-tool-runtime"
          });
        }
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

      const cancelled = this.platformKernel.getRun(run.id)?.status === "cancelled" ||
        controller.signal.reason === "supervisor-cancelled";
      const boundaryInterrupted = !cancelled && (
        signal?.aborted === true || controller.signal.aborted === true
      );
      const workerSuccess =
        !cancelled && normalized.ok && normalized.status === "completed";

      this.worktreeRuntime.release(worktree.id, {
        reason: cancelled
          ? "worker-cancelled"
          : workerSuccess ? "worker-awaiting-evaluation" : "worker-failed",
        remove: workerSuccess || checkpoint.changed !== true
      });
      this.platformKernel.finishAgentRun(run.id, agentRunId, {
        status: cancelled ? "cancelled" : workerSuccess ? "completed" : "failed",
        outcome: cancelled
          ? "cancelled"
          : workerSuccess ? "handoff-recorded" : "worker-failed",
        stopReason: cancelled
          ? "supervisor-cancelled"
          : workerSuccess ? "task-awaiting-evaluation" : normalized.error,
        error: normalized.error,
        taskStatus: cancelled ? "cancelled" : workerSuccess ? "review" : "failed"
      });

      if (workerSuccess && boundaryInterrupted) {
        leaseReleaseReason = "supervisor-boundary-interrupted";
        this.platformKernel.setTaskStatus(
          run.id,
          task.id,
          "continuable",
          String(signal?.reason ?? "supervisor-boundary-interrupted")
        );
        return {
          ok: false,
          continuable: true,
          code: "supervisor-boundary-interrupted",
          agentRunId,
          taskId: task.id,
          commit: checkpoint.commit ?? null,
          handoff,
          result: normalized
        };
      }

      if (!workerSuccess) {
        leaseReleaseReason = cancelled ? "worker-cancelled" : "worker-failed";
        if (!cancelled) {
          const latest = this.platformKernel.getRun(run.id).tasks[task.id];
          if (latest.attemptCount < latest.maxAttempts) {
            this.platformKernel.setTaskStatus(run.id, task.id, "ready", "worker-retry");
          }
        }
        return {
          ok: false,
          agentRunId,
          taskId: task.id,
          commit: checkpoint.commit ?? null,
          handoff,
          result: normalized
        };
      }

      let evaluation;
      try {
        evaluation = this.taskEvaluator
          ? await this.taskEvaluator.evaluate(run.id, task.id, agentRunId, {
              signal: controller.signal,
              onUsage
            })
          : {
              ok: false,
              approved: false,
              code: "task-evaluator-unavailable"
            };
      } catch (error) {
        evaluation = {
          ok: false,
          approved: false,
          code: "task-evaluator-failed",
          error: error instanceof Error ? error.message : String(error)
        };
        const latest = this.platformKernel.getRun(run.id).tasks[task.id];
        if (latest.status === "review") {
          this.platformKernel.setTaskStatus(
            run.id,
            task.id,
            "continuable",
            evaluation.code
          );
        }
      }

      if (!evaluation?.approved) {
        const latest = this.platformKernel.getRun(run.id).tasks[task.id];
        if (
          latest.attemptCount < latest.maxAttempts &&
          latest.status === "continuable"
        ) {
          this.platformKernel.setTaskStatus(
            run.id,
            task.id,
            "ready",
            "evaluation-retry"
          );
        }
      }
      leaseReleaseReason = evaluation?.approved
        ? "task-evaluated"
        : "task-evaluation-failed";
      return {
        ok: evaluation?.approved === true,
        agentRunId,
        evaluatorAgentRunId: evaluation?.evaluatorAgentRunId ?? null,
        taskId: task.id,
        commit: checkpoint.commit ?? null,
        handoff,
        evaluation,
        result: normalized
      };
    } finally {
      stopHeartbeat();
      signal?.removeEventListener?.("abort", forwardAbort);
      this.controllers.delete(agentRunId);
      this.releaseTaskLeases(claimed.leases, leaseReleaseReason);
    }
  }

  async run(
    platformRunId,
    {
      taskIds = null,
      signal = null,
      onUsage = null
    } = {}
  ) {
    if (this.running.has(platformRunId)) {
      return this.running.get(platformRunId);
    }
    const execution = this.runLoop(
      platformRunId,
      taskIds,
      signal,
      onUsage
    ).finally(() => this.running.delete(platformRunId));
    this.running.set(platformRunId, execution);
    return execution;
  }

  async runLoop(
    platformRunId,
    taskIds = null,
    signal = null,
    onUsage = null
  ) {
    const outcomes = [];
    const scopedTaskIds = Array.isArray(taskIds) && taskIds.length > 0
      ? new Set(taskIds.map((value) => String(value)))
      : null;
    while (!this.paused.has(platformRunId) && !signal?.aborted) {
      const run = this.platformKernel.getRun(platformRunId);
      if (!run || ["cancelled", "completed"].includes(run.status)) break;
      const ready = Object.values(run.tasks)
        .filter((task) =>
          task.status === "ready" &&
          (!scopedTaskIds || scopedTaskIds.has(task.id))
        )
        .sort((left, right) =>
          (right.priority ?? 50) - (left.priority ?? 50) ||
          left.createdAt - right.createdAt ||
          left.id.localeCompare(right.id)
        );
      if (ready.length === 0) break;
      const configuredConcurrency = this.getMaxConcurrency
        ? this.getMaxConcurrency()
        : this.maxConcurrency;
      const concurrency = Math.max(
        WORKER_RUNTIME_LIMITS.maxConcurrency.min,
        Math.min(
          WORKER_RUNTIME_LIMITS.maxConcurrency.max,
          Number(configuredConcurrency) || this.maxConcurrency
        )
      );
      const batch = ready.slice(0, concurrency);
      const results = await Promise.all(
        batch.map((task) => this.executeTask(
          platformRunId,
          task.id,
          { signal, onUsage }
        ))
      );
      outcomes.push(...results);
      const madeProgress = results.some((result) => !result.leased);
      if (!madeProgress) break;
    }

    const finalRun = this.platformKernel.getRun(platformRunId);
    const tasks = Object.values(finalRun?.tasks ?? {})
      .filter((task) => !scopedTaskIds || scopedTaskIds.has(task.id));
    const completed = tasks.length > 0 && tasks.every((task) => task.status === "completed");
    const blocked = tasks.filter((task) =>
      ["blocked", "failed", "continuable", "review"].includes(task.status)
    );
    if (!completed && blocked.length > 0 && finalRun?.status === "active") {
      this.platformKernel.setRunStatus(
        platformRunId,
        "continuable",
        "supervisor-needs-attention"
      );
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
