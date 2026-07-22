import * as internals from "../PlatformKernelInternals.js";

export const PlatformCompletionService = {
  recordArtifact(platformRunId, artifact = {}) {
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
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
    const integrationDigest = internals.text(
      artifact.integrationDigest ?? run.integration?.digest,
      160
    ) || null;
    const receiptIds = (Array.isArray(artifact.receiptIds) ? artifact.receiptIds : [])
      .map((value) => internals.text(value, 120)).filter(Boolean).slice(0, 80);
    const normalized = {
      version: 2,
      id: internals.text(artifact.id, 120) || this.createId(),
      taskId: internals.text(artifact.taskId, 120) || null,
      agentRunId: internals.text(artifact.agentRunId, 120) || null,
      kind: internals.text(artifact.kind, 80) || "worker-output",
      commit: internals.text(artifact.commit, 120) || null,
      digest: internals.text(artifact.digest, 160) || internals.sha256({
        kind: artifact.kind,
        commit: artifact.commit,
        receiptIds,
        integrationDigest,
        summary: artifact.summary
      }),
      summary: internals.text(artifact.summary, 1000),
      source: internals.text(artifact.source, 120) || "platform",
      changed: artifact.changed === true,
      receiptIds,
      integrationDigest,
      goalRevision: run.goalRevision,
      taskGraphRevision: run.taskGraphRevision,
      inputCommits: (Array.isArray(artifact.inputCommits)
        ? artifact.inputCommits
        : [])
        .slice(0, 40)
        .map((value) => internals.text(value, 120))
        .filter(Boolean),
      createdAt: this.now()
    };
    this.commit("ARTIFACT_RECORDED", { runId: run.id, artifact: normalized });
    return { ok: true, artifact: internals.clone(normalized) };
  },

  appendRunLog(platformRunId, {
    jobId = null,
    level = "info",
    source = "platform",
    message = "",
    details = null
  } = {}) {
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
    const normalizedLevel = new Set(["debug", "info", "warn", "error"])
      .has(level) ? level : "info";
    const log = {
      version: 1,
      id: this.createId(),
      level: normalizedLevel,
      source: internals.text(source, 120) || "platform",
      message: internals.text(message, 2000),
      details: details && typeof details === "object" ? internals.clone(details) : null,
      timestamp: this.now()
    };
    this.commit("RUN_LOG_APPENDED", {
      runId: run.id,
      jobId: internals.text(jobId, 120) || null,
      log
    });
    return { ok: true, log: internals.clone(log) };
  },

  recordIntegration(platformRunId, integration = {}) {
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
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
      taskId: internals.text(integration.taskId, 120) || null,
      agentRunId: internals.text(integration.agentRunId, 120) || null,
      worktreeId: internals.text(integration.worktreeId, 120) || null,
      baselineCommit: internals.text(integration.baselineCommit, 120) || null,
      commit: internals.text(integration.commit, 120) || null,
      artifactIds: (Array.isArray(integration.artifactIds)
        ? integration.artifactIds
        : [])
        .slice(0, 80)
        .map((value) => internals.text(value, 120))
        .filter(Boolean),
      inputCommits: (Array.isArray(integration.inputCommits)
        ? integration.inputCommits
        : [])
        .slice(0, 80)
        .map((value) => internals.text(value, 120))
        .filter(Boolean),
      conflicts: (Array.isArray(integration.conflicts)
        ? integration.conflicts
        : [])
        .slice(0, 100)
        .map((value) => internals.text(value, 500))
        .filter(Boolean),
      error: internals.text(integration.error, 2000),
      digest: internals.text(integration.digest, 160) || null,
      recordedAt: this.now()
    };
    const previousBinding = internals.sha256({
      status: run.integration?.status ?? null,
      commit: run.integration?.commit ?? null,
      digest: run.integration?.digest ?? null,
      artifactIds: run.integration?.artifactIds ?? []
    });
    const nextBinding = internals.sha256({
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
    return { ok: true, integration: internals.clone(normalized) };
  },

  recordReview(platformRunId, review = {}) {
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
    if (!run) return { ok: false, code: "platform-run-not-found" };
    this.invalidateCompletionState(run.id, "review-result-changed", {
      invalidateEvidence: false
    });
    const normalized = {
      version: 1,
      id: internals.text(review.id, 120) || this.createId(),
      taskId: internals.text(review.taskId, 120) || null,
      agentRunId: internals.text(review.agentRunId, 120) || null,
      artifactId: internals.text(review.artifactId, 120) || null,
      integrationCommit: internals.text(review.integrationCommit, 120) || null,
      integrationDigest: internals.text(review.integrationDigest, 160) || null,
      status: review.approved === true ? "approved" : "rejected",
      approved: review.approved === true,
      summary: internals.text(review.summary, 2000),
      findings: (Array.isArray(review.findings) ? review.findings : [])
        .slice(0, 80)
        .map((value) => internals.text(value, 1000))
        .filter(Boolean),
      evidence: (Array.isArray(review.evidence) ? review.evidence : [])
        .slice(0, 80)
        .map((value) => internals.text(value, 1000))
        .filter(Boolean),
      reviewerVersion: Math.max(1, Number(review.reviewerVersion) || 1),
      recordedAt: this.now()
    };
    this.commit("REVIEW_RECORDED", { runId: run.id, review: normalized });
    return { ok: true, review: internals.clone(normalized) };
  },

  ensureCriterionEvidence(run, verification, records = [], agentRunId = null) {
    if ((run.criteria ?? []).length === 0) {
      return { ok: true, evidence: [] };
    }
    const checks = new Map(
      (Array.isArray(verification?.checks) ? verification.checks : [])
        .filter((item) => item?.criterionId)
        .map((item) => [internals.text(item.criterionId, 120), item])
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
        .map((value) => internals.text(value, 240)).filter(Boolean);
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
          (internals.text(item.id, 120) === reference || internals.text(item.name, 120) === reference)
        );
        if (record) {
          const artifact = this.recordArtifact(run.id, {
            taskId: this.state.runs[run.id].agentRuns[agentRunId]?.taskId ?? null,
            agentRunId,
            kind: "tool-receipt",
            commit: run.integration?.commit ?? null,
            integrationDigest: run.integration?.digest ?? null,
            receiptIds: [internals.text(record.id, 120) || internals.text(record.name, 120)],
            digest: internals.sha256({
              id: record.id,
              name: record.name,
              status: record.status,
              input: record.input ?? null,
              output: record.result ?? record.output ?? null
            }),
            summary: `${internals.text(record.name, 120)}: ${internals.text(record.status, 40)}`,
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
          digest: internals.sha256({
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
  },

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
      : internals.sha256({
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
      evidenceHash: internals.sha256({
        criteria: run.criteria,
        evidence: validEvidence
      }),
      artifactManifestHash: internals.sha256(artifacts),
      taskGraphHash: internals.sha256({
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
      reviewHash: internals.sha256(latestReview),
      validEvidence,
      latestReview
    };
  },

  authorizeCompletion({
    platformRunId,
    agentRunId,
    verification,
    records = []
  } = {}) {
    const run = this.ensureLoaded().runs[internals.text(platformRunId, 120)];
    const agent = run?.agentRuns[internals.text(agentRunId, 120)];
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
    const platformVerification = internals.clone(verification);
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
      permit: internals.clone(permit),
      verification: platformVerification,
      evidence: internals.clone(binding.validEvidence)
    };
  },

  verifyCompletionPermit(permit, expected = {}) {
    const verified = this.completionAuthority.verify(permit, expected);
    if (!verified.ok) return verified;
    const run = this.ensureLoaded().runs[internals.text(expected.platformRunId, 120)];
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
};
