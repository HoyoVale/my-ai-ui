import crypto from "node:crypto";

import {
  compactPlanState,
  normalizePlanState
} from "../agent/planState.js";

import {
  reconcileRootPlanFromSubplans
} from "../agent/PlanAuthority.js";

const GOAL_SCHEMA_VERSION = 6;
const GOAL_EVENT_HISTORY_LIMIT = 48;
const GOAL_VERIFICATION_HISTORY_LIMIT = 12;
const GOAL_WORKING_FILE_LIMIT = 80;
const GOAL_WORKING_PROBLEM_LIMIT = 24;
const GOAL_WORKING_FAILURE_LIMIT = 24;

export const GOAL_STATUSES = Object.freeze({
  ACTIVE: "active",
  PAUSED: "paused",
  COMPLETED: "completed"
});

export const GOAL_PHASES = Object.freeze({
  IDLE: "idle",
  PLANNING: "planning",
  EXECUTING: "executing",
  WAITING: "waiting",
  EVALUATING: "evaluating",
  REPLANNING: "replanning",
  COMPLETED: "completed"
});

const GOAL_PHASE_SET = new Set(Object.values(GOAL_PHASES));
const GOAL_STATUS_SET = new Set(Object.values(GOAL_STATUSES));
const GOAL_CRITERION_KINDS = new Set([
  "auto",
  "test",
  "build",
  "lint",
  "typecheck",
  "check",
  "change",
  "manual"
]);
const GOAL_CRITERION_STATUSES = new Set([
  "pending",
  "passed",
  "failed"
]);
const GOAL_VERIFICATION_STATUSES = new Set([
  "pending",
  "verified",
  "incomplete",
  "needs_input",
  "blocked"
]);
const RUNNING_PHASES = new Set([
  GOAL_PHASES.PLANNING,
  GOAL_PHASES.EXECUTING,
  GOAL_PHASES.EVALUATING,
  GOAL_PHASES.REPLANNING
]);

const ALLOWED_PHASE_TRANSITIONS = new Map([
  [GOAL_PHASES.IDLE, new Set([
    GOAL_PHASES.PLANNING,
    GOAL_PHASES.EXECUTING,
    GOAL_PHASES.WAITING,
    GOAL_PHASES.COMPLETED
  ])],
  [GOAL_PHASES.PLANNING, new Set([
    GOAL_PHASES.EXECUTING,
    GOAL_PHASES.WAITING,
    GOAL_PHASES.REPLANNING,
    GOAL_PHASES.COMPLETED
  ])],
  [GOAL_PHASES.EXECUTING, new Set([
    GOAL_PHASES.EVALUATING,
    GOAL_PHASES.REPLANNING,
    GOAL_PHASES.WAITING,
    GOAL_PHASES.IDLE,
    GOAL_PHASES.COMPLETED
  ])],
  [GOAL_PHASES.EVALUATING, new Set([
    GOAL_PHASES.REPLANNING,
    GOAL_PHASES.WAITING,
    GOAL_PHASES.IDLE,
    GOAL_PHASES.COMPLETED
  ])],
  [GOAL_PHASES.REPLANNING, new Set([
    GOAL_PHASES.PLANNING,
    GOAL_PHASES.EXECUTING,
    GOAL_PHASES.WAITING,
    GOAL_PHASES.COMPLETED
  ])],
  [GOAL_PHASES.WAITING, new Set([
    GOAL_PHASES.IDLE,
    GOAL_PHASES.PLANNING,
    GOAL_PHASES.EXECUTING,
    GOAL_PHASES.REPLANNING,
    GOAL_PHASES.COMPLETED
  ])],
  [GOAL_PHASES.COMPLETED, new Set()]
]);

function clone(value) {
  return structuredClone(value);
}

function stringValue(value, fallback = "", maxLength = 200000) {
  return typeof value === "string"
    ? value.slice(0, maxLength)
    : fallback;
}

function nullableStringValue(value, maxLength = 120) {
  const normalized = stringValue(value, "", maxLength).trim();
  return normalized || null;
}

function timestampValue(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0
    ? Math.round(numeric)
    : fallback;
}

function boundedInteger(value, fallback = 0, maximum = 1_000_000) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(maximum, Math.max(0, Math.round(numeric)))
    : fallback;
}

function normalizeGoalStatus(value) {
  return GOAL_STATUS_SET.has(value)
    ? value
    : GOAL_STATUSES.ACTIVE;
}

function normalizeGoalPhase(value, status = GOAL_STATUSES.ACTIVE) {
  if (status === GOAL_STATUSES.COMPLETED) {
    return GOAL_PHASES.COMPLETED;
  }
  if (status === GOAL_STATUSES.PAUSED) {
    return GOAL_PHASES.WAITING;
  }
  return GOAL_PHASE_SET.has(value) && value !== GOAL_PHASES.COMPLETED
    ? value
    : GOAL_PHASES.IDLE;
}

export function inferGoalCriterionKind(value) {
  const source = String(value ?? "");
  if (/(?:测试|test|e2e|端到端|vitest|jest|pytest|playwright)/iu.test(source)) return "test";
  if (/(?:构建|打包|build|compile|编译)/iu.test(source)) return "build";
  if (/(?:lint|代码规范|静态检查|eslint|oxlint|biome|ruff)/iu.test(source)) return "lint";
  if (/(?:类型检查|type[\s_-]?check|tsc|mypy|pyright)/iu.test(source)) return "typecheck";
  if (/(?:检查命令|check\s+(?:passes|通过)|npm\s+run\s+check)/iu.test(source)) return "check";
  if (/(?:修复|修改|实现|添加|新增|删除|重构|创建|生成|开发|优化|替换|写入|更新|接入|安装|配置|fix|implement|add|remove|refactor|create|generate|develop|optimi[sz]e|replace|write|update|integrate|install|configure)/iu.test(source)) return "change";
  return "manual";
}

function sanitizeGoalEvidence(source) {
  return (Array.isArray(source) ? source : [])
    .map((item) => stringValue(item, "", 240).trim())
    .filter(Boolean)
    .slice(0, 20);
}

export function sanitizeGoalCriterion(source, index = 0) {
  const item = typeof source === "string" ? { text: source } : source;
  if (!item || typeof item !== "object") return null;

  const text = stringValue(item.text, "", 500)
    .replace(/\s+/gu, " ")
    .trim();
  if (!text) return null;

  const verificationKind = GOAL_CRITERION_KINDS.has(item.verificationKind) &&
    item.verificationKind !== "auto"
    ? item.verificationKind
    : inferGoalCriterionKind(text);
  const manualSatisfied = item.manualSatisfied === true;
  const status = manualSatisfied
    ? "passed"
    : GOAL_CRITERION_STATUSES.has(item.status)
      ? item.status
      : "pending";

  return {
    id: nullableStringValue(item.id, 120) ?? `criterion-${index + 1}`,
    text,
    verificationKind,
    manualSatisfied,
    status,
    detail: manualSatisfied && verificationKind === "manual"
      ? stringValue(
          item.detail,
          `完成标准“${text}”已由用户确认。`,
          500
        ).trim()
      : stringValue(item.detail, "", 500).trim(),
    evidence: manualSatisfied && verificationKind === "manual"
      ? sanitizeGoalEvidence(item.evidence).length > 0
        ? sanitizeGoalEvidence(item.evidence)
        : ["user-confirmed"]
      : sanitizeGoalEvidence(item.evidence),
    verifiedAt: status === "passed"
      ? timestampValue(item.verifiedAt, 0) || null
      : null
  };
}

