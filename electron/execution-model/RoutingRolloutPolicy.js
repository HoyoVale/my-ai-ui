import {
  ROUTING_ACTIONS
} from "./ThreadRoutingDecision.js";

export const ROUTING_ROLLOUT_MODES = Object.freeze({
  LEGACY: "legacy",
  SHADOW: "shadow",
  GUARDED: "guarded",
  AUTHORITY: "authority"
});

export const ROUTING_ROLLOUT_RISKS = Object.freeze({
  NONE: "none",
  LOW: "low",
  HIGH: "high"
});

const MODES = new Set(Object.values(ROUTING_ROLLOUT_MODES));
const ELIGIBLE_ACTIONS = new Set([
  ROUTING_ACTIONS.START,
  ROUTING_ACTIONS.RESUME,
  ROUTING_ACTIONS.REGENERATE
]);
const REUSABLE_THREAD_STATES = new Set([
  "active",
  "running",
  "waiting",
  "continuable"
]);

function text(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function boundedRate(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

export function sanitizeRoutingRolloutSettings(source = {}) {
  const mode = MODES.has(source?.mode)
    ? source.mode
    : ROUTING_ROLLOUT_MODES.GUARDED;
  return {
    mode,
    minimumSamples: boundedInteger(source?.minimumSamples, 12, 0, 500),
    maxMismatchRate: boundedRate(source?.maxMismatchRate, 0.35),
    maxHighRiskMismatches: boundedInteger(
      source?.maxHighRiskMismatches,
      0,
      0,
      100
    ),
    windowSize: boundedInteger(source?.windowSize, 100, 20, 300),
    autoRollback: source?.autoRollback !== false
  };
}

export function classifyRoutingMismatchRisk(decision) {
  if (!decision?.shadow?.mismatch) {
    return ROUTING_ROLLOUT_RISKS.NONE;
  }

  const action = text(decision.action, 40);
  const legacyAction = text(decision.shadow?.legacyAction, 40);
  const reason = text(decision.reason, 240);

  if (
    action === ROUTING_ACTIONS.RESUME &&
    legacyAction === ROUTING_ACTIONS.START &&
    [
      "feedback-on-current-thread",
      "resume-current-thread",
      "active-thread-default"
    ].includes(reason)
  ) {
    return ROUTING_ROLLOUT_RISKS.LOW;
  }

  if (
    action === ROUTING_ACTIONS.START &&
    legacyAction === ROUTING_ACTIONS.RESUME &&
    [
      "workspace-changed-start-new-thread",
      "explicit-start-new-thread",
      "no-reusable-thread"
    ].includes(reason)
  ) {
    return ROUTING_ROLLOUT_RISKS.LOW;
  }

  return ROUTING_ROLLOUT_RISKS.HIGH;
}

export function summarizeRoutingRollout(decisions = []) {
  const normalized = Array.isArray(decisions) ? decisions : [];
  const mismatchCount = normalized.filter(
    (decision) => decision?.shadow?.mismatch === true
  ).length;
  const highRiskMismatchCount = normalized.filter(
    (decision) => classifyRoutingMismatchRisk(decision) === ROUTING_ROLLOUT_RISKS.HIGH
  ).length;
  const authorityCount = normalized.filter(
    (decision) => decision?.rollout?.authority === true
  ).length;
  const fallbackCount = normalized.filter(
    (decision) => decision?.rollout?.eligible === true &&
      decision?.rollout?.authority !== true
  ).length;
  const autoRollbackCount = normalized.filter(
    (decision) => decision?.rollout?.autoRollback === true
  ).length;

  return {
    sampleSize: normalized.length,
    mismatchCount,
    mismatchRate: normalized.length > 0
      ? mismatchCount / normalized.length
      : 0,
    highRiskMismatchCount,
    authorityCount,
    fallbackCount,
    autoRollbackCount
  };
}

function findThread(conversation, threadId) {
  const normalizedId = text(threadId);
  if (!normalizedId) return null;
  const threads = Array.isArray(conversation?.executionThreads)
    ? conversation.executionThreads
    : conversation?.executionThread
      ? [conversation.executionThread]
      : [];
  return threads.find((thread) => text(thread?.id) === normalizedId) ?? null;
}

function workspaceMatches(conversation, thread) {
  const conversationWorkspace = text(conversation?.workspaceId);
  const threadWorkspace = text(thread?.workspaceId);
  return !conversationWorkspace ||
    !threadWorkspace ||
    conversationWorkspace === threadWorkspace;
}

function runExists(conversation, runId) {
  const normalizedId = text(runId);
  if (!normalizedId) return false;
  const threads = Array.isArray(conversation?.executionThreads)
    ? conversation.executionThreads
    : conversation?.executionThread
      ? [conversation.executionThread]
      : [];
  return threads.some((thread) => (
    Array.isArray(thread?.runs) &&
    thread.runs.some((run) => text(run?.id) === normalizedId)
  ));
}

export function validateRoutingAuthoritySafety({
  decision,
  conversation = null,
  activeRun = null
} = {}) {
  if (!decision || typeof decision !== "object") {
    return { ok: false, reason: "routing-decision-required" };
  }
  if (!ELIGIBLE_ACTIONS.has(decision.action)) {
    return { ok: false, reason: "routing-action-not-rollout-eligible" };
  }
  if (activeRun?.runId || decision.activeRunId) {
    return { ok: false, reason: "active-run-authority-blocked" };
  }

  if (decision.action === ROUTING_ACTIONS.START) {
    return { ok: true, reason: "safe-new-thread" };
  }

  const targetThread = findThread(conversation, decision.targetThreadId);
  if (!targetThread) {
    return { ok: false, reason: "target-thread-not-found" };
  }
  if (!workspaceMatches(conversation, targetThread)) {
    return { ok: false, reason: "target-thread-workspace-mismatch" };
  }

  if (decision.action === ROUTING_ACTIONS.RESUME) {
    if (!REUSABLE_THREAD_STATES.has(text(targetThread.status, 40))) {
      return { ok: false, reason: "target-thread-not-reusable" };
    }
    return { ok: true, reason: "safe-thread-resume" };
  }

  if (!text(decision.sourceRunId) || !text(decision.targetRunId)) {
    return { ok: false, reason: "regeneration-run-lineage-required" };
  }
  if (decision.sourceRunId === decision.targetRunId) {
    return { ok: false, reason: "regeneration-run-must-differ" };
  }
  if (runExists(conversation, decision.targetRunId)) {
    return { ok: false, reason: "target-run-already-exists" };
  }
  return { ok: true, reason: "safe-regeneration" };
}

export function evaluateRoutingRollout({
  decision,
  conversation = null,
  activeRun = null,
  settings = {},
  history = []
} = {}) {
  const config = sanitizeRoutingRolloutSettings(settings);
  const metrics = summarizeRoutingRollout(
    (Array.isArray(history) ? history : []).slice(-config.windowSize)
  );
  const legacyAction = text(decision?.shadow?.legacyAction, 40) || ROUTING_ACTIONS.NONE;
  const risk = classifyRoutingMismatchRisk(decision);
  const safety = validateRoutingAuthoritySafety({
    decision,
    conversation,
    activeRun
  });
  const eligible = ELIGIBLE_ACTIONS.has(decision?.action) && safety.ok;
  const mismatch = decision?.shadow?.mismatch === true;
  const enoughSamples = metrics.sampleSize >= config.minimumSamples;
  const healthyWindow =
    metrics.mismatchRate <= config.maxMismatchRate &&
    metrics.highRiskMismatchCount <= config.maxHighRiskMismatches;
  const autoRollback = config.autoRollback && enoughSamples && !healthyWindow;

  let authority = false;
  let reason = "legacy-routing-mode";

  if (config.mode === ROUTING_ROLLOUT_MODES.SHADOW) {
    reason = "shadow-routing-mode";
  } else if (
    config.mode === ROUTING_ROLLOUT_MODES.GUARDED ||
    config.mode === ROUTING_ROLLOUT_MODES.AUTHORITY
  ) {
    if (!eligible) {
      reason = safety.reason;
    } else if (autoRollback) {
      reason = "rollout-health-threshold-exceeded";
    } else if (!mismatch) {
      authority = true;
      reason = "legacy-and-router-agree";
    } else if (risk === ROUTING_ROLLOUT_RISKS.HIGH) {
      reason = "high-risk-routing-mismatch";
    } else if (config.mode === ROUTING_ROLLOUT_MODES.AUTHORITY) {
      authority = true;
      reason = "authority-mode-safe-mismatch";
    } else if (
      decision.source === "explicit_command" ||
      decision.reason === "workspace-changed-start-new-thread"
    ) {
      authority = true;
      reason = "guarded-safety-override";
    } else if (enoughSamples && healthyWindow) {
      authority = true;
      reason = "guarded-rollout-threshold-met";
    } else {
      reason = "guarded-rollout-warming-up";
    }
  }

  const effectiveAction = authority
    ? decision.action
    : legacyAction || decision.action || ROUTING_ACTIONS.NONE;

  return {
    version: 1,
    mode: config.mode,
    eligible,
    authority,
    effectiveAction,
    fallbackAction: legacyAction,
    reason,
    risk,
    autoRollback,
    metrics: {
      sampleSize: metrics.sampleSize,
      mismatchCount: metrics.mismatchCount,
      mismatchRate: Number(metrics.mismatchRate.toFixed(4)),
      highRiskMismatchCount: metrics.highRiskMismatchCount,
      authorityCount: metrics.authorityCount,
      fallbackCount: metrics.fallbackCount
    }
  };
}
