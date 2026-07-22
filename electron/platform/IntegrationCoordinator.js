import crypto from "node:crypto";

import {
  sha256
} from "./canonical.js";

function text(value, limit = 1000) {
  return String(value ?? "").trim().slice(0, limit);
}

function list(value, limit = 80) {
  return (Array.isArray(value) ? value : [])
    .slice(0, limit)
    .map((item) => text(item, 1000))
    .filter(Boolean);
}

function parseJsonObject(value) {
  const source = text(value, 20_000);
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1];
  const candidates = [fenced, source];
  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(source.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Try the next bounded representation.
    }
  }
  return null;
}

export function normalizeReviewDecision(result) {
  const source = result && typeof result === "object" ? result : {};
  const parsed = typeof source.approved === "boolean"
    ? source
    : parseJsonObject(source.summary ?? source.text ?? "");
  if (!parsed || typeof parsed.approved !== "boolean") {
    return {
      ok: false,
      approved: false,
      summary: "Reviewer 未返回有效的结构化审查结论。",
      findings: ["review-output-invalid"],
      evidence: []
    };
  }
  return {
    ok: source.ok !== false && !(parsed.approved === true && list(parsed.evidence ?? source.evidence).length === 0),
    approved: parsed.approved === true && list(parsed.evidence ?? source.evidence).length > 0,
    summary: text(parsed.summary ?? source.summary, 2000),
    findings: parsed.approved === true && list(parsed.evidence ?? source.evidence).length === 0
      ? [...list(parsed.findings), "review-evidence-missing"]
      : list(parsed.findings),
    evidence: list(parsed.evidence ?? source.evidence)
  };
}

export class IntegrationCoordinator {
  constructor({
    platformKernel,
    worktreeRuntime,
    reviewerRuntime,
    getWorkspaceRoot,
    createId = () => crypto.randomUUID()
  } = {}) {
    if (!platformKernel || !worktreeRuntime || !reviewerRuntime) {
      throw new TypeError(
        "IntegrationCoordinator requires PlatformKernel, WorktreeRuntime and reviewerRuntime."
      );
    }
    this.platformKernel = platformKernel;
    this.worktreeRuntime = worktreeRuntime;
    this.reviewerRuntime = reviewerRuntime;
    this.getWorkspaceRoot = typeof getWorkspaceRoot === "function"
      ? getWorkspaceRoot
      : () => "";
    this.createId = createId;
    this.running = new Map();
  }

  candidates(run) {
    return run.artifacts
      .filter((artifact) => {
        const agent = run.agentRuns[artifact.agentRunId];
        const task = run.tasks[artifact.taskId];
        return artifact.kind === "git-commit" &&
          artifact.changed === true &&
          agent?.role === "implementer" &&
          agent.status === "completed" &&
          task?.evaluation?.approved === true &&
          task?.evaluation?.workerAgentRunId === agent.id &&
          task?.evaluation?.handoffFingerprint === agent.handoff?.fingerprint &&
          task?.integrationStatus === "eligible";
      })
      .sort((left, right) => {
        const leftTask = run.tasks[left.taskId];
        const rightTask = run.tasks[right.taskId];
        return Number(leftTask?.createdAt ?? left.createdAt ?? 0) -
          Number(rightTask?.createdAt ?? right.createdAt ?? 0) ||
          String(left.taskId ?? left.id).localeCompare(
            String(right.taskId ?? right.id)
          );
      });
  }

  async integrateAndReview(
    platformRunId,
    {
      signal = null,
      onUsage = null
    } = {}
  ) {
    if (this.running.has(platformRunId)) {
      return this.running.get(platformRunId);
    }
    const execution = this.execute(
      platformRunId,
      { signal, onUsage }
    )
      .finally(() => this.running.delete(platformRunId));
    this.running.set(platformRunId, execution);
    return execution;
  }

