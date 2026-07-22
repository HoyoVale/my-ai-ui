import crypto from "node:crypto";

import {
  validateStructuredHandoff
} from "./StructuredHandoff.js";

export class DeterministicTaskEvaluator {
  constructor({
    platformKernel,
    createId = () => crypto.randomUUID()
  } = {}) {
    if (!platformKernel) {
      throw new TypeError("DeterministicTaskEvaluator requires PlatformKernel.");
    }
    this.platformKernel = platformKernel;
    this.createId = createId;
  }

  async evaluate(platformRunId, taskId, workerAgentRunId) {
    const run = this.platformKernel.getRun(platformRunId);
    const task = run?.tasks?.[taskId];
    const worker = run?.agentRuns?.[workerAgentRunId];
    if (!run || !task || !worker) {
      return { ok: false, code: "task-evaluation-input-missing" };
    }
    const checked = validateStructuredHandoff(worker.handoff, {
      run,
      task,
      agentRun: worker
    });
    const evaluatorAgentRunId = this.createId();
    const begun = this.platformKernel.beginAgentRun({
      platformRunId: run.id,
      agentRunId: evaluatorAgentRunId,
      taskId: task.id,
      role: "evaluator",
      kind: "evaluator",
      modelSelection: {
        providerId: "deterministic",
        modelConfigId: "task-contract-v1"
      }
    });
    if (!begun.ok) return begun;

    const handoff = checked.handoff;
    const claims = new Map(
      (handoff?.acceptanceClaims ?? []).map((item) => [item.criterionId, item])
    );
    const missing = (task.acceptanceCriteria ?? []).filter((criterion) => {
      const claim = claims.get(criterion.id);
      return !claim || claim.passed !== true || claim.evidence.length === 0;
    });
    const approved =
      checked.ok &&
      handoff.status === "ready_for_evaluation" &&
      !handoff.error &&
      handoff.unresolved.length === 0 &&
      missing.length === 0;
    const findings = [
      ...(checked.ok ? [] : [checked.code]),
      ...(handoff?.unresolved ?? []),
      ...missing.map((criterion) => `acceptance-criterion-unverified:${criterion.id}`)
    ];
    const criteria = (task.acceptanceCriteria ?? []).map((criterion) => {
      const claim = claims.get(criterion.id);
      return {
        criterionId: criterion.id,
        passed: claim?.passed === true,
        evidence: claim?.evidence ?? [],
        note: claim?.note ?? ""
      };
    });
    const summary = approved
      ? "结构化 Handoff 与任务边界校验通过。"
      : `结构化 Handoff 验收失败：${findings.join(", ") || "unknown"}`;
    const evaluation = this.platformKernel.recordTaskEvaluation(run.id, task.id, {
      attempt: begun.agentRun.attempt,
      approved,
      evaluatorAgentRunId,
      workerAgentRunId,
      handoffFingerprint: handoff?.fingerprint,
      taskGraphRevision: run.taskGraphRevision,
      summary,
      findings,
      evidence: [
        ...(handoff?.evidence ?? []),
        ...(handoff?.receipts ?? [])
      ],
      criteria
    }).evaluation;
    this.platformKernel.recordAgentHandoff(run.id, evaluatorAgentRunId, {
      inputRevision: run.taskGraphRevision,
      outputCommit: handoff?.outputCommit ?? null,
      summary,
      evidence: evaluation.evidence,
      unresolved: approved ? [] : findings
    });
    this.platformKernel.finishAgentRun(run.id, evaluatorAgentRunId, {
      status: "completed",
      outcome: approved ? "approved" : "rejected",
      stopReason: approved ? "task-evaluation-approved" : "task-evaluation-rejected",
      taskStatus: approved ? "completed" : "continuable"
    });
    return {
      ok: approved,
      approved,
      code: approved ? null : checked.code ?? "task-evaluation-rejected",
      evaluatorAgentRunId,
      workerAgentRunId,
      evaluation,
      task: this.platformKernel.getRun(run.id).tasks[task.id]
    };
  }
}