export function sanitizeGoalVerification(source) {
  if (!source || typeof source !== "object") return null;
  const status = GOAL_VERIFICATION_STATUSES.has(source.status)
    ? source.status
    : "pending";
  return {
    version: Math.max(1, Number(source.version) || 1),
    status,
    verified: status === "verified" && source.verified !== false,
    checkedAt: timestampValue(source.checkedAt, 0),
    reason: stringValue(source.reason, "", 500).trim(),
    missingCriteria: (Array.isArray(source.missingCriteria)
      ? source.missingCriteria
      : [])
      .map((item) => nullableStringValue(item, 120))
      .filter(Boolean)
      .slice(0, 20)
  };
}

function sanitizeWaiting(source, phase, status, updatedAt) {
  if (phase !== GOAL_PHASES.WAITING) return null;
  const fallbackKind = status === GOAL_STATUSES.PAUSED
    ? "user_paused"
    : "checkpoint";
  return {
    kind: nullableStringValue(source?.kind, 80) ?? fallbackKind,
    reason: stringValue(source?.reason, "", 500).trim(),
    requiredAction: stringValue(source?.requiredAction, "", 500).trim(),
    since: timestampValue(source?.since, updatedAt)
  };
}


function sanitizeGoalUsage(source) {
  const provider = source?.provider ?? {};
  const estimated = source?.estimated ?? {};
  const tools = source?.tools ?? {};
  return {
    version: 1,
    runCount: boundedInteger(source?.runCount, 0, 1_000_000),
    runIds: (Array.isArray(source?.runIds) ? source.runIds : [])
      .map((item) => nullableStringValue(item, 120))
      .filter(Boolean)
      .slice(-64),
    runs: (Array.isArray(source?.runs) ? source.runs : [])
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        runId: nullableStringValue(item.runId, 120),
        provider: {
          requests: boundedInteger(item.provider?.requests, 0, 10_000_000),
          steps: boundedInteger(item.provider?.steps, 0, 10_000_000),
          inputTokens: boundedInteger(item.provider?.inputTokens, 0, 10_000_000_000),
          outputTokens: boundedInteger(item.provider?.outputTokens, 0, 10_000_000_000),
          reasoningTokens: boundedInteger(item.provider?.reasoningTokens, 0, 10_000_000_000),
          cachedInputTokens: boundedInteger(item.provider?.cachedInputTokens, 0, 10_000_000_000),
          totalTokens: boundedInteger(item.provider?.totalTokens, 0, 10_000_000_000),
          reportedRequests: boundedInteger(item.provider?.reportedRequests, 0, 10_000_000)
        },
        estimated: {
          contextInputTokens: boundedInteger(item.estimated?.contextInputTokens, 0, 10_000_000_000),
          toolSchemaTokens: boundedInteger(item.estimated?.toolSchemaTokens, 0, 10_000_000_000),
          toolArgumentTokens: boundedInteger(item.estimated?.toolArgumentTokens, 0, 10_000_000_000),
          toolResultTokens: boundedInteger(item.estimated?.toolResultTokens, 0, 10_000_000_000),
          totalInputTokens: boundedInteger(item.estimated?.totalInputTokens, 0, 10_000_000_000)
        },
        tools: {
          callCount: boundedInteger(item.tools?.callCount, 0, 10_000_000),
          resultCount: boundedInteger(item.tools?.resultCount, 0, 10_000_000),
          cacheReuseCount: boundedInteger(item.tools?.cacheReuseCount, 0, 10_000_000)
        },
        updatedAt: timestampValue(item.updatedAt, 0)
      }))
      .filter((item) => item.runId)
      .slice(-64),
    provider: {
      requests: boundedInteger(provider.requests, 0, 10_000_000),
      steps: boundedInteger(provider.steps, 0, 10_000_000),
      inputTokens: boundedInteger(provider.inputTokens, 0, 10_000_000_000),
      outputTokens: boundedInteger(provider.outputTokens, 0, 10_000_000_000),
      reasoningTokens: boundedInteger(provider.reasoningTokens, 0, 10_000_000_000),
      cachedInputTokens: boundedInteger(provider.cachedInputTokens, 0, 10_000_000_000),
      totalTokens: boundedInteger(provider.totalTokens, 0, 10_000_000_000),
      reportedRequests: boundedInteger(provider.reportedRequests, 0, 10_000_000)
    },
    estimated: {
      contextInputTokens: boundedInteger(estimated.contextInputTokens, 0, 10_000_000_000),
      toolSchemaTokens: boundedInteger(estimated.toolSchemaTokens, 0, 10_000_000_000),
      toolArgumentTokens: boundedInteger(estimated.toolArgumentTokens, 0, 10_000_000_000),
      toolResultTokens: boundedInteger(estimated.toolResultTokens, 0, 10_000_000_000),
      totalInputTokens: boundedInteger(estimated.totalInputTokens, 0, 10_000_000_000)
    },
    tools: {
      callCount: boundedInteger(tools.callCount, 0, 10_000_000),
      resultCount: boundedInteger(tools.resultCount, 0, 10_000_000),
      cacheReuseCount: boundedInteger(tools.cacheReuseCount, 0, 10_000_000)
    },
    updatedAt: timestampValue(source?.updatedAt, 0)
  };
}

function sanitizeGoalRuntime(source) {
  const activeRunId = nullableStringValue(source?.activeRunId, 120);
  return {
    activeRunId,
    lastRunId: nullableStringValue(source?.lastRunId, 120) ?? activeRunId,
    taskId: nullableStringValue(source?.taskId, 120),
    attempt: boundedInteger(source?.attempt, activeRunId ? 1 : 0, 10000),
    continuationCount: boundedInteger(source?.continuationCount, 0, 100000),
    lastHeartbeatAt: timestampValue(source?.lastHeartbeatAt, 0),
    resumable: source?.resumable === true
  };
}

function sanitizeGoalCheckpoint(source) {
  if (!source || typeof source !== "object") return null;
  const id = nullableStringValue(source.id ?? source.checkpointId, 160);
  if (!id) return null;
  return {
    version: Math.max(1, boundedInteger(source.version, 1, 100)),
    id,
    runId: nullableStringValue(source.runId, 120),
    taskId: nullableStringValue(source.taskId, 120),
    messageId: nullableStringValue(source.messageId, 120),
    segmentId: nullableStringValue(source.segmentId, 120),
    phase: GOAL_PHASE_SET.has(source.phase)
      ? source.phase
      : GOAL_PHASES.WAITING,
    outcome: nullableStringValue(source.outcome, 80),
    stopReason: nullableStringValue(source.stopReason, 120),
    resumable: source.resumable === true,
    summary: stringValue(
      source.summary ?? source.publicStatus ?? source.objective,
      "",
      800
    ).trim(),
    updatedAt: timestampValue(source.updatedAt, 0)
  };
}

function sanitizeGoalTransition(source) {
  if (!source || typeof source !== "object") return null;
  const from = GOAL_PHASE_SET.has(source.from) ? source.from : null;
  const to = GOAL_PHASE_SET.has(source.to) ? source.to : null;
  if (!to) return null;
  return {
    from,
    to,
    reason: stringValue(source.reason, "", 240).trim(),
    at: timestampValue(source.at, 0)
  };
}