  async execute(
    platformRunId,
    {
      signal = null,
      onUsage = null
    } = {}
  ) {
    let run = this.platformKernel.getRun(platformRunId);
    if (!run) return { ok: false, code: "platform-run-not-found" };
    const artifacts = this.candidates(run);
    if (artifacts.length === 0) {
      const recorded = this.platformKernel.recordIntegration(run.id, {
        status: "not-required",
        artifactIds: []
      });
      return { ok: true, required: false, integration: recorded.integration };
    }

    const artifactIds = artifacts.map((item) => item.id);
    const inputCommits = artifacts.map((item) => item.commit).filter(Boolean);
    const previous = run.integration;
    if (
      ["integrated", "published"].includes(previous?.status) &&
      previous.artifactIds?.length === artifactIds.length &&
      previous.artifactIds.every((id, index) => id === artifactIds[index])
    ) {
      const approved = [...run.reviews].reverse().find((review) =>
        review.approved === true &&
        review.integrationCommit === previous.commit &&
        review.integrationDigest === previous.digest
      );
      if (approved) {
        return {
          ok: true,
          required: true,
          integration: previous,
          review: approved,
          reused: true
        };
      }
    }

    const workspaceRoot = this.getWorkspaceRoot(run);
    if (!workspaceRoot) {
      this.platformKernel.recordIntegration(run.id, {
        status: "failed",
        artifactIds,
        inputCommits,
        error: "workspace-unavailable"
      });
      return { ok: false, code: "integration-workspace-unavailable" };
    }

    const suffix = sha256({ artifactIds, inputCommits }).slice(0, 12);
    const baseIntegrationTaskId = `integration-${suffix}`;
    const retryNumber = run.tasks[baseIntegrationTaskId]?.status === "completed"
      ? Math.max(1, run.reviews.length)
      : 0;
    const retryTag = retryNumber > 0 ? `-r${retryNumber}` : "";
    const integrationTaskId = `${baseIntegrationTaskId}${retryTag}`;
    const integrationTask = this.platformKernel.addTask(run.id, {
      taskId: integrationTaskId,
      title: "集成 Worker 变更",
      role: "integrator",
      dependencies: [...new Set(artifacts.map((item) => item.taskId).filter(Boolean))],
      maxAttempts: 1
    });
    if (!integrationTask.ok) return integrationTask;

    const integratorAgentId = this.createId();
    const begun = this.platformKernel.beginAgentRun({
      platformRunId: run.id,
      agentRunId: integratorAgentId,
      taskId: integrationTaskId,
      role: "integrator"
    });
    if (!begun.ok) return begun;

    const created = this.worktreeRuntime.create({
      platformRunId: run.id,
      agentRunId: integratorAgentId,
      taskId: integrationTaskId,
      workspaceRoot,
      role: "integrator",
      writable: true
    });
    if (!created.ok) {
      this.platformKernel.finishAgentRun(run.id, integratorAgentId, {
        status: "failed",
        error: created.code,
        stopReason: "integration-worktree-failed",
        taskStatus: "failed"
      });
      return created;
    }
    this.platformKernel.attachAgentWorktree(
      run.id,
      integratorAgentId,
      created.worktree.id
    );
    this.platformKernel.recordIntegration(run.id, {
      status: "running",
      taskId: integrationTaskId,
      agentRunId: integratorAgentId,
      worktreeId: created.worktree.id,
      baselineCommit: created.worktree.baselineCommit,
      artifactIds,
      inputCommits
    });

    const integrated = this.worktreeRuntime.integrateCommits(
      created.worktree.id,
      inputCommits,
      `Integrate ${inputCommits.length} Worker change${inputCommits.length === 1 ? "" : "s"}`
    );
    if (!integrated.ok) {
      this.platformKernel.recordIntegration(run.id, {
        status: integrated.code === "integration-conflict"
          ? "conflicted"
          : "failed",
        taskId: integrationTaskId,
        agentRunId: integratorAgentId,
        worktreeId: created.worktree.id,
        baselineCommit: created.worktree.baselineCommit,
        artifactIds,
        inputCommits,
        conflicts: integrated.conflicts,
        error: integrated.error || integrated.code
      });
      this.worktreeRuntime.release(created.worktree.id, {
        reason: integrated.code,
        remove: true
      });
      this.platformKernel.finishAgentRun(run.id, integratorAgentId, {
        status: "failed",
        error: integrated.error || integrated.code,
        stopReason: integrated.code,
        taskStatus: "blocked"
      });
      return {
        ok: false,
        code: integrated.code,
        conflicts: integrated.conflicts ?? []
      };
    }

    const digest = sha256({
      runId: run.id,
      baselineCommit: integrated.baselineCommit,
      commit: integrated.commit,
      artifactIds,
      inputCommits
    });
    const integrationRecord = this.platformKernel.recordIntegration(run.id, {
      status: "integrated",
      taskId: integrationTaskId,
      agentRunId: integratorAgentId,
      worktreeId: created.worktree.id,
      baselineCommit: integrated.baselineCommit,
      commit: integrated.commit,
      artifactIds,
      inputCommits,
      digest
    }).integration;
    this.platformKernel.recordArtifact(run.id, {
      taskId: integrationTaskId,
      agentRunId: integratorAgentId,
      kind: "integration-result",
      commit: integrated.commit,
      changed: integrated.changed === true,
      inputCommits,
      digest,
      summary: `已集成 ${inputCommits.length} 个 Worker 提交。`
    });
    this.platformKernel.recordAgentHandoff(run.id, integratorAgentId, {
      inputRevision: run.taskGraphRevision,
      outputCommit: integrated.commit,
      summary: `按队列集成 ${inputCommits.length} 个提交。`,
      evidence: [`integration:${digest}`],
      unresolved: []
    });
    this.platformKernel.finishAgentRun(run.id, integratorAgentId, {
      status: "completed",
      outcome: "integrated",
      stopReason: "integration-completed",
      taskStatus: "completed"
    });
    this.worktreeRuntime.release(created.worktree.id, {
      reason: "integration-completed",
      remove: true
    });

    run = this.platformKernel.getRun(run.id);
    if (signal?.aborted) {
      return {
        ok: false,
        code: "integration-review-cancelled"
      };
    }
    const reviewTaskId = `review-${suffix}${retryTag}`;
    const reviewTask = this.platformKernel.addTask(run.id, {
      taskId: reviewTaskId,
      title: "独立审查集成结果",
      role: "reviewer",
      dependencies: [integrationTaskId],
      instructions: [
        `审查集成提交 ${integrated.commit}。`,
        `输入 Worker 提交：${inputCommits.join(", ")}`,
        "检查最终 diff 是否越界、是否遗漏需求、验证证据是否充分。"
      ].join("\n"),
      maxAttempts: 1
    });
    if (!reviewTask.ok) return reviewTask;

    const reviewerModel = this.reviewerRuntime.resolveModel();
    const reviewerAgentId = this.createId();
    const reviewBegun = this.platformKernel.beginAgentRun({
      platformRunId: run.id,
      agentRunId: reviewerAgentId,
      taskId: reviewTaskId,
      role: "reviewer",
      modelSelection: {
        providerId: reviewerModel.providerId,
        modelConfigId: reviewerModel.modelConfigId
      }
    });
    if (!reviewBegun.ok) return reviewBegun;
    const reviewTree = this.worktreeRuntime.create({
      platformRunId: run.id,
      agentRunId: reviewerAgentId,
      taskId: reviewTaskId,
      workspaceRoot,
      role: "reviewer",
      writable: false,
      baselineCommit: integrated.commit
    });
    if (!reviewTree.ok) {
      this.platformKernel.finishAgentRun(run.id, reviewerAgentId, {
        status: "failed",
        error: reviewTree.code,
        stopReason: "review-worktree-failed",
        taskStatus: "failed"
      });
      return reviewTree;
    }
    this.platformKernel.attachAgentWorktree(
      run.id,
      reviewerAgentId,
      reviewTree.worktree.id
    );

    let rawReview;
    try {
      rawReview = await this.reviewerRuntime.execute({
        run,
        task: this.platformKernel.getRun(run.id).tasks[reviewTaskId],
        agentRun: this.platformKernel.getRun(run.id).agentRuns[reviewerAgentId],
        worktree: reviewTree.worktree,
        signal: signal ?? new AbortController().signal,
        onUsage
      });
    } catch (error) {
      rawReview = {
        ok: false,
        summary: "",
        error: error instanceof Error ? error.message : String(error)
      };
    }
    if (
      typeof onUsage === "function" &&
      rawReview?.usage?.reported !== true
    ) {
      onUsage({
        tokens: Math.max(0, Number(rawReview?.usage?.totalTokens) || 0),
        steps: Math.max(1, Number(rawReview?.usage?.steps) || 0)
      });
    }
    let decision = normalizeReviewDecision(rawReview);
    const reviewCheckpoint = this.worktreeRuntime.checkpoint(
      reviewTree.worktree.id,
      "Reviewer read-only verification"
    );
    if (reviewCheckpoint.ok && reviewCheckpoint.changed) {
      decision = {
        ok: false,
        approved: false,
        summary: "Reviewer 修改了只读工作区，审查结果已拒绝。",
        findings: ["reviewer-read-only-violation"],
        evidence: []
      };
    }
    const reviewArtifact = this.platformKernel.recordArtifact(run.id, {
      taskId: reviewTaskId,
      agentRunId: reviewerAgentId,
      kind: "independent-review",
      commit: integrated.commit,
      integrationDigest: digest,
      receiptIds: decision.evidence,
      changed: false,
      digest: sha256({
        integrationCommit: integrated.commit,
        integrationDigest: digest,
        approved: decision.approved,
        findings: decision.findings,
        evidence: decision.evidence
      }),
      summary: decision.summary,
      source: "reviewer"
    }).artifact;
    const recordedReview = this.platformKernel.recordReview(run.id, {
      taskId: reviewTaskId,
      agentRunId: reviewerAgentId,
      artifactId: reviewArtifact.id,
      integrationCommit: integrated.commit,
      integrationDigest: digest,
      approved: decision.approved,
      summary: decision.summary,
      findings: decision.findings,
      evidence: decision.evidence,
      reviewerVersion: 1
    }).review;
    this.platformKernel.recordAgentHandoff(run.id, reviewerAgentId, {
      inputRevision: run.taskGraphRevision,
      outputCommit: integrated.commit,
      summary: decision.summary,
      evidence: decision.evidence,
      unresolved: decision.approved ? [] : decision.findings
    });
    this.worktreeRuntime.release(reviewTree.worktree.id, {
      reason: decision.approved ? "review-approved" : "review-rejected",
      remove: true
    });
    this.platformKernel.finishAgentRun(run.id, reviewerAgentId, {
      status: decision.ok ? "completed" : "failed",
      outcome: decision.approved ? "approved" : "rejected",
      stopReason: decision.approved ? "review-approved" : "review-rejected",
      error: decision.ok ? "" : decision.summary,
      taskStatus: decision.ok ? "completed" : "failed"
    });
    if (decision.approved) {
      const publication = this.worktreeRuntime.publishIntegration({
        workspaceRoot,
        baselineCommit: integrated.baselineCommit,
        integrationCommit: integrated.commit
      });
      if (!publication.ok) {
        const failedIntegration = this.platformKernel.recordIntegration(run.id, {
          ...integrationRecord,
          status: publication.code === "integration-target-changed"
            ? "conflicted"
            : "failed",
          conflicts: publication.code === "integration-target-changed"
            ? ["用户工作区在集成期间发生变化"]
            : [],
          error: publication.error || publication.code
        }).integration;
        const latest = this.platformKernel.getRun(run.id);
        if (latest.status === "active") {
          this.platformKernel.setRunStatus(
            run.id,
            "continuable",
            publication.code
          );
        }
        return {
          ok: false,
          required: true,
          integration: failedIntegration,
          review: recordedReview,
          code: publication.code
        };
      }
      const publishedIntegration = this.platformKernel.recordIntegration(run.id, {
        ...integrationRecord,
        status: "published"
      }).integration;
      this.platformKernel.recordArtifact(run.id, {
        taskId: integrationTaskId,
        agentRunId: integratorAgentId,
        kind: "workspace-publication",
        commit: integrated.commit,
        changed: publication.changed,
        inputCommits,
        digest,
        summary: "已将审查通过的集成差异发布到用户工作区。"
      });
      return {
        ok: true,
        required: true,
        integration: publishedIntegration,
        review: recordedReview,
        code: null
      };
    }
    if (!decision.approved) {
      const latest = this.platformKernel.getRun(run.id);
      if (latest.status === "active") {
        this.platformKernel.setRunStatus(
          run.id,
          "continuable",
          "independent-review-rejected"
        );
      }
    }
    return {
      ok: false,
      required: true,
      integration: integrationRecord,
      review: recordedReview,
      code: "independent-review-rejected"
    };
  }
}
