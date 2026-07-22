import * as internals from "../PlatformKernelInternals.js";

export const PlatformTaskService = {
  addTaskGraph(platformRunId, tasks = []) {
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
  
    const requested = Array.isArray(tasks) ? tasks : [];
    const existing = requested
      .map((task) => internals.text(task?.taskId ?? task?.id, 120))
      .filter((id) => id && run.tasks[id]);
    if (existing.length === requested.length && requested.length > 0) {
      return {
        ok: true,
        created: false,
        tasks: existing.map((id) => internals.clone(run.tasks[id]))
      };
    }
    if (existing.length > 0) {
      return {
        ok: false,
        code: "task-graph-partial-duplicate",
        taskIds: existing
      };
    }
  
    const validated = internals.validateTaskGraph(run.tasks, requested, {
      createId: this.createId
    });
    if (!validated.ok) return validated;
  
    const timestamp = this.now();
    const normalizedTasks = validated.tasks.map((definition) => internals.normalizeStoredTask({
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
    const fingerprint = internals.fingerprintTaskGraph([
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
      tasks: normalizedTasks.map((task) => internals.clone(task)),
      fingerprint
    };
  },

  addTask(platformRunId, task = {}) {
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
    const id = internals.text(task?.taskId ?? task?.id, 120);
    if (id && run.tasks[id]) {
      return { ok: true, created: false, task: internals.clone(run.tasks[id]) };
    }
    const result = this.addTaskGraph(platformRunId, [task]);
    return result.ok
      ? {
          ok: true,
          created: result.created,
          task: internals.clone(result.tasks[0]),
          fingerprint: result.fingerprint
        }
      : result;
  },

  setTaskStatus(platformRunId, taskId, status, reason = "") {
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
    const task = run?.tasks[internals.text(taskId, 120)];
    if (!task) return { ok: false, code: "platform-task-not-found" };
    if (!internals.TASK_STATUSES.has(status)) {
      return { ok: false, code: "platform-task-status-invalid" };
    }
    if (status === "running" && !internals.taskDependenciesSettled(run, task)) {
      return { ok: false, code: "task-dependencies-unsettled" };
    }
    if (task.status === status) {
      return { ok: true, changed: false, task: internals.clone(task) };
    }
    if (!internals.TASK_TRANSITIONS[task.status]?.has(status)) {
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
      reason: internals.text(reason)
    });
    this.promoteReadyTasks(run.id);
    return { ok: true, changed: true, task: internals.clone(run.tasks[task.id]) };
  },

  promoteReadyTasks(platformRunId) {
    const run = this.ensureLoaded().runs[platformRunId];
    if (!run) return;
    for (const task of Object.values(run.tasks)) {
      if (task.status === "pending" && internals.taskDependenciesSettled(run, task)) {
        this.commit("TASK_STATUS_CHANGED", {
          runId: run.id,
          taskId: task.id,
          status: "ready",
          reason: "dependencies-completed"
        });
      }
    }
  },

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
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
    const task = run?.tasks[internals.text(taskId, 120)];
    if (!task) return { ok: false, code: "platform-task-not-found" };
    const id = internals.text(agentRunId, 120) || this.createId();
    const normalizedKind = kind === "evaluator" ? "evaluator" : "worker";
  
    if (run.agentRuns[id]) {
      return { ok: true, created: false, agentRun: internals.clone(run.agentRuns[id]) };
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
      const lease = this.state.leases[internals.text(leaseId, 120)];
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
  
    if (internals.text(workspaceResource, 500)) {
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
      role: internals.text(role, 80) || "implementer",
      kind: normalizedKind,
      attempt,
      modelSelection: modelSelection && typeof modelSelection === "object"
        ? {
            providerId: internals.text(modelSelection.providerId, 80),
            modelConfigId: internals.text(modelSelection.modelConfigId, 120)
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
    return { ok: true, created: true, agentRun: internals.clone(agentRun) };
  },

  attachAgentWorktree(platformRunId, agentRunId, worktreeId) {
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
    const agent = run?.agentRuns[internals.text(agentRunId, 120)];
    if (!agent) return { ok: false, code: "platform-agent-run-not-found" };
    this.commit("AGENT_WORKTREE_ATTACHED", {
      runId: run.id,
      agentRunId: agent.id,
      worktreeId: internals.text(worktreeId, 120)
    });
    return { ok: true, agentRun: internals.clone(run.agentRuns[agent.id]) };
  },

  recordTaskCheckpoint(platformRunId, taskId, checkpoint = {}) {
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
    const task = run?.tasks[internals.text(taskId, 120)];
    if (!task) return { ok: false, code: "platform-task-not-found" };
    const normalized = {
      version: 1,
      agentRunId: internals.text(checkpoint.agentRunId, 120) || null,
      commit: internals.text(checkpoint.commit, 120) || null,
      baselineCommit: internals.text(checkpoint.baselineCommit, 120) || null,
      changed: checkpoint.changed === true,
      fingerprint: internals.sha256({
        taskId: task.id,
        agentRunId: internals.text(checkpoint.agentRunId, 120) || null,
        commit: internals.text(checkpoint.commit, 120) || null,
        baselineCommit: internals.text(checkpoint.baselineCommit, 120) || null,
        changed: checkpoint.changed === true
      }),
      recordedAt: Math.max(0, Number(checkpoint.recordedAt) || this.now())
    };
    this.commit("TASK_CHECKPOINT_RECORDED", {
      runId: run.id,
      taskId: task.id,
      checkpoint: normalized
    });
    return { ok: true, checkpoint: internals.clone(normalized) };
  },

  recordAgentHandoff(platformRunId, agentRunId, handoff = {}) {
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
    const agent = run?.agentRuns[internals.text(agentRunId, 120)];
    if (!agent) return { ok: false, code: "platform-agent-run-not-found" };
    const normalized = Number(handoff?.version) >= 2
      ? internals.normalizeStructuredHandoff(handoff)
      : {
          version: 1,
          inputRevision: Math.max(0, Number(handoff.inputRevision) || run.taskGraphRevision),
          outputCommit: internals.text(handoff.outputCommit, 120) || null,
          summary: internals.text(handoff.summary, 2000),
          evidence: (Array.isArray(handoff.evidence) ? handoff.evidence : [])
            .slice(0, 40)
            .map((item) => internals.text(item, 500))
            .filter(Boolean),
          unresolved: (Array.isArray(handoff.unresolved) ? handoff.unresolved : [])
            .slice(0, 20)
            .map((item) => internals.text(item, 500))
            .filter(Boolean),
          recordedAt: this.now()
        };
    this.commit("AGENT_HANDOFF_RECORDED", {
      runId: run.id,
      agentRunId: agent.id,
      handoff: normalized
    });
    return { ok: true, handoff: internals.clone(normalized) };
  },

  recordTaskEvaluation(platformRunId, taskId, evaluation = {}) {
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
    const task = run?.tasks[internals.text(taskId, 120)];
    if (!task) return { ok: false, code: "platform-task-not-found" };
    const normalized = {
      version: 1,
      status: evaluation.approved === true ? "approved" : "rejected",
      attempt: Math.max(1, Math.round(Number(evaluation.attempt) || 1)),
      approved: evaluation.approved === true,
      evaluatorAgentRunId: internals.text(evaluation.evaluatorAgentRunId, 120) || null,
      workerAgentRunId: internals.text(evaluation.workerAgentRunId, 120) || null,
      handoffFingerprint: internals.text(evaluation.handoffFingerprint, 128),
      taskGraphRevision: Math.max(0, Number(evaluation.taskGraphRevision) || run.taskGraphRevision),
      summary: internals.text(evaluation.summary, 2000),
      findings: (Array.isArray(evaluation.findings) ? evaluation.findings : [])
        .map((item) => internals.text(item, 500)).filter(Boolean).slice(0, 40),
      evidence: (Array.isArray(evaluation.evidence) ? evaluation.evidence : [])
        .map((item) => internals.text(item, 500)).filter(Boolean).slice(0, 60),
      criteria: (Array.isArray(evaluation.criteria) ? evaluation.criteria : [])
        .map((item) => ({
          criterionId: internals.text(item?.criterionId ?? item?.id, 120),
          passed: item?.passed === true,
          evidence: (Array.isArray(item?.evidence) ? item.evidence : [])
            .map((value) => internals.text(value, 500)).filter(Boolean).slice(0, 20),
          note: internals.text(item?.note ?? item?.summary, 500)
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
    return { ok: true, evaluation: internals.clone(normalized) };
  },

  finishAgentRun(platformRunId, agentRunId, {
    status = "completed",
    outcome = "",
    stopReason = "",
    error = "",
    taskStatus = null
  } = {}) {
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
    const agent = run?.agentRuns[internals.text(agentRunId, 120)];
    if (!agent) return { ok: false, code: "platform-agent-run-not-found" };
    if (agent.status !== "running") {
      return { ok: true, changed: false, agentRun: internals.clone(agent) };
    }
    const normalizedStatus = internals.AGENT_STATUSES.has(status) ? status : "failed";
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
    return { ok: true, changed: true, agentRun: internals.clone(run.agentRuns[agent.id]) };
  }
};