function sanitizeGoalEvent(source, index = 0) {
  if (!source || typeof source !== "object") return null;
  const type = nullableStringValue(source.type, 80);
  if (!type) return null;
  return {
    id: nullableStringValue(source.id, 180) ?? `goal-event-${index + 1}`,
    type,
    from: GOAL_PHASE_SET.has(source.from) ? source.from : null,
    to: GOAL_PHASE_SET.has(source.to) ? source.to : null,
    reason: stringValue(source.reason, "", 240).trim(),
    runId: nullableStringValue(source.runId, 120),
    checkpointId: nullableStringValue(source.checkpointId, 160),
    at: timestampValue(source.at, 0)
  };
}

function progressFromCriteria(criteria, updatedAt) {
  const total = criteria.length;
  const passed = criteria.filter((criterion) => criterion.status === "passed")
    .length;
  return {
    passed,
    total,
    ratio: total > 0 ? passed / total : 0,
    updatedAt
  };
}

function sanitizeGoalProgress(source, criteria, updatedAt) {
  const derived = progressFromCriteria(criteria, updatedAt);
  return {
    ...derived,
    updatedAt: timestampValue(source?.updatedAt, updatedAt)
  };
}

function sanitizeStringList(source, limit, maxLength = 500) {
  return [...new Set(
    (Array.isArray(source) ? source : [])
      .map((item) => stringValue(item, "", maxLength).trim())
      .filter(Boolean)
  )].slice(-limit);
}

function sanitizeWorkingFailure(source) {
  if (!source || typeof source !== "object") return null;
  const code = stringValue(source.code, "", 120).trim();
  const message = stringValue(source.message, "", 500).trim();
  if (!code && !message) return null;
  return {
    code,
    message,
    toolName: stringValue(source.toolName, "", 120).trim(),
    recoverable: source.recoverable !== false,
    at: timestampValue(source.at, 0)
  };
}

function sanitizeFileFingerprint(source) {
  if (!source || typeof source !== "object") return null;
  const path = stringValue(source.path, "", 500).trim();
  if (!path) return null;
  return {
    path,
    hash: stringValue(source.hash, "", 160).trim(),
    updatedAt: timestampValue(source.updatedAt, 0)
  };
}

export function sanitizeGoalWorkingState(source, {
  objective = "",
  updatedAt = 0
} = {}) {
  const input = source && typeof source === "object" ? source : {};
  const fingerprints = new Map();
  for (const item of Array.isArray(input.fileFingerprints) ? input.fileFingerprints : []) {
    const normalized = sanitizeFileFingerprint(item);
    if (normalized) fingerprints.set(normalized.path, normalized);
  }

  return {
    version: 1,
    revision: Math.max(0, boundedInteger(input.revision, 0, 1_000_000)),
    objective: stringValue(input.objective, objective, 4000).trim() || objective,
    lastUserInstruction: stringValue(input.lastUserInstruction, "", 2000).trim(),
    activeStepId: nullableStringValue(input.activeStepId, 80),
    completedStepIds: sanitizeStringList(input.completedStepIds, 80, 80),
    modifiedFiles: sanitizeStringList(input.modifiedFiles, GOAL_WORKING_FILE_LIMIT, 500),
    fileFingerprints: [...fingerprints.values()].slice(-GOAL_WORKING_FILE_LIMIT),
    latestBuildResult: stringValue(input.latestBuildResult, "", 1000).trim(),
    latestTestResult: stringValue(input.latestTestResult, "", 1000).trim(),
    latestVisualFeedback: stringValue(input.latestVisualFeedback, "", 1000).trim(),
    recentToolFailures: (Array.isArray(input.recentToolFailures)
      ? input.recentToolFailures
      : [])
      .map(sanitizeWorkingFailure)
      .filter(Boolean)
      .slice(-GOAL_WORKING_FAILURE_LIMIT),
    resolvedProblems: sanitizeStringList(
      input.resolvedProblems,
      GOAL_WORKING_PROBLEM_LIMIT,
      500
    ),
    unresolvedProblems: sanitizeStringList(
      input.unresolvedProblems,
      GOAL_WORKING_PROBLEM_LIMIT,
      500
    ),
    lastCheckpointId: nullableStringValue(input.lastCheckpointId, 160),
    lastRunId: nullableStringValue(input.lastRunId, 120),
    lastRunSummary: stringValue(input.lastRunSummary, "", 1200).trim(),
    nextRecommendedAction: stringValue(input.nextRecommendedAction, "", 800).trim(),
    updatedAt: timestampValue(input.updatedAt, updatedAt)
  };
}

function authoritativePlanItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item?.status !== "superseded");
}

function allowedGoalPlanProgress(previous, next) {
  if (previous === next) return true;
  if (previous === "pending") {
    return [
      "in_progress",
      "completed",
      "blocked",
      "needs_input",
      "skipped",
      "cancelled"
    ].includes(next);
  }
  if (previous === "in_progress") {
    return [
      "completed",
      "blocked",
      "needs_input",
      "skipped",
      "cancelled"
    ].includes(next);
  }
  if (["blocked", "needs_input"].includes(previous)) {
    return [
      "pending",
      "in_progress",
      "completed",
      "blocked",
      "needs_input",
      "skipped",
      "cancelled"
    ].includes(next);
  }
  return false;
}

function goalPlanStructuralChanges(previousItems, nextItems) {
  const previous = authoritativePlanItems(previousItems);
  const next = authoritativePlanItems(nextItems);
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const nextById = new Map(next.map((item) => [item.id, item]));
  const changes = [];

  for (const item of previous) {
    const candidate = nextById.get(item.id);
    if (!candidate) {
      changes.push({ type: "removed", id: item.id });
      continue;
    }
    if (candidate.title !== item.title) {
      changes.push({ type: "renamed", id: item.id });
    }
    if (!allowedGoalPlanProgress(item.status, candidate.status)) {
      changes.push({
        type: "status_regression",
        id: item.id,
        from: item.status,
        to: candidate.status
      });
    }
  }

  for (const item of next) {
    if (!previousById.has(item.id)) {
      changes.push({ type: "added", id: item.id });
    }
  }

  return changes;
}

function sanitizeGoalPlanAuthority(source, {
  goalId,
  createdAt,
  updatedAt
} = {}) {
  const normalized = normalizePlanState(source?.state ?? source ?? []);
  const rootPlanId = nullableStringValue(
    source?.rootPlanId ?? normalized.rootPlanId,
    160
  ) ?? `${goalId}:root-plan`;
  return {
    version: 1,
    rootPlanId,
    revision: Math.max(
      normalized.authorityRevision,
      boundedInteger(source?.revision, normalized.authorityRevision, 1_000_000)
    ),
    replanRevision: Math.max(
      normalized.replanRevision,
      boundedInteger(source?.replanRevision, normalized.replanRevision, 1_000_000)
    ),
    createdAt: timestampValue(source?.createdAt, createdAt),
    updatedAt: timestampValue(source?.updatedAt, updatedAt),
    state: compactPlanState({
      ...normalized,
      rootPlanId
    }, {
      maxRootItems: 40,
      maxSubplans: 24,
      maxSubplanItems: 40
    }),
    lastReplan:
      source?.lastReplan && typeof source.lastReplan === "object"
        ? {
            reason: stringValue(source.lastReplan.reason, "", 500).trim(),
            failedAssumption: stringValue(
              source.lastReplan.failedAssumption,
              "",
              500
            ).trim(),
            runId: nullableStringValue(source.lastReplan.runId, 120),
            at: timestampValue(source.lastReplan.at, 0)
          }
        : normalized.lastReplan
  };
}

