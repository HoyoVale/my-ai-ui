import * as internals from "../PlatformKernelInternals.js";

export const PlatformStateProjector = {
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
  
    this.state = snapshotUsable ? snapshot : internals.createEmptyState();
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
      run.criteria = internals.normalizeCriteria(run.criteria);
      run.failures = Array.isArray(run.failures) ? run.failures : [];
      run.replans = Array.isArray(run.replans) ? run.replans : [];
      run.integration = run.integration && typeof run.integration === "object"
        ? run.integration
        : null;
      run.logs = Array.isArray(run.logs) ? run.logs : [];
      run.taskGraphRevision = Math.max(0, Number(run.taskGraphRevision) || 0);
      run.taskGraphFingerprint = internals.text(run.taskGraphFingerprint, 128);
      run.tasks = run.tasks && typeof run.tasks === "object" ? run.tasks : {};
      for (const [taskId, task] of Object.entries(run.tasks)) {
        run.tasks[taskId] = internals.normalizeStoredTask({ ...task, id: taskId });
      }
      run.taskGraphFingerprint = internals.fingerprintTaskGraph(run.tasks);
      run.agentRuns = run.agentRuns && typeof run.agentRuns === "object"
        ? run.agentRuns
        : {};
      for (const agent of Object.values(run.agentRuns)) {
        agent.kind = internals.text(agent.kind, 40) || "worker";
        agent.leaseIds = Array.isArray(agent.leaseIds) ? agent.leaseIds : [];
      }
    }
    this.state.version = 5;
    this.state.jobs = this.state.jobs && typeof this.state.jobs === "object"
      ? this.state.jobs
      : {};
    this.state.approvals = this.state.approvals && typeof this.state.approvals === "object"
      ? this.state.approvals
      : {};
    this.state.notifications = this.state.notifications && typeof this.state.notifications === "object"
      ? this.state.notifications
      : {};
    this.state.lifecycle = this.state.lifecycle && typeof this.state.lifecycle === "object"
      ? {
          online: this.state.lifecycle.online !== false,
          suspended: this.state.lifecycle.suspended === true,
          onBattery: this.state.lifecycle.onBattery === true,
          lastChangedAt: internals.nonNegative(this.state.lifecycle.lastChangedAt, 0),
          lastResumeAt: internals.nonNegative(this.state.lifecycle.lastResumeAt, 0)
        }
      : internals.createEmptyState().lifecycle;
    for (const job of Object.values(this.state.jobs)) {
      job.version = Math.max(2, Number(job.version) || 1);
      job.budget = internals.normalizeBudget(job.budget);
      job.retryPolicy = internals.normalizeRetryPolicy(job.retryPolicy);
      job.wake = internals.normalizeWake(job.wake);
      job.requirements = internals.normalizeJobRequirements(job.requirements);
      job.waitingReason = internals.text(job.waitingReason, 1000);
      job.approvalRequestId = internals.text(job.approvalRequestId, 120) || null;
      job.inputRequest = job.inputRequest && typeof job.inputRequest === "object" ? internals.clone(job.inputRequest) : null;
      job.externalSignal = job.externalSignal && typeof job.externalSignal === "object" ? internals.clone(job.externalSignal) : null;
      job.checkpoint = job.checkpoint && typeof job.checkpoint === "object" ? internals.clone(job.checkpoint) : null;
      job.receipts = Array.isArray(job.receipts) ? job.receipts : [];
      job.logs = Array.isArray(job.logs) ? job.logs : [];
    }
    return this.state;
  },

  applyEvent(event) {
    const state = this.state;
    const payload = event.payload ?? {};
    const run = payload.runId ? state.runs[payload.runId] : null;
  
    switch (event.type) {
      case "RUN_CREATED":
        state.runs[payload.run.id] = internals.clone(payload.run);
        break;
      case "RUN_STATUS_CHANGED":
        if (run) {
          run.status = payload.status;
          run.statusReason = internals.text(payload.reason);
          run.updatedAt = event.timestamp;
        }
        break;
      case "RUN_CRITERIA_UPDATED":
        if (run) {
          run.criteria = internals.clone(payload.criteria);
          run.updatedAt = event.timestamp;
        }
        break;
      case "TASK_GRAPH_ADDED":
        if (run) {
          for (const task of payload.tasks ?? []) {
            run.tasks[task.id] = internals.clone(task);
          }
          run.taskGraphRevision += 1;
          run.taskGraphFingerprint = internals.text(payload.fingerprint, 128);
          run.updatedAt = event.timestamp;
        }
        break;
      case "TASK_ADDED":
        if (run) {
          run.tasks[payload.task.id] = internals.clone(payload.task);
          run.taskGraphRevision += 1;
          run.taskGraphFingerprint = internals.fingerprintTaskGraph(run.tasks);
          run.updatedAt = event.timestamp;
        }
        break;
      case "TASK_STATUS_CHANGED":
        if (run?.tasks[payload.taskId]) {
          const task = run.tasks[payload.taskId];
          task.status = payload.status;
          task.statusReason = internals.text(payload.reason);
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
          run.agentRuns[payload.agentRun.id] = internals.clone(payload.agentRun);
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
          agent.outcome = internals.text(payload.outcome, 120);
          agent.stopReason = internals.text(payload.stopReason, 240);
          agent.error = internals.text(payload.error, 500);
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
          run.tasks[payload.taskId].checkpoint = internals.clone(payload.checkpoint);
          run.updatedAt = event.timestamp;
        }
        break;
      case "AGENT_HANDOFF_RECORDED":
        if (run?.agentRuns[payload.agentRunId]) {
          const agent = run.agentRuns[payload.agentRunId];
          agent.handoff = internals.clone(payload.handoff);
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
          task.evaluation = internals.clone(payload.evaluation);
          task.evaluationHistory = Array.isArray(task.evaluationHistory)
            ? task.evaluationHistory
            : [];
          task.evaluationHistory.push(internals.clone(payload.evaluation));
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
          run.artifacts.push(internals.clone(payload.artifact));
          run.updatedAt = event.timestamp;
        }
        break;
      case "EVIDENCE_BOUND":
        if (run) {
          run.evidence = Array.isArray(run.evidence) ? run.evidence : [];
          run.evidence.push(internals.clone(payload.evidence));
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
              evidence.invalidationReason = internals.text(payload.reason, 500);
            }
          }
          run.updatedAt = event.timestamp;
        }
        break;
      case "FAILURE_RECORDED":
        if (run) {
          run.failures = Array.isArray(run.failures) ? run.failures : [];
          run.failures.push(internals.clone(payload.failure));
          run.updatedAt = event.timestamp;
        }
        break;
      case "REPLAN_RECORDED":
        if (run) {
          run.replans = Array.isArray(run.replans) ? run.replans : [];
          run.replans.push(internals.clone(payload.replan));
          run.updatedAt = event.timestamp;
        }
        break;
      case "RUN_LOG_APPENDED":
        if (run) {
          run.logs = Array.isArray(run.logs) ? run.logs : [];
          run.logs.push(internals.clone(payload.log));
          if (run.logs.length > 1000) run.logs.splice(0, run.logs.length - 1000);
          run.updatedAt = event.timestamp;
        }
        if (state.jobs[payload.jobId]) {
          const job = state.jobs[payload.jobId];
          job.logs = Array.isArray(job.logs) ? job.logs : [];
          job.logs.push(internals.clone(payload.log));
          if (job.logs.length > 400) job.logs.splice(0, job.logs.length - 400);
          job.updatedAt = event.timestamp;
        }
        break;
      case "JOB_ENQUEUED":
        state.jobs[payload.job.id] = internals.clone(payload.job);
        break;
      case "JOB_STATUS_CHANGED":
        if (state.jobs[payload.jobId]) {
          const job = state.jobs[payload.jobId];
          job.status = payload.status;
          job.statusReason = internals.text(payload.reason, 500);
          job.resultSummary = internals.text(payload.resultSummary, 2000);
          job.error = internals.text(payload.error, 2000);
          job.waitingReason = internals.text(payload.waitingReason ?? job.waitingReason, 1000);
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
          job.budget = internals.normalizeBudget({
            ...job.budget,
            tokensUsed: internals.nonNegative(job.budget?.tokensUsed) + internals.nonNegative(payload.tokens),
            stepsUsed: internals.nonNegative(job.budget?.stepsUsed) + internals.nonNegative(payload.steps),
            elapsedMs: internals.nonNegative(job.budget?.elapsedMs) + internals.nonNegative(payload.elapsedMs)
          });
          job.updatedAt = event.timestamp;
        }
        break;
      case "JOB_WAKE_UPDATED":
        if (state.jobs[payload.jobId]) {
          const job = state.jobs[payload.jobId];
          job.wake = internals.normalizeWake(payload.wake);
          job.retryPolicy = internals.normalizeRetryPolicy(payload.retryPolicy ?? job.retryPolicy);
          job.waitingReason = internals.text(payload.waitingReason, 1000);
          job.updatedAt = event.timestamp;
        }
        break;
      case "JOB_INPUT_REQUESTED":
        if (state.jobs[payload.jobId]) {
          state.jobs[payload.jobId].inputRequest = internals.clone(payload.inputRequest);
          state.jobs[payload.jobId].updatedAt = event.timestamp;
        }
        break;
      case "JOB_INPUT_PROVIDED":
        if (state.jobs[payload.jobId]) {
          const job = state.jobs[payload.jobId];
          job.inputRequest = { ...internals.clone(job.inputRequest ?? {}), status: "provided", value: internals.clone(payload.value), providedAt: event.timestamp };
          job.updatedAt = event.timestamp;
        }
        break;
      case "JOB_EXTERNAL_SIGNALLED":
        if (state.jobs[payload.jobId]) {
          state.jobs[payload.jobId].externalSignal = internals.clone(payload.signal);
          state.jobs[payload.jobId].updatedAt = event.timestamp;
        }
        break;
      case "JOB_CHECKPOINT_RECORDED":
        if (state.jobs[payload.jobId]) {
          state.jobs[payload.jobId].checkpoint = internals.clone(payload.checkpoint);
          state.jobs[payload.jobId].updatedAt = event.timestamp;
        }
        break;
      case "JOB_RECEIPT_RECORDED":
        if (state.jobs[payload.jobId]) {
          const job = state.jobs[payload.jobId];
          job.receipts = Array.isArray(job.receipts) ? job.receipts : [];
          if (!job.receipts.some((item) => item.key === payload.receipt.key)) {
            job.receipts.push(internals.clone(payload.receipt));
            if (job.receipts.length > 200) job.receipts.splice(0, job.receipts.length - 200);
          }
          job.updatedAt = event.timestamp;
        }
        break;
      case "APPROVAL_REQUESTED":
        state.approvals[payload.approval.id] = internals.clone(payload.approval);
        if (state.jobs[payload.approval.jobId]) {
          state.jobs[payload.approval.jobId].approvalRequestId = payload.approval.id;
          state.jobs[payload.approval.jobId].updatedAt = event.timestamp;
        }
        break;
      case "APPROVAL_RESOLVED":
        if (state.approvals[payload.approvalId]) {
          const approval = state.approvals[payload.approvalId];
          approval.status = payload.decision === "approved" ? "approved" : "rejected";
          approval.decision = payload.decision;
          approval.note = internals.text(payload.note, 1000);
          approval.resolvedAt = event.timestamp;
        }
        break;
      case "NOTIFICATION_CREATED":
        state.notifications[payload.notification.id] = internals.clone(payload.notification);
        break;
      case "NOTIFICATION_READ":
        if (state.notifications[payload.notificationId]) {
          state.notifications[payload.notificationId].readAt = event.timestamp;
        }
        break;
      case "NOTIFICATION_CLEARED":
        if (state.notifications[payload.notificationId]) {
          state.notifications[payload.notificationId].clearedAt = event.timestamp;
        }
        break;
      case "LIFECYCLE_CHANGED":
        state.lifecycle = { ...state.lifecycle, ...internals.clone(payload.lifecycle), lastChangedAt: event.timestamp };
        if (payload.lifecycle?.suspended === false) state.lifecycle.lastResumeAt = event.timestamp;
        break;
      case "LONG_RUNNING_STATE_PRUNED":
        for (const jobId of payload.jobIds ?? []) delete state.jobs[jobId];
        for (const approvalId of payload.approvalIds ?? []) delete state.approvals[approvalId];
        for (const notificationId of payload.notificationIds ?? []) delete state.notifications[notificationId];
        break;
      case "INTEGRATION_RECORDED":
        if (run) {
          run.integration = internals.clone(payload.integration);
          run.updatedAt = event.timestamp;
        }
        break;
      case "REVIEW_RECORDED":
        if (run) {
          run.reviews = Array.isArray(run.reviews) ? run.reviews : [];
          run.reviews.push(internals.clone(payload.review));
          run.updatedAt = event.timestamp;
        }
        break;
      case "LEASE_ACQUIRED":
        state.leases[payload.lease.id] = internals.clone(payload.lease);
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
          state.leases[payload.leaseId].releaseReason = internals.text(payload.reason);
        }
        break;
      case "COMPLETION_ISSUED":
        if (run) {
          run.completionPermit = internals.clone(payload.permit);
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
  },

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
  },

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
        .map(internals.summarizeRun),
      jobs: Object.values(state.jobs)
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map(internals.summarizeJob),
      approvals: this.listApprovals(),
      notifications: this.listNotifications(),
      lifecycle: internals.clone(state.lifecycle),
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
};
