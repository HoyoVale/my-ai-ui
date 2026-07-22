import * as internals from "../PlatformKernelInternals.js";

import {
  createPlatformExecutionBridge
} from "../../execution-model/PlatformExecutionBridge.js";

export const PlatformRunService = {
  invalidateCompletionState(platformRunId, reason, {
    invalidateEvidence = true
  } = {}) {
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
    const evidenceIds = invalidateEvidence
      ? run.evidence.filter((item) => item.status === "valid").map((item) => item.id)
      : [];
    const hadPermit = Boolean(run.completionPermit);
    if (evidenceIds.length > 0) {
      this.commit("EVIDENCE_INVALIDATED", {
        runId: run.id,
        evidenceIds,
        reason: internals.text(reason, 500)
      });
    }
    if (hadPermit) {
      this.commit("COMPLETION_INVALIDATED", {
        runId: run.id,
        reason: internals.text(reason, 500)
      });
    }
    return { ok: true, evidenceIds, permitInvalidated: hadPermit };
  },

  recordFailure(platformRunId, failure = {}) {
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
    const fingerprint = internals.sha256({
      type: failure.type,
      code: failure.code,
      stage: failure.stage,
      summary: failure.summary,
      conflicts: failure.conflicts ?? []
    });
    const existing = [...run.failures].reverse().find((item) =>
      item.fingerprint === fingerprint && !item.resolvedAt
    );
    if (existing) return { ok: true, created: false, failure: internals.clone(existing) };
    const normalized = {
      version: 2,
      id: this.createId(),
      fingerprint,
      type: internals.text(failure.type, 80) || "implementation",
      code: internals.text(failure.code, 160) || "platform-failure",
      stage: internals.text(failure.stage, 120) || "execution",
      summary: internals.text(failure.summary, 2000),
      conflicts: (Array.isArray(failure.conflicts) ? failure.conflicts : [])
        .map((item) => internals.text(item, 500)).filter(Boolean).slice(0, 100),
      retryable: failure.retryable === true,
      requiresUserInput: failure.requiresUserInput === true,
      action: internals.text(failure.action, 120),
      recordedAt: this.now(),
      resolvedAt: null
    };
    this.commit("FAILURE_RECORDED", { runId: run.id, failure: normalized });
    return { ok: true, created: true, failure: internals.clone(normalized) };
  },

  recordReplan(platformRunId, replan = {}) {
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
    this.invalidateCompletionState(run.id, "task-graph-replanned", {
      invalidateEvidence: true
    });
    const normalized = {
      version: 1,
      id: internals.text(replan.id, 120) || this.createId(),
      failureId: internals.text(replan.failureId, 120),
      agentRunId: internals.text(replan.agentRunId, 120),
      classification: internals.text(replan.classification, 80),
      action: internals.text(replan.action, 120),
      addedTaskIds: (Array.isArray(replan.addedTaskIds) ? replan.addedTaskIds : [])
        .map((item) => internals.text(item, 120)).filter(Boolean).slice(0, 40),
      summary: internals.text(replan.summary, 2000),
      graphRevision: run.taskGraphRevision,
      recordedAt: this.now()
    };
    this.commit("REPLAN_RECORDED", { runId: run.id, replan: normalized });
    return { ok: true, replan: internals.clone(normalized) };
  },

  bindEvidence(platformRunId, binding = {}) {
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
    const criterion = run.criteria.find((item) => item.id === internals.text(binding.criterionId, 120));
    if (!criterion) return { ok: false, code: "platform-evidence-criterion-not-found" };
    const artifact = run.artifacts.find((item) => item.id === internals.text(binding.artifactId, 120));
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
    if (existing) return { ok: true, created: false, evidence: internals.clone(existing) };
    if (run.completionPermit) {
      this.commit("COMPLETION_INVALIDATED", {
        runId: run.id,
        reason: "evidence-set-changed"
      });
    }
    const evidence = {
      version: 1,
      id: internals.text(binding.id, 120) || this.createId(),
      criterionId: criterion.id,
      artifactId: artifact.id,
      sourceAgentRunId: artifact.agentRunId ?? null,
      receiptIds: [...new Set([
        ...(artifact.receiptIds ?? []),
        ...(Array.isArray(binding.receiptIds) ? binding.receiptIds : [])
      ])].map((item) => internals.text(item, 120)).filter(Boolean).slice(0, 80),
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
    return { ok: true, created: true, evidence: internals.clone(evidence) };
  },

  findReusableRun(goalId, goalRevision) {
    return Object.values(this.ensureLoaded().runs)
      .filter((run) =>
        run.goalId === goalId &&
        run.goalRevision === goalRevision &&
        !internals.TERMINAL_RUN_STATUSES.has(run.status)
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
  },

  ensureRun({
    conversationId,
    goalId,
    goalRevision = 1,
    objective,
    criteria = [],
    workspaceId = null,
    mode = "chat"
  } = {}) {
    const normalizedGoalId = internals.text(goalId, 120);
    const normalizedConversationId = internals.text(conversationId, 120);
    if (!normalizedGoalId || !normalizedConversationId || !internals.text(objective, 4000)) {
      return { ok: false, code: "platform-run-input-invalid" };
    }
  
    const revision = Math.max(1, Math.round(Number(goalRevision) || 1));
    const existing = this.findReusableRun(normalizedGoalId, revision);
    if (existing) {
      const normalizedCriteria = internals.normalizeCriteria(criteria);
      if (internals.sha256(existing.criteria ?? []) !== internals.sha256(normalizedCriteria)) {
        this.invalidateCompletionState(existing.id, "goal-criteria-changed", {
          invalidateEvidence: true
        });
        this.commit("RUN_CRITERIA_UPDATED", {
          runId: existing.id,
          criteria: normalizedCriteria
        });
      }
      return { ok: true, created: false, run: internals.clone(this.state.runs[existing.id]) };
    }
  
    const timestamp = this.now();
    const runId = this.createId();
    const run = {
      version: 3,
      id: runId,
      conversationId: normalizedConversationId,
      goalId: normalizedGoalId,
      goalRevision: revision,
      objective: internals.text(objective, 4000),
      workspaceId: internals.text(workspaceId, 120) || null,
      mode: mode === "coding" ? "coding" : "chat",
      status: "active",
      statusReason: "",
      taskGraphRevision: 0,
      taskGraphFingerprint: "",
      criteria: internals.normalizeCriteria(criteria),
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
      executionBridge: createPlatformExecutionBridge({
        platformRunId: runId,
        conversationId: normalizedConversationId,
        goalId: normalizedGoalId,
        workspaceId: internals.text(workspaceId, 120),
        objective: internals.text(objective, 4000),
        status: "active",
        now: timestamp
      }),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.commit("RUN_CREATED", { run });
    return { ok: true, created: true, run: internals.clone(run) };
  },

  setRunStatus(platformRunId, status, reason = "") {
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
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
      return { ok: true, changed: false, run: internals.clone(run) };
    }
    if (!internals.RUN_TRANSITIONS[run.status]?.has(status)) {
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
    return { ok: true, changed: true, run: internals.clone(run) };
  },

  recoverInterruptedRuns() {
    this.ensureLoaded();
    const expiredLeaseIds = this.expireLeases();
    const recoveredAgentRunIds = [];
    const recoveredTaskIds = [];
    const recoveredRunIds = [];
  
    for (const run of Object.values(this.state.runs)) {
      if (internals.TERMINAL_RUN_STATUSES.has(run.status)) continue;
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
      journal: internals.clone(this.journal.loadReport),
      snapshotRecovered: this.lastSnapshotError === null
    };
  },

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
  },

  getRun(platformRunId) {
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
    if (!run) return null;
    const output = internals.clone(run);
    if (output.completionPermit) {
      output.completionPermit = {
        payload: internals.clone(output.completionPermit.payload),
        fingerprint: output.completionPermit.fingerprint
      };
    }
    return output;
  }
};
