import {
  getPlanCompletionState
} from "./finalization.js";

import {
  classifyToolFailureHistory
} from "./ToolErrorClassifier.js";

import {
  isGracefulRunBoundary,
  isRecoverableRunFailure,
  normalizeRunStopReason,
  RUN_STOP_REASONS
} from "./runStopReasons.js";

import {
  RUN_OUTCOMES
} from "./RunStateMachine.js";

const TOOL_FAILURE_REASONS = new Set([
  RUN_STOP_REASONS.TOOL_ERROR,
  RUN_STOP_REASONS.TOOL_TIMEOUT,
  RUN_STOP_REASONS.INVALID_TOOL_ARGUMENTS,
  RUN_STOP_REASONS.REPEATED_TOOL_CALL
]);

export function resolveEffectiveStopReason({
  stopReason,
  records = [],
  plan = []
} = {}) {
  const normalized = normalizeRunStopReason(stopReason);
  const failures = classifyToolFailureHistory(records);

  if (TOOL_FAILURE_REASONS.has(normalized) && !failures.hasActive) {
    const planState = getPlanCompletionState(plan);
    if (planState.hasNeedsInput) return RUN_STOP_REASONS.NEEDS_INPUT;
    if (planState.hasBlocked) return RUN_STOP_REASONS.BLOCKED;
    if (planState.hasUnfinished) return RUN_STOP_REASONS.PLAN_INCOMPLETE;
    return RUN_STOP_REASONS.COMPLETED;
  }

  return normalized;
}

export function resolveRunOutcome({
  stopReason,
  records = [],
  plan = [],
  finalText = "",
  goalVerification = null,
  gracefulBoundary = isGracefulRunBoundary
} = {}) {
  const effectiveStopReason = resolveEffectiveStopReason({
    stopReason,
    records,
    plan
  });
  const planState = getPlanCompletionState(plan);
  const goalVerified = goalVerification?.verified !== false;

  let outcome;
  if (
    gracefulBoundary(effectiveStopReason) ||
    isRecoverableRunFailure({
      stopReason: effectiveStopReason,
      records
    })
  ) {
    outcome = RUN_OUTCOMES.CONTINUABLE;
  } else if (
    effectiveStopReason === RUN_STOP_REASONS.COMPLETED &&
    goalVerified &&
    String(finalText ?? "").trim() &&
    (!planState.hasPlan || planState.isComplete)
  ) {
    outcome = RUN_OUTCOMES.COMPLETED;
  }

  return {
    outcome,
    stopReason: effectiveStopReason,
    planState,
    toolFailures: classifyToolFailureHistory(records)
  };
}