export function sanitizeGoal(source) {
  if (!source || typeof source !== "object") return null;

  const id = nullableStringValue(source.id, 120);
  const objective = stringValue(source.objective, "", 4000).trim();
  if (!id || !objective) return null;

  const createdAt = timestampValue(source.createdAt, 0);
  const updatedAt = Math.max(
    createdAt,
    timestampValue(source.updatedAt, createdAt)
  );
  const status = normalizeGoalStatus(source.status);
  const phase = normalizeGoalPhase(source.phase, status);
  const criterionIds = new Set();
  const criteria = (Array.isArray(source.criteria) ? source.criteria : [])
    .map(sanitizeGoalCriterion)
    .filter(Boolean)
    .filter((criterion) => {
      if (criterionIds.has(criterion.id)) return false;
      criterionIds.add(criterion.id);
      return true;
    })
    .slice(0, 12);
  const lastVerification = sanitizeGoalVerification(source.lastVerification);
  const verificationHistory = (Array.isArray(source.verificationHistory)
    ? source.verificationHistory
    : [])
    .map(sanitizeGoalVerification)
    .filter(Boolean)
    .slice(-GOAL_VERIFICATION_HISTORY_LIMIT);
  const eventHistory = (Array.isArray(source.eventHistory)
    ? source.eventHistory
    : [])
    .map(sanitizeGoalEvent)
    .filter(Boolean)
    .slice(-GOAL_EVENT_HISTORY_LIMIT);

  return {
    version: GOAL_SCHEMA_VERSION,
    id,
    revision: Math.max(1, Math.round(Number(source.revision) || 1)),
    runtimeRevision: Math.max(
      1,
      Math.round(Number(source.runtimeRevision) || 1)
    ),
    objective,
    criteria,
    autoContinue: source.autoContinue !== false,
    status,
    phase,
    platformRunId: nullableStringValue(source.platformRunId, 120),
    completionFingerprint: status === GOAL_STATUSES.COMPLETED
      ? nullableStringValue(source.completionFingerprint, 128)
      : null,
    createdAt,
    updatedAt,
    completedAt: status === GOAL_STATUSES.COMPLETED
      ? Math.max(updatedAt, timestampValue(source.completedAt, updatedAt))
      : null,
    lastVerification,
    verificationHistory,
    runtime: sanitizeGoalRuntime(source.runtime),
    waiting: sanitizeWaiting(source.waiting, phase, status, updatedAt),
    checkpoint: sanitizeGoalCheckpoint(source.checkpoint),
    progress: sanitizeGoalProgress(source.progress, criteria, updatedAt),
    planAuthority: sanitizeGoalPlanAuthority(source.planAuthority, {
      goalId: id,
      createdAt,
      updatedAt
    }),
    workingState: sanitizeGoalWorkingState(source.workingState, {
      objective,
      updatedAt
    }),
    usage: sanitizeGoalUsage(source.usage),
    lastTransition: sanitizeGoalTransition(source.lastTransition),
    eventHistory
  };
}

export function recordGoalTokenUsage(goalSource, ledgerSource, {
  now = Date.now()
} = {}) {
  const goal = sanitizeGoal(goalSource);
  if (!goal) return { ok: false, code: "goal-not-found" };
  const ledger = ledgerSource && typeof ledgerSource === "object"
    ? ledgerSource
    : null;
  const runId = nullableStringValue(ledger?.runId, 120);
  if (!ledger || !runId) {
    return { ok: false, code: "token-ledger-invalid" };
  }

  const usage = sanitizeGoalUsage(goal.usage);
  const nextRun = {
    runId,
    provider: sanitizeGoalUsage({ provider: ledger.provider }).provider,
    estimated: sanitizeGoalUsage({ estimated: ledger.estimated }).estimated,
    tools: sanitizeGoalUsage({ tools: ledger.tools }).tools,
    updatedAt: timestampValue(now, Date.now())
  };
  const previousIndex = usage.runs.findIndex((item) => item.runId === runId);
  const previous = previousIndex >= 0 ? usage.runs[previousIndex] : null;
  const delta = (target, before, after) => {
    for (const key of Object.keys(target)) {
      target[key] = Math.max(
        0,
        boundedInteger(target[key], 0, 10_000_000_000) -
        boundedInteger(before?.[key], 0, 10_000_000_000) +
        boundedInteger(after?.[key], 0, 10_000_000_000)
      );
    }
  };
  delta(usage.provider, previous?.provider, nextRun.provider);
  delta(usage.estimated, previous?.estimated, nextRun.estimated);
  delta(usage.tools, previous?.tools, nextRun.tools);

  if (previousIndex >= 0) {
    usage.runs[previousIndex] = nextRun;
  } else {
    usage.runs.push(nextRun);
    usage.runCount += 1;
    usage.runIds = [...usage.runIds, runId].slice(-64);
  }
  usage.runs = usage.runs.slice(-64);
  usage.updatedAt = nextRun.updatedAt;
  goal.usage = usage;
  touch(goal, usage.updatedAt);
  if (!previous) {
    appendEvent(goal, {
      type: "token_usage_recorded",
      reason: `run:${runId}`,
      runId,
      at: usage.updatedAt
    });
  }
  return { ok: true, changed: true, goal };
}

function eventId(goal, type, at) {
  return `${goal.id}:${type}:${at}:${goal.runtimeRevision}`.slice(0, 180);
}

function appendEvent(goal, event) {
  const history = Array.isArray(goal.eventHistory)
    ? [...goal.eventHistory]
    : [];
  history.push({
    id: event.id ?? eventId(goal, event.type, event.at),
    type: event.type,
    from: event.from ?? null,
    to: event.to ?? null,
    reason: String(event.reason ?? "").slice(0, 240),
    runId: nullableStringValue(event.runId, 120),
    checkpointId: nullableStringValue(event.checkpointId, 160),
    at: event.at
  });
  goal.eventHistory = history.slice(-GOAL_EVENT_HISTORY_LIMIT);
}

function touch(goal, now) {
  goal.updatedAt = now;
  goal.runtimeRevision = Math.max(1, Number(goal.runtimeRevision) || 1) + 1;
  goal.progress = progressFromCriteria(goal.criteria ?? [], now);
  return goal;
}

function normalizedCriteria(criteria, existing, timestamp) {
  const normalized = (Array.isArray(criteria) ? criteria : [])
    .map((criterion, index) => sanitizeGoalCriterion(criterion, index))
    .filter(Boolean)
    .slice(0, 12);
  const criterionIds = new Set();
  normalized.forEach((criterion, index) => {
    const base = criterion.id || `criterion-${index + 1}`;
    let nextId = base;
    let suffix = 2;
    while (criterionIds.has(nextId)) {
      nextId = `${base.slice(0, 112)}-${suffix++}`;
    }
    criterion.id = nextId;
    criterionIds.add(nextId);
  });

  const criterionIdentity = (items) => JSON.stringify((items ?? []).map((item) => ({
    text: item.text,
    verificationKind: item.verificationKind
  })));
  const sameCriteria = Boolean(existing) &&
    criterionIdentity(existing.criteria) === criterionIdentity(normalized);

  if (!sameCriteria) return { criteria: normalized, sameCriteria };

  return {
    sameCriteria,
    criteria: normalized.map((criterion, index) => {
      const previous = existing.criteria?.[index];
      if (!previous) return criterion;
      if (criterion.manualSatisfied && criterion.verificationKind === "manual") {
        return {
          ...criterion,
          id: previous.id,
          status: "passed",
          detail: `完成标准“${criterion.text}”已由用户确认。`,
          evidence: ["user-confirmed"],
          verifiedAt: previous.verifiedAt ?? timestamp
        };
      }
      if (criterion.verificationKind === "manual") {
        return {
          ...criterion,
          id: previous.id,
          status: "pending",
          detail: "",
          evidence: [],
          verifiedAt: null
        };
      }
      return {
        ...criterion,
        id: previous.id,
        status: previous.status,
        detail: previous.detail,
        evidence: clone(previous.evidence ?? []),
        verifiedAt: previous.verifiedAt
      };
    })
  };
}

