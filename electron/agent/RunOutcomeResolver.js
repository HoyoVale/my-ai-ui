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

import {
  buildCompletionEvidence,
  validateCompletionClaims
} from "./finalization/CompletionEvidenceGate.js";

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
  const completionEvidence = buildCompletionEvidence({
    records,
    plan,
    goalVerification
  });

  let outcome;
  if (
    gracefulBoundary(effectiveStopReason) ||
    isRecoverableRunFailure({
      stopReason: effectiveStopReason,
      records
    })
  ) {
    outcome = RUN_OUTCOMES.CONTINUABLE;
  } else if (completionEvidence.failures.hasActive) {
    outcome = completionEvidence.failures.hasRecoverable
      ? RUN_OUTCOMES.CONTINUABLE
      : RUN_OUTCOMES.FAILED;
  } else if (completionEvidence.openRecordIds.length > 0) {
    outcome = RUN_OUTCOMES.CONTINUABLE;
  } else if (
    effectiveStopReason === RUN_STOP_REASONS.COMPLETED &&
    completionEvidence.canComplete &&
    String(finalText ?? "").trim()
  ) {
    outcome = RUN_OUTCOMES.COMPLETED;
  } else if (planState.hasNeedsInput) {
    outcome = RUN_OUTCOMES.NEEDS_INPUT;
  } else if (planState.hasBlocked) {
    outcome = RUN_OUTCOMES.BLOCKED;
  } else if (
    effectiveStopReason === RUN_STOP_REASONS.COMPLETED ||
    planState.hasUnfinished ||
    goalVerification?.verified === false
  ) {
    outcome = RUN_OUTCOMES.CONTINUABLE;
  } else {
    outcome = RUN_OUTCOMES.FAILED;
  }

  return {
    outcome,
    stopReason: effectiveStopReason,
    planState,
    toolFailures: completionEvidence.failures,
    completionEvidence,
    claimValidation: validateCompletionClaims({
      finalText,
      evidence: completionEvidence,
      outcome
    })
  };
}
