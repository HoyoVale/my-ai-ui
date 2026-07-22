import crypto from "node:crypto";

import {
  validateStructuredHandoff
} from "./StructuredHandoff.js";

import {
  defaultCapabilitiesForRole
} from "./TaskGraphContract.js";

function text(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function extractJsonObject(value) {
  const source = text(value, 20_000);
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch {
    // Continue with a fenced/balanced object extraction.
  }
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1];
  if (fenced) {
    try {
      return JSON.parse(fenced.trim());
    } catch {
      // Continue with the first/last brace fallback.
    }
  }
  const first = source.indexOf("{");
  const last = source.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(source.slice(first, last + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeCriteria(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((item) => ({
      criterionId: text(item?.criterionId ?? item?.id, 120),
      passed: item?.passed === true,
      evidence: (Array.isArray(item?.evidence) ? item.evidence : [])
        .map((value) => text(value, 500)).filter(Boolean).slice(0, 20),
      note: text(item?.note ?? item?.summary, 500)
    }))
    .filter((item) => item.criterionId)
    .slice(0, 32);
}

function normalizeDecision(raw, task, handoff) {
  const source = raw?.evaluation && typeof raw.evaluation === "object"
    ? raw.evaluation
    : extractJsonObject(raw?.summary ?? raw?.text) ?? {};
  const criteria = normalizeCriteria(
    source.criteria ?? source.acceptance ?? handoff.acceptanceClaims
  );
  const criterionMap = new Map(criteria.map((item) => [item.criterionId, item]));
  const missingCriteria = (task.acceptanceCriteria ?? [])
    .filter((criterion) => {
      const result = criterionMap.get(criterion.id);
      return !result || result.passed !== true || result.evidence.length === 0;
    })
    .map((criterion) => criterion.id);
  const findings = [
    ...(Array.isArray(source.findings) ? source.findings : []),
    ...(Array.isArray(raw?.unresolved) ? raw.unresolved : []),
    ...handoff.unresolved,
    ...missingCriteria.map((id) => `acceptance-criterion-unverified:${id}`)
  ].map((item) => text(item, 500)).filter(Boolean).slice(0, 40);
  const explicitDecision = typeof source.approved === "boolean"
    ? source.approved
    : null;
  const deterministicReady =
    handoff.status === "ready_for_evaluation" &&
    !handoff.error &&
    handoff.unresolved.length === 0 &&
    missingCriteria.length === 0;
  const approved = explicitDecision === false
    ? false
    : explicitDecision === true
      ? deterministicReady
      : deterministicReady;
  return {
    approved,
    summary: text(
      source.summary ?? raw?.summary ??
      (approved ? "任务级独立验收通过。" : "任务级独立验收未通过。"),
      2000
    ),
    findings,
    evidence: [
      ...(Array.isArray(source.evidence) ? source.evidence : []),
      ...criteria.flatMap((item) => item.evidence),
      ...handoff.evidence,
      ...handoff.receipts
    ].map((item) => text(item, 500)).filter(Boolean).slice(0, 60),
    criteria,
    source: explicitDecision === null ? "deterministic" : "independent-model"
  };
}

export class IndependentTaskEvaluator {
  constructor({
    platformKernel,
    worktreeRuntime,
    evaluatorRuntime,
    getWorkspaceRoot,
    createId = () => crypto.randomUUID()
  } = {}) {
    if (!platformKernel || !worktreeRuntime || !evaluatorRuntime) {
      throw new TypeError(
        "IndependentTaskEvaluator requires PlatformKernel, WorktreeRuntime and EvaluatorRuntime."
      );
    }
    this.platformKernel = platformKernel;
    this.worktreeRuntime = worktreeRuntime;
    this.evaluatorRuntime = evaluatorRuntime;
    this.getWorkspaceRoot = typeof getWorkspaceRoot === "function"
      ? getWorkspaceRoot
      : () => "";
    this.createId = createId;
  }

  async evaluate(platformRunId, taskId, workerAgentRunId, {
    signal = null,
    onUsage = null
  } = {}) {
    let run = this.platformKernel.getRun(platformRunId);
    const task = run?.tasks?.[taskId];
    const worker = run?.agentRuns?.[workerAgentRunId];
    if (!run || !task || !worker) {
      return { ok: false, code: "task-evaluation-input-missing" };
    }
    if (task.status !== "review") {
      return { ok: false, code: "task-evaluation-status-invalid", status: task.status };
    }
    const handoffValidation = validateStructuredHandoff(worker.handoff, {
      run,
      task,
      agentRun: worker
    });
    if (!handoffValidation.ok) {
      const evaluation = this.platformKernel.recordTaskEvaluation(run.id, task.id, {
        approved: false,
        workerAgentRunId: worker.id,
        handoffFingerprint: worker.handoff?.fingerprint,
        taskGraphRevision: run.taskGraphRevision,
        summary: `Handoff 校验失败：${handoffValidation.code}`,
        findings: [handoffValidation.code]
      }).evaluation;
      this.platformKernel.setTaskStatus(run.id, task.id, "continuable", handoffValidation.code);
      return { ok: false, approved: false, code: handoffValidation.code, evaluation };
    }
    const handoff = handoffValidation.handoff;
    const workspaceRoot = this.getWorkspaceRoot(run);
    if (!workspaceRoot) {
      this.platformKernel.setTaskStatus(run.id, task.id, "blocked", "workspace-unavailable");
      return { ok: false, code: "task-evaluator-workspace-unavailable" };
    }

    const evaluatorAgentRunId = this.createId();
    const model = this.evaluatorRuntime.resolveModel();
    const begun = this.platformKernel.beginAgentRun({
      platformRunId: run.id,
      agentRunId: evaluatorAgentRunId,
      taskId: task.id,
      role: "evaluator",
      kind: "evaluator",
      modelSelection: {
        providerId: model.providerId,
        modelConfigId: model.modelConfigId
      }
    });
    if (!begun.ok) return begun;

    const created = this.worktreeRuntime.create({
      platformRunId: run.id,
      agentRunId: evaluatorAgentRunId,
      taskId: task.id,
      workspaceRoot,
      role: "evaluator",
      writable: false,
      baselineCommit: handoff.outputCommit ?? handoff.baselineCommit
    });
    if (!created.ok) {
      this.platformKernel.finishAgentRun(run.id, evaluatorAgentRunId, {
        status: "failed",
        error: created.code,
        stopReason: "evaluation-worktree-failed",
        taskStatus: "continuable"
      });
      return created;
    }
    this.platformKernel.attachAgentWorktree(run.id, evaluatorAgentRunId, created.worktree.id);

    let raw;
    try {
      raw = await this.evaluatorRuntime.execute({
        run,
        task: {
          ...task,
          role: "evaluator",
          requiredCapabilities: defaultCapabilitiesForRole("evaluator"),
          workspaceScope: {
            ...(task.workspaceScope ?? {}),
            writable: false
          },
          instructions: [
            task.instructions,
            "独立检查 Worker 的结构化 Handoff 与实际隔离提交。",
            `Acceptance criteria: ${JSON.stringify(task.acceptanceCriteria ?? [])}`,
            `Structured handoff: ${JSON.stringify(handoff)}`
          ].filter(Boolean).join("\n\n")
        },
        agentRun: this.platformKernel.getRun(run.id).agentRuns[evaluatorAgentRunId],
        worktree: created.worktree,
        signal: signal ?? new AbortController().signal,
        onUsage
      });
    } catch (error) {
      raw = {
        ok: false,
        summary: "",
        error: error instanceof Error ? error.message : String(error),
        unresolved: ["evaluator-runtime-failed"]
      };
    }
    if (typeof onUsage === "function" && raw?.usage?.reported !== true) {
      onUsage({
        tokens: Math.max(0, Number(raw?.usage?.totalTokens) || 0),
        steps: Math.max(1, Number(raw?.usage?.steps) || 0)
      });
    }

    let decision = normalizeDecision(raw, task, handoff);
    if (signal?.aborted) {
      decision = {
        ...decision,
        approved: false,
        summary: "Evaluator 在完成验收前被中断。",
        findings: [
          ...decision.findings,
          `evaluator-aborted:${text(signal.reason, 300) || "unknown"}`
        ]
      };
    }
    const checkpoint = this.worktreeRuntime.checkpoint(
      created.worktree.id,
      "Evaluator read-only verification"
    );
    if (checkpoint.ok && checkpoint.changed) {
      decision = {
        ...decision,
        approved: false,
        summary: "Evaluator 修改了只读工作区，验收结果已拒绝。",
        findings: [...decision.findings, "evaluator-read-only-violation"]
      };
    }
    if (raw?.ok === false) {
      decision = {
        ...decision,
        approved: false,
        findings: [...decision.findings, text(raw.error, 500) || "evaluator-runtime-failed"]
      };
    }

    const evaluation = this.platformKernel.recordTaskEvaluation(run.id, task.id, {
      attempt: begun.agentRun.attempt,
      approved: decision.approved,
      evaluatorAgentRunId,
      workerAgentRunId: worker.id,
      handoffFingerprint: handoff.fingerprint,
      taskGraphRevision: run.taskGraphRevision,
      summary: decision.summary,
      findings: decision.findings,
      evidence: decision.evidence,
      criteria: decision.criteria
    }).evaluation;
    this.platformKernel.recordAgentHandoff(run.id, evaluatorAgentRunId, {
      inputRevision: run.taskGraphRevision,
      outputCommit: handoff.outputCommit,
      summary: decision.summary,
      evidence: decision.evidence,
      unresolved: decision.approved ? [] : decision.findings
    });
    this.worktreeRuntime.release(created.worktree.id, {
      reason: decision.approved ? "task-evaluation-approved" : "task-evaluation-rejected",
      remove: true
    });
    this.platformKernel.finishAgentRun(run.id, evaluatorAgentRunId, {
      status: "completed",
      outcome: decision.approved ? "approved" : "rejected",
      stopReason: decision.approved ? "task-evaluation-approved" : "task-evaluation-rejected",
      taskStatus: decision.approved ? "completed" : "continuable"
    });
    run = this.platformKernel.getRun(run.id);
    return {
      ok: decision.approved,
      approved: decision.approved,
      code: decision.approved ? null : "task-evaluation-rejected",
      evaluatorAgentRunId,
      workerAgentRunId: worker.id,
      evaluation,
      task: run.tasks[task.id]
    };
  }
}