export function upsertGoal(existingGoal, {
  objective = "",
  status = GOAL_STATUSES.ACTIVE,
  criteria = [],
  autoContinue = true
} = {}, {
  now = Date.now(),
  createId = () => crypto.randomUUID()
} = {}) {
  const normalizedObjective = String(objective ?? "")
    .replace(/\r\n?/gu, "\n")
    .trim()
    .slice(0, 4000);
  if (!normalizedObjective) {
    return { ok: true, goal: null, cleared: true };
  }

  const existing = sanitizeGoal(existingGoal);
  const timestamp = timestampValue(now, Date.now());
  const normalizedStatus = [GOAL_STATUSES.ACTIVE, GOAL_STATUSES.PAUSED]
    .includes(status)
    ? status
    : GOAL_STATUSES.ACTIVE;
  const normalized = normalizedCriteria(criteria, existing, timestamp);
  const keepIdentity = Boolean(
    existing?.id &&
    existing.objective === normalizedObjective &&
    normalized.sameCriteria &&
    existing.status !== GOAL_STATUSES.COMPLETED
  );
  const manualStateChanged = keepIdentity && normalized.criteria.some(
    (criterion, index) => criterion.manualSatisfied !==
      (existing.criteria?.[index]?.manualSatisfied === true)
  );
  const id = keepIdentity ? existing.id : createId();
  const phase = normalizedStatus === GOAL_STATUSES.PAUSED
    ? GOAL_PHASES.WAITING
    : keepIdentity && existing.status === GOAL_STATUSES.ACTIVE
      ? existing.phase
      : GOAL_PHASES.IDLE;
  const goal = {
    version: GOAL_SCHEMA_VERSION,
    id,
    revision: keepIdentity
      ? existing.revision
      : existing
        ? existing.revision + 1
        : 1,
    runtimeRevision: keepIdentity
      ? existing.runtimeRevision + 1
      : 1,
    objective: normalizedObjective,
    criteria: normalized.criteria,
    autoContinue: autoContinue !== false,
    status: normalizedStatus,
    phase,
    platformRunId: keepIdentity ? existing.platformRunId : null,
    completionFingerprint: null,
    createdAt: keepIdentity ? existing.createdAt : timestamp,
    updatedAt: timestamp,
    completedAt: null,
    lastVerification: keepIdentity && !manualStateChanged
      ? existing.lastVerification
      : null,
    verificationHistory: keepIdentity
      ? existing.verificationHistory
      : [],
    runtime: keepIdentity
      ? clone(existing.runtime)
      : sanitizeGoalRuntime(null),
    waiting: normalizedStatus === GOAL_STATUSES.PAUSED
      ? {
          kind: "user_paused",
          reason: "goal-paused-by-user",
          requiredAction: "resume_goal",
          since: timestamp
        }
      : null,
    checkpoint: keepIdentity ? existing.checkpoint : null,
    progress: progressFromCriteria(normalized.criteria, timestamp),
    planAuthority: keepIdentity
      ? clone(existing.planAuthority)
      : sanitizeGoalPlanAuthority(null, {
          goalId: id,
          createdAt: timestamp,
          updatedAt: timestamp
        }),
    usage: keepIdentity
      ? clone(existing.usage)
      : sanitizeGoalUsage(null),
    workingState: keepIdentity
      ? {
          ...clone(existing.workingState),
          objective: normalizedObjective,
          updatedAt: timestamp
        }
      : sanitizeGoalWorkingState(null, {
          objective: normalizedObjective,
          updatedAt: timestamp
        }),
    lastTransition: {
      from: keepIdentity ? existing.phase : null,
      to: phase,
      reason: normalizedStatus === GOAL_STATUSES.PAUSED
        ? "goal-paused-by-user"
        : keepIdentity && existing.status === GOAL_STATUSES.PAUSED
          ? "goal-resumed-by-user"
          : "goal-configured",
      at: timestamp
    },
    eventHistory: keepIdentity ? [...existing.eventHistory] : []
  };

  if (normalizedStatus === GOAL_STATUSES.PAUSED) {
    goal.runtime.lastRunId = goal.runtime.activeRunId ?? goal.runtime.lastRunId;
    goal.runtime.activeRunId = null;
    goal.runtime.lastHeartbeatAt = timestamp;
    goal.runtime.resumable = true;
  } else if (existing?.status === GOAL_STATUSES.PAUSED) {
    goal.runtime.activeRunId = null;
    goal.runtime.lastHeartbeatAt = timestamp;
    goal.runtime.resumable = true;
  }

  appendEvent(goal, {
    type: keepIdentity ? "goal_updated" : "goal_created",
    from: keepIdentity ? existing.phase : null,
    to: phase,
    reason: goal.lastTransition.reason,
    at: timestamp
  });

  return { ok: true, goal: sanitizeGoal(goal), cleared: false };
}

export function transitionGoal(goalSource, {
  phase,
  reason = "",
  runId = null,
  taskId = null,
  platformRunId = undefined,
  waiting = undefined,
  resumable = undefined,
  now = Date.now(),
  force = false
} = {}) {
  const goal = sanitizeGoal(goalSource);
  if (!goal) return { ok: false, code: "goal-not-found" };
  if (goal.status === GOAL_STATUSES.COMPLETED) {
    return { ok: false, code: "goal-completed" };
  }
  if (!GOAL_PHASE_SET.has(phase)) {
    return { ok: false, code: "goal-phase-invalid" };
  }
  if (phase === GOAL_PHASES.COMPLETED) {
    return { ok: false, code: "goal-completion-verification-required" };
  }
  if (!force && phase !== goal.phase &&
    !ALLOWED_PHASE_TRANSITIONS.get(goal.phase)?.has(phase)) {
    return {
      ok: false,
      code: "goal-transition-invalid",
      from: goal.phase,
      to: phase
    };
  }

  const timestamp = timestampValue(now, Date.now());
  const from = goal.phase;
  goal.phase = phase;
  if (platformRunId !== undefined) {
    goal.platformRunId = nullableStringValue(platformRunId, 120);
  }
  if (runId) {
    const normalizedRunId = nullableStringValue(runId, 120);
    if (normalizedRunId && normalizedRunId !== goal.runtime.activeRunId) {
      goal.runtime.attempt += 1;
    }
    goal.runtime.activeRunId = normalizedRunId;
    goal.runtime.lastRunId = normalizedRunId ?? goal.runtime.lastRunId;
  }
  if (taskId !== null) {
    goal.runtime.taskId = nullableStringValue(taskId, 120);
  }
  if (RUNNING_PHASES.has(phase)) {
    goal.runtime.lastHeartbeatAt = timestamp;
    goal.runtime.resumable = true;
    goal.waiting = null;
  } else if (phase === GOAL_PHASES.WAITING) {
    goal.runtime.activeRunId = null;
    goal.runtime.lastHeartbeatAt = timestamp;
    goal.runtime.resumable = resumable !== false;
    goal.waiting = {
      kind: nullableStringValue(waiting?.kind, 80) ?? "checkpoint",
      reason: stringValue(waiting?.reason ?? reason, "", 500).trim(),
      requiredAction: stringValue(waiting?.requiredAction, "", 500).trim(),
      since: timestampValue(waiting?.since, timestamp)
    };
  } else if (phase === GOAL_PHASES.IDLE) {
    goal.runtime.activeRunId = null;
    goal.runtime.lastHeartbeatAt = timestamp;
    goal.runtime.resumable = resumable === true;
    goal.waiting = null;
  }

  touch(goal, timestamp);
  goal.lastTransition = {
    from,
    to: phase,
    reason: String(reason ?? "").slice(0, 240),
    at: timestamp
  };
  appendEvent(goal, {
    type: "phase_changed",
    from,
    to: phase,
    reason,
    runId: runId ?? goal.runtime.lastRunId,
    at: timestamp
  });

  return {
    ok: true,
    changed: from !== phase,
    goal: sanitizeGoal(goal)
  };
}

