import {
  sha256
} from "./canonical.js";

export const STRUCTURED_HANDOFF_VERSION = 2;

function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function strings(values, maxItems, maxLength) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => text(value, maxLength))
      .filter(Boolean)
  )].slice(0, maxItems);
}

function normalizeAcceptanceClaims(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((claim) => {
      if (!claim || typeof claim !== "object") return null;
      const criterionId = text(claim.criterionId ?? claim.id, 120);
      if (!criterionId) return null;
      return {
        criterionId,
        passed: claim.passed === true,
        evidence: strings(claim.evidence, 20, 500),
        note: text(claim.note ?? claim.summary, 500)
      };
    })
    .filter(Boolean)
    .slice(0, 32);
}

function handoffPayload(value = {}) {
  return {
    version: STRUCTURED_HANDOFF_VERSION,
    taskId: text(value.taskId, 120),
    agentRunId: text(value.agentRunId, 120),
    role: text(value.role, 80),
    attempt: Math.max(1, Math.round(Number(value.attempt) || 1)),
    goalRevision: Math.max(1, Math.round(Number(value.goalRevision) || 1)),
    taskGraphRevision: Math.max(0, Math.round(Number(value.taskGraphRevision) || 0)),
    status: value.status === "failed" ? "failed" : "ready_for_evaluation",
    summary: text(value.summary, 2000),
    outputCommit: text(value.outputCommit, 120) || null,
    baselineCommit: text(value.baselineCommit, 120) || null,
    changed: value.changed === true,
    receipts: strings(value.receipts, 100, 120),
    evidence: strings(value.evidence, 60, 500),
    acceptanceClaims: normalizeAcceptanceClaims(value.acceptanceClaims),
    unresolved: strings(value.unresolved, 40, 500),
    error: text(value.error, 1000),
    recordedAt: Math.max(0, Number(value.recordedAt) || Date.now())
  };
}

export function createStructuredHandoff({
  run,
  task,
  agentRun,
  checkpoint,
  result,
  now = () => Date.now()
} = {}) {
  const records = Array.isArray(result?.records) ? result.records : [];
  const payload = handoffPayload({
    taskId: task?.id,
    agentRunId: agentRun?.id,
    role: agentRun?.role ?? task?.role,
    attempt: agentRun?.attempt,
    goalRevision: run?.goalRevision,
    taskGraphRevision: run?.taskGraphRevision,
    status: result?.ok === false || result?.status === "failed"
      ? "failed"
      : "ready_for_evaluation",
    summary: result?.summary,
    outputCommit: checkpoint?.commit,
    baselineCommit: checkpoint?.baselineCommit ?? checkpoint?.baseline,
    changed: checkpoint?.changed === true,
    receipts: records
      .filter((record) => record?.status === "completed")
      .map((record) => record.id ?? record.name),
    evidence: result?.evidence,
    acceptanceClaims: result?.acceptanceClaims ?? result?.acceptance,
    unresolved: result?.unresolved,
    error: result?.error,
    recordedAt: now()
  });
  return {
    ...payload,
    fingerprint: sha256(payload)
  };
}

export function normalizeStructuredHandoff(handoff = {}) {
  const payload = handoffPayload(handoff);
  return {
    ...payload,
    fingerprint: text(handoff?.fingerprint, 128) || sha256(payload)
  };
}

export function validateStructuredHandoff(handoff, {
  run,
  task,
  agentRun
} = {}) {
  if (!handoff || typeof handoff !== "object") {
    return { ok: false, code: "handoff-missing" };
  }
  if (Number(handoff.version) !== STRUCTURED_HANDOFF_VERSION) {
    return { ok: false, code: "handoff-version-invalid" };
  }
  if (!text(handoff.fingerprint, 128)) {
    return { ok: false, code: "handoff-fingerprint-missing" };
  }
  const normalized = normalizeStructuredHandoff(handoff);
  const expectedFingerprint = sha256(handoffPayload(normalized));
  if (normalized.fingerprint !== expectedFingerprint) {
    return { ok: false, code: "handoff-fingerprint-invalid" };
  }
  if (task && normalized.taskId !== task.id) {
    return { ok: false, code: "handoff-task-mismatch" };
  }
  if (agentRun && normalized.agentRunId !== agentRun.id) {
    return { ok: false, code: "handoff-agent-mismatch" };
  }
  if (run && normalized.goalRevision !== run.goalRevision) {
    return { ok: false, code: "handoff-goal-stale" };
  }
  if (run && normalized.taskGraphRevision !== run.taskGraphRevision) {
    return {
      ok: false,
      code: "handoff-task-graph-stale",
      expectedRevision: run.taskGraphRevision,
      actualRevision: normalized.taskGraphRevision
    };
  }
  return { ok: true, handoff: normalized };
}
