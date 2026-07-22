import crypto from "node:crypto";

import {
  classifyPlatformFailure
} from "./FailureClassifier.js";

function repairTitle(classification) {
  return ({
    implementation: "修复实现失败",
    test: "修复验证失败并重新运行验证",
    environment: "诊断并恢复执行环境",
    conflict: "显式解决集成冲突",
    evidence: "补充缺失的验收证据",
    requirements: "等待需求澄清"
  })[classification.type] ?? "处理执行失败";
}

export class IndependentReplanner {
  constructor({
    platformKernel,
    createId = () => crypto.randomUUID(),
    maxReplans = 4
  } = {}) {
    if (!platformKernel) {
      throw new TypeError("IndependentReplanner requires PlatformKernel.");
    }
    this.platformKernel = platformKernel;
    this.createId = createId;
    this.maxReplans = Math.max(1, Math.min(12, Number(maxReplans) || 4));
  }

  replan(platformRunId, failureInput = {}) {
    const run = this.platformKernel.getRun(platformRunId);
    if (!run) return { ok: false, code: "platform-run-not-found" };
    const classification = failureInput.type
      ? failureInput
      : classifyPlatformFailure(failureInput);
    const failure = this.platformKernel.recordFailure(run.id, classification);
    if (!failure.ok) return failure;
    const current = this.platformKernel.getRun(run.id);
    const existing = (current.replans ?? []).find((item) =>
      item.failureId === failure.failure.id
    );
    if (existing) {
      return { ok: true, reused: true, classification, failure: failure.failure, replan: existing };
    }
    if ((current.replans ?? []).length >= this.maxReplans) {
      this.platformKernel.setRunStatus(run.id, "blocked", "replan-limit-reached");
      return { ok: false, code: "platform-replan-limit", classification, failure: failure.failure };
    }

    const suffix = failure.failure.id.replace(/[^a-z0-9]/giu, "").slice(-20) || this.createId().slice(0, 12);
    const replannerTaskId = `replan-${suffix}`;
    const replannerTask = this.platformKernel.addTask(run.id, {
      taskId: replannerTaskId,
      title: `独立重规划：${repairTitle(classification)}`,
      role: "replanner",
      instructions: [
        `Failure type: ${classification.type}`,
        `Failure code: ${classification.code}`,
        `Required action: ${classification.action}`,
        classification.summary
      ].filter(Boolean).join("\n"),
      maxAttempts: 1
    });
    if (!replannerTask.ok) return replannerTask;
    const replannerAgentId = this.createId();
    const begun = this.platformKernel.beginAgentRun({
      platformRunId: run.id,
      agentRunId: replannerAgentId,
      taskId: replannerTaskId,
      role: "replanner"
    });
    if (!begun.ok) return begun;

    const repairTaskId = `repair-${suffix}`;
    const repair = this.platformKernel.addTask(run.id, {
      taskId: repairTaskId,
      title: repairTitle(classification),
      role: classification.nextRole,
      dependencies: [replannerTaskId],
      instructions: [
        `处理失败 ${failure.failure.id}，类型 ${classification.type}。`,
        classification.summary,
        classification.conflicts?.length > 0
          ? `冲突项：${classification.conflicts.join("、")}`
          : "",
        classification.requiresUserInput
          ? "不得猜测缺失需求；等待用户明确后再继续。"
          : "修复后必须重新生成与当前结果绑定的证据。"
      ].filter(Boolean).join("\n"),
      maxAttempts: classification.retryable ? 2 : 1
    });
    if (!repair.ok) {
      this.platformKernel.finishAgentRun(run.id, replannerAgentId, {
        status: "failed",
        error: repair.code,
        stopReason: "replan-task-invalid",
        taskStatus: "failed"
      });
      return repair;
    }

    const recorded = this.platformKernel.recordReplan(run.id, {
      failureId: failure.failure.id,
      agentRunId: replannerAgentId,
      classification: classification.type,
      action: classification.action,
      addedTaskIds: [repairTaskId],
      summary: `${repairTitle(classification)}；Task Graph 已修订。`
    });
    this.platformKernel.recordAgentHandoff(run.id, replannerAgentId, {
      inputRevision: run.taskGraphRevision,
      summary: recorded.replan.summary,
      evidence: [`failure:${failure.failure.id}`, `replan:${recorded.replan.id}`],
      unresolved: classification.requiresUserInput ? [classification.summary || classification.code] : []
    });
    this.platformKernel.finishAgentRun(run.id, replannerAgentId, {
      status: "completed",
      outcome: "task-graph-revised",
      stopReason: "replan-recorded",
      taskStatus: "completed"
    });

    if (classification.requiresUserInput || classification.type === "conflict") {
      this.platformKernel.setTaskStatus(run.id, repairTaskId, "blocked", classification.action);
      const latest = this.platformKernel.getRun(run.id);
      if (["active", "continuable"].includes(latest.status)) {
        this.platformKernel.setRunStatus(run.id, "blocked", classification.action);
      }
    } else {
      const latest = this.platformKernel.getRun(run.id);
      if (["continuable", "failed", "blocked"].includes(latest.status)) {
        this.platformKernel.setRunStatus(run.id, "active", "replan-ready");
      }
    }

    return {
      ok: true,
      classification,
      failure: failure.failure,
      replan: recorded.replan,
      repairTask: this.platformKernel.getRun(run.id).tasks[repairTaskId]
    };
  }
}