export function linkGoalPlatformRun(goalSource, {
  platformRunId,
  now = Date.now()
} = {}) {
  const goal = sanitizeGoal(goalSource);
  if (!goal) return { ok: false, code: "goal-not-found" };
  const normalizedRunId = nullableStringValue(platformRunId, 120);
  if (!normalizedRunId) {
    return { ok: false, code: "platform-run-id-required" };
  }
  if (goal.platformRunId === normalizedRunId) {
    return { ok: true, changed: false, goal };
  }
  const timestamp = timestampValue(now, Date.now());
  goal.platformRunId = normalizedRunId;
  goal.completionFingerprint = null;
  touch(goal, timestamp);
  appendEvent(goal, {
    type: "platform_run_linked",
    from: goal.phase,
    to: goal.phase,
    reason: "platform-run-linked",
    runId: goal.runtime.activeRunId ?? goal.runtime.lastRunId,
    at: timestamp
  });
  return { ok: true, changed: true, goal: sanitizeGoal(goal) };
}

export function beginGoalRun(goalSource, {
  runId,
  taskId = null,
  platformRunId = undefined,
  now = Date.now()
} = {}) {
  const normalizedRunId = nullableStringValue(runId, 120);
  if (!normalizedRunId) {
    return { ok: false, code: "goal-run-id-required" };
  }
  return transitionGoal(goalSource, {
    phase: GOAL_PHASES.PLANNING,
    reason: "agent-run-started",
    runId: normalizedRunId,
    taskId,
    platformRunId,
    now,
    force: true
  });
}

export function heartbeatGoal(goalSource, {
  runId = null,
  phase = undefined,
  now = Date.now()
} = {}) {
  const goal = sanitizeGoal(goalSource);
  if (!goal) return { ok: false, code: "goal-not-found" };
  if (runId && goal.runtime.activeRunId && goal.runtime.activeRunId !== runId) {
    return { ok: false, code: "goal-run-changed" };
  }
  const nextPhase = phase && GOAL_PHASE_SET.has(phase)
    ? phase
    : goal.phase;
  if (!RUNNING_PHASES.has(nextPhase)) {
    return { ok: false, code: "goal-not-running" };
  }
  const timestamp = timestampValue(now, Date.now());
  const from = goal.phase;
  goal.phase = nextPhase;
  goal.runtime.lastHeartbeatAt = timestamp;
  goal.runtime.resumable = true;
  touch(goal, timestamp);
  if (from !== nextPhase) {
    goal.lastTransition = {
      from,
      to: nextPhase,
      reason: "agent-run-progress",
      at: timestamp
    };
    appendEvent(goal, {
      type: "phase_changed",
      from,
      to: nextPhase,
      reason: "agent-run-progress",
      runId: runId ?? goal.runtime.activeRunId,
      at: timestamp
    });
  }
  return { ok: true, goal: sanitizeGoal(goal) };
}

export function recordGoalCheckpoint(goalSource, checkpointSource, {
  now = Date.now()
} = {}) {
  const goal = sanitizeGoal(goalSource);
  if (!goal) return { ok: false, code: "goal-not-found" };
  if (goal.status === GOAL_STATUSES.COMPLETED) {
    return { ok: false, code: "goal-completed" };
  }
  const timestamp = timestampValue(now, Date.now());
  const checkpoint = sanitizeGoalCheckpoint({
    ...checkpointSource,
    id: checkpointSource?.id ?? checkpointSource?.checkpointId ?? [
      checkpointSource?.runId ?? goal.runtime.lastRunId ?? goal.id,
      checkpointSource?.segmentId ?? checkpointSource?.messageId ?? "checkpoint",
      checkpointSource?.updatedAt ?? timestamp
    ].filter(Boolean).join(":"),
    updatedAt: checkpointSource?.updatedAt ?? timestamp
  });
  if (!checkpoint) {
    return { ok: false, code: "goal-checkpoint-invalid" };
  }
  const previousId = goal.checkpoint?.id ?? null;
  goal.checkpoint = checkpoint;
  goal.runtime.lastRunId = checkpoint.runId ?? goal.runtime.lastRunId;
  goal.runtime.taskId = checkpoint.taskId ?? goal.runtime.taskId;
  goal.runtime.continuationCount = Math.max(
    goal.runtime.continuationCount,
    boundedInteger(checkpointSource?.continuationCount, 0, 100000)
  );
  goal.runtime.lastHeartbeatAt = timestamp;
  goal.runtime.resumable = checkpoint.resumable;
  const hasIncomingWorking =
    checkpointSource?.workingState &&
    typeof checkpointSource.workingState === "object";
  const incomingWorking = hasIncomingWorking
    ? sanitizeGoalWorkingState(
        checkpointSource.workingState,
        {
          objective: goal.objective,
          updatedAt: timestamp
        }
      )
    : goal.workingState;
  goal.workingState = sanitizeGoalWorkingState({
    ...goal.workingState,
    ...(hasIncomingWorking ? incomingWorking : {}),
    revision: Math.max(
      goal.workingState?.revision ?? 0,
      incomingWorking.revision ?? 0
    ) + 1,
    lastCheckpointId: checkpoint.id,
    lastRunId: checkpoint.runId ?? goal.runtime.lastRunId,
    lastRunSummary:
      incomingWorking.lastRunSummary ||
      checkpoint.summary ||
      goal.workingState?.lastRunSummary,
    updatedAt: timestamp
  }, {
    objective: goal.objective,
    updatedAt: timestamp
  });
  touch(goal, timestamp);
  if (previousId !== checkpoint.id) {
    appendEvent(goal, {
      type: "checkpoint_saved",
      from: goal.phase,
      to: goal.phase,
      reason: checkpoint.stopReason ?? "checkpoint-saved",
      runId: checkpoint.runId,
      checkpointId: checkpoint.id,
      at: timestamp
    });
  }
  return {
    ok: true,
    changed: previousId !== checkpoint.id,
    goal: sanitizeGoal(goal)
  };
}

export function applyGoalVerification(goalSource, verification, {
  now = Date.now()
} = {}) {
  const goal = sanitizeGoal(goalSource);
  if (!goal) return { ok: false, code: "goal-not-found" };
  const timestamp = timestampValue(now, Date.now());
  const checks = Array.isArray(verification?.checks) ? verification.checks : [];
  const criteriaById = new Map(
    checks
      .filter((item) => item?.criterionId)
      .map((item) => [String(item.criterionId), item])
  );
  goal.criteria = goal.criteria.map((criterion) => {
    const result = criteriaById.get(criterion.id);
    if (!result) return criterion;
    return {
      ...criterion,
      verificationKind: GOAL_CRITERION_KINDS.has(result.verificationKind)
        ? result.verificationKind
        : criterion.verificationKind,
      status: result.passed === true ? "passed" : "failed",
      detail: String(result.detail ?? "").slice(0, 500),
      evidence: sanitizeGoalEvidence(result.evidence),
      verifiedAt: result.passed === true ? timestamp : null
    };
  });
  const summary = sanitizeGoalVerification({
    ...verification,
    checkedAt: verification?.checkedAt ?? timestamp,
    missingCriteria: checks
      .filter((item) => item?.criterionId && item.passed !== true)
      .map((item) => String(item.criterionId))
  });
  goal.lastVerification = summary;
  const history = [...goal.verificationHistory];
  const previous = history.at(-1);
  if (previous?.checkedAt === summary.checkedAt && previous?.status === summary.status) {
    history[history.length - 1] = summary;
  } else {
    history.push(summary);
  }
  goal.verificationHistory = history.slice(-GOAL_VERIFICATION_HISTORY_LIMIT);
  touch(goal, timestamp);
  appendEvent(goal, {
    type: "verification_recorded",
    from: goal.phase,
    to: goal.phase,
    reason: summary.status,
    runId: goal.runtime.activeRunId ?? goal.runtime.lastRunId,
    at: timestamp
  });
  return { ok: true, goal: sanitizeGoal(goal) };
}

export function recordGoalWorkingState(goalSource, patch = {}, {
  now = Date.now()
} = {}) {
  const goal = sanitizeGoal(goalSource);
  if (!goal) return { ok: false, code: "goal-not-found" };
  if (goal.status === GOAL_STATUSES.COMPLETED) {
    return { ok: false, code: "goal-completed" };
  }
  const timestamp = timestampValue(now, Date.now());
  const previous = goal.workingState;
  const mergedFingerprints = new Map(
    (previous.fileFingerprints ?? []).map((item) => [item.path, item])
  );
  for (const item of Array.isArray(patch.fileFingerprints)
    ? patch.fileFingerprints
    : []) {
    const normalized = sanitizeFileFingerprint(item);
    if (normalized) mergedFingerprints.set(normalized.path, normalized);
  }
  const mergedFailures = [
    ...(previous.recentToolFailures ?? []),
    ...(Array.isArray(patch.recentToolFailures)
      ? patch.recentToolFailures
      : [])
  ];
  goal.workingState = sanitizeGoalWorkingState({
    ...previous,
    ...patch,
    revision: (previous.revision ?? 0) + 1,
    objective: goal.objective,
    completedStepIds: patch.completedStepIds ?? previous.completedStepIds,
    modifiedFiles: [
      ...(previous.modifiedFiles ?? []),
      ...(Array.isArray(patch.modifiedFiles) ? patch.modifiedFiles : [])
    ],
    fileFingerprints: [...mergedFingerprints.values()],
    recentToolFailures: mergedFailures,
    resolvedProblems: [
      ...(previous.resolvedProblems ?? []),
      ...(Array.isArray(patch.resolvedProblems) ? patch.resolvedProblems : [])
    ],
    unresolvedProblems: patch.unresolvedProblems ?? previous.unresolvedProblems,
    updatedAt: timestamp
  }, {
    objective: goal.objective,
    updatedAt: timestamp
  });
  touch(goal, timestamp);
  appendEvent(goal, {
    type: "working_state_updated",
    from: goal.phase,
    to: goal.phase,
    reason: stringValue(patch.reason, "working-state-updated", 240),
    runId: patch.lastRunId ?? goal.runtime.activeRunId ?? goal.runtime.lastRunId,
    checkpointId: goal.checkpoint?.id,
    at: timestamp
  });
  return { ok: true, changed: true, goal: sanitizeGoal(goal) };
}

export function applyGoalPlanState(goalSource, planState, {
  runId = null,
  authorityAction = "progress",
  now = Date.now()
} = {}) {
  const goal = sanitizeGoal(goalSource);
  if (!goal) return { ok: false, code: "goal-not-found" };
  if (goal.status === GOAL_STATUSES.COMPLETED) {
    return { ok: false, code: "goal-completed" };
  }
  const timestamp = timestampValue(now, Date.now());
  const reconciledIncoming = reconcileRootPlanFromSubplans(planState);
  const incoming = normalizePlanState(reconciledIncoming.state);
  const existing = normalizePlanState(goal.planAuthority?.state ?? []);
  const rootPlanId = goal.planAuthority?.rootPlanId ?? `${goal.id}:root-plan`;

  if (
    existing.rootItems.length > 0 &&
    incoming.rootPlanId &&
    incoming.rootPlanId !== rootPlanId
  ) {
    return { ok: false, code: "goal-root-plan-id-changed" };
  }

  if (
    authorityAction !== "replan" &&
    existing.rootItems.length > 0 &&
    incoming.replanRevision > existing.replanRevision
  ) {
    return { ok: false, code: "goal-replan-interface-required" };
  }

  const completedIds = new Set(
    existing.rootItems
      .filter((item) => item.status === "completed")
      .map((item) => item.id)
  );
  const nextById = new Map(incoming.rootItems.map((item) => [item.id, item]));
  for (const completedId of completedIds) {
    if (nextById.get(completedId)?.status !== "completed") {
      return {
        ok: false,
        code: "goal-plan-completed-step-regression",
        stepId: completedId
      };
    }
  }

  if (authorityAction !== "replan" && existing.rootItems.length > 0) {
    const structuralChanges = goalPlanStructuralChanges(
      existing.rootItems,
      incoming.rootItems
    );
    if (structuralChanges.length > 0) {
      return {
        ok: false,
        code: "goal-plan-replan-required",
        structuralChanges
      };
    }
  }

  const state = compactPlanState({
    ...incoming,
    rootPlanId,
    authorityRevision: Math.max(
      existing.authorityRevision,
      incoming.authorityRevision
    )
  }, {
    maxRootItems: 40,
    maxSubplans: 24,
    maxSubplanItems: 40
  });
  const active = state.rootItems.find((item) => item.status === "in_progress");
  const completedStepIds = state.rootItems
    .filter((item) => item.status === "completed")
    .map((item) => item.id);

  goal.planAuthority = {
    version: 1,
    rootPlanId,
    revision: Math.max(
      goal.planAuthority?.revision ?? 0,
      state.authorityRevision
    ),
    replanRevision: state.replanRevision,
    createdAt: goal.planAuthority?.createdAt ?? timestamp,
    updatedAt: timestamp,
    state,
    lastReplan: state.lastReplan ?? goal.planAuthority?.lastReplan ?? null
  };
  goal.workingState = sanitizeGoalWorkingState({
    ...goal.workingState,
    revision: (goal.workingState?.revision ?? 0) + 1,
    activeStepId: active?.id ?? null,
    completedStepIds,
    lastRunId: runId ?? goal.runtime.activeRunId ?? goal.runtime.lastRunId,
    updatedAt: timestamp
  }, {
    objective: goal.objective,
    updatedAt: timestamp
  });
  touch(goal, timestamp);
  appendEvent(goal, {
    type: authorityAction === "replan" ? "goal_replanned" : "goal_plan_updated",
    from: goal.phase,
    to: goal.phase,
    reason: authorityAction,
    runId: runId ?? goal.runtime.activeRunId ?? goal.runtime.lastRunId,
    at: timestamp
  });
  return { ok: true, changed: true, goal: sanitizeGoal(goal) };
}

export function replanGoal(goalSource, {
  planState,
  reason = "",
  failedAssumption = "",
  runId = null
} = {}, {
  now = Date.now()
} = {}) {
  const normalizedReason = stringValue(reason, "", 500).trim();
  const normalizedAssumption = stringValue(
    failedAssumption,
    "",
    500
  ).trim();
  if (!normalizedReason) {
    return { ok: false, code: "goal-replan-reason-required" };
  }
  if (!normalizedAssumption) {
    return { ok: false, code: "goal-replan-assumption-required" };
  }
  const incoming = normalizePlanState(planState);
  const timestamp = timestampValue(now, Date.now());
  incoming.lastReplan = {
    reason: normalizedReason,
    failedAssumption: normalizedAssumption,
    runId: nullableStringValue(runId, 120),
    at: timestamp
  };
  return applyGoalPlanState(goalSource, incoming, {
    runId,
    authorityAction: "replan",
    now: timestamp
  });
}

export function finishGoalRun(goalSource, {
  runId = null,
  outcome = "",
  stopReason = "",
  error = "",
  recoverable = undefined,
  now = Date.now()
} = {}) {
  const goal = sanitizeGoal(goalSource);
  if (!goal) return { ok: false, code: "goal-not-found" };
  if (goal.status === GOAL_STATUSES.COMPLETED) {
    return { ok: true, changed: false, goal };
  }
  if (runId && goal.runtime.activeRunId && goal.runtime.activeRunId !== runId) {
    return { ok: false, code: "goal-run-changed" };
  }

  const mapping = {
    continuable: {
      kind: "checkpoint",
      reason: stopReason || "checkpoint-ready",
      requiredAction: "continue_goal",
      resumable: true
    },
    needs_input: {
      kind: "user_input",
      reason: stopReason || "user-input-required",
      requiredAction: "provide_input",
      resumable: true
    },
    blocked: {
      kind: "blocked",
      reason: stopReason || "goal-blocked",
      requiredAction: "resolve_blocker",
      resumable: false
    },
    cancelled: {
      kind: "user_stopped",
      reason: stopReason || "run-cancelled-by-user",
      requiredAction: "continue_goal",
      resumable: true
    },
    failed: recoverable === true
      ? {
          kind: "recoverable_error",
          reason: error || stopReason || "recoverable-run-failure",
          requiredAction: "continue_goal",
          resumable: true
        }
      : {
          kind: "fatal_error",
          reason: error || stopReason || "run-failed",
          requiredAction: "review_error",
          resumable: false
        },
    interrupted: {
      kind: "recovery",
      reason: stopReason || "run-interrupted",
      requiredAction: "resume_from_checkpoint",
      resumable: true
    },
    needs_reconciliation: {
      kind: "reconciliation",
      reason: stopReason || "tool-effects-need-reconciliation",
      requiredAction: "reconcile_tools",
      resumable: true
    },
    needs_confirmation: {
      kind: "confirmation",
      reason: stopReason || "tool-effects-need-confirmation",
      requiredAction: "confirm_tool_effects",
      resumable: true
    },
    unknown: {
      kind: "recovery",
      reason: stopReason || "run-state-unknown",
      requiredAction: "inspect_and_resume",
      resumable: true
    },
    completed: {
      kind: "verification",
      reason: goal.lastVerification?.reason || "goal-verification-pending",
      requiredAction: "verify_goal",
      resumable: true
    }
  };
  const waiting = mapping[outcome] ?? mapping.interrupted;
  const result = transitionGoal(goal, {
    phase: GOAL_PHASES.WAITING,
    reason: waiting.reason,
    runId: null,
    waiting,
    resumable: waiting.resumable,
    now,
    force: true
  });
  if (!result.ok) return result;
  result.goal.runtime.lastRunId = nullableStringValue(runId, 120) ??
    result.goal.runtime.lastRunId;
  return { ...result, goal: sanitizeGoal(result.goal) };
}

export function completeGoal(goalSource, {
  verification,
  completionFingerprint,
  now = Date.now()
} = {}) {
  const goal = sanitizeGoal(goalSource);
  if (!goal) return { ok: false, code: "goal-not-found" };
  if (verification?.verified !== true || verification?.status !== "verified") {
    return { ok: false, code: "goal-verification-required" };
  }
  const normalizedFingerprint = nullableStringValue(completionFingerprint, 128);
  if (!normalizedFingerprint) {
    return { ok: false, code: "goal-completion-fingerprint-required" };
  }
  const timestamp = timestampValue(now, Date.now());
  const verified = applyGoalVerification(goal, verification, { now: timestamp });
  if (!verified.ok) return verified;
  const completed = verified.goal;
  const from = completed.phase;
  completed.status = GOAL_STATUSES.COMPLETED;
  completed.phase = GOAL_PHASES.COMPLETED;
  completed.completedAt = timestamp;
  completed.completionFingerprint = normalizedFingerprint;
  completed.runtime.activeRunId = null;
  completed.runtime.lastHeartbeatAt = timestamp;
  completed.runtime.resumable = false;
  completed.waiting = null;
  touch(completed, timestamp);
  completed.lastTransition = {
    from,
    to: GOAL_PHASES.COMPLETED,
    reason: "goal-completion-authorized",
    at: timestamp
  };
  appendEvent(completed, {
    type: "goal_completed",
    from,
    to: GOAL_PHASES.COMPLETED,
    reason: "goal-completion-authorized",
    runId: completed.runtime.lastRunId,
    checkpointId: completed.checkpoint?.id,
    at: timestamp
  });
  return { ok: true, goal: sanitizeGoal(completed) };
}

export function recoverInterruptedGoal(goalSource, {
  now = Date.now(),
  reason = "application-restarted"
} = {}) {
  const goal = sanitizeGoal(goalSource);
  if (!goal || goal.status !== GOAL_STATUSES.ACTIVE ||
    !RUNNING_PHASES.has(goal.phase)) {
    return { ok: true, changed: false, goal };
  }
  const timestamp = timestampValue(now, Date.now());
  const from = goal.phase;
  goal.phase = GOAL_PHASES.WAITING;
  goal.runtime.lastRunId = goal.runtime.activeRunId ?? goal.runtime.lastRunId;
  goal.runtime.activeRunId = null;
  goal.runtime.lastHeartbeatAt = timestamp;
  goal.runtime.resumable = true;
  goal.waiting = {
    kind: "recovery",
    reason,
    requiredAction: goal.checkpoint
      ? "resume_from_checkpoint"
      : "restart_goal_run",
    since: timestamp
  };
  touch(goal, timestamp);
  goal.lastTransition = {
    from,
    to: GOAL_PHASES.WAITING,
    reason,
    at: timestamp
  };
  appendEvent(goal, {
    type: "goal_recovered",
    from,
    to: GOAL_PHASES.WAITING,
    reason,
    runId: goal.runtime.lastRunId,
    checkpointId: goal.checkpoint?.id,
    at: timestamp
  });
  return { ok: true, changed: true, goal: sanitizeGoal(goal) };
}

export const GOAL_RUNTIME_VERSION = GOAL_SCHEMA_VERSION;
