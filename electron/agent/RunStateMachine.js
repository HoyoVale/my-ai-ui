import {
  isGracefulRunBoundary,
  normalizeRunStopReason,
  RUN_STOP_REASONS
} from "./runStopReasons.js";

export const RUN_OUTCOMES = Object.freeze({
  RUNNING: "running",
  COMPLETED: "completed",
  CONTINUABLE: "continuable",
  NEEDS_INPUT: "needs_input",
  BLOCKED: "blocked",
  NEEDS_RECONCILIATION: "needs_reconciliation",
  NEEDS_CONFIRMATION: "needs_confirmation",
  UNKNOWN: "unknown",
  CANCELLED: "cancelled",
  INTERRUPTED: "interrupted",
  FAILED: "failed"
});

export const RUN_PHASES = Object.freeze({
  EXECUTING: "executing",
  FINALIZING: "finalizing",
  CANCELLING: "cancelling",
  CHECKPOINT_READY: "checkpoint_ready",
  COMPLETED: "completed",
  NEEDS_INPUT: "needs_input",
  BLOCKED: "blocked",
  RECONCILING: "reconciling",
  NEEDS_CONFIRMATION: "needs_confirmation",
  UNKNOWN: "unknown",
  CANCELLED: "cancelled",
  INTERRUPTED: "interrupted",
  FAILED: "failed"
});

const TERMINAL_OUTCOMES = new Set([
  RUN_OUTCOMES.COMPLETED,
  RUN_OUTCOMES.CONTINUABLE,
  RUN_OUTCOMES.NEEDS_INPUT,
  RUN_OUTCOMES.BLOCKED,
  RUN_OUTCOMES.NEEDS_RECONCILIATION,
  RUN_OUTCOMES.NEEDS_CONFIRMATION,
  RUN_OUTCOMES.UNKNOWN,
  RUN_OUTCOMES.CANCELLED,
  RUN_OUTCOMES.INTERRUPTED,
  RUN_OUTCOMES.FAILED
]);

export function outcomeFromStopReason(value) {
  const reason = normalizeRunStopReason(value);

  if (reason === RUN_STOP_REASONS.COMPLETED) {
    return RUN_OUTCOMES.COMPLETED;
  }

  if (isGracefulRunBoundary(reason)) {
    return RUN_OUTCOMES.CONTINUABLE;
  }

  if (reason === RUN_STOP_REASONS.NEEDS_INPUT) {
    return RUN_OUTCOMES.NEEDS_INPUT;
  }

  if (reason === RUN_STOP_REASONS.BLOCKED) {
    return RUN_OUTCOMES.BLOCKED;
  }

  if (reason === RUN_STOP_REASONS.CANCELLED_BY_USER) {
    return RUN_OUTCOMES.CANCELLED;
  }

  if (reason === RUN_STOP_REASONS.INTERRUPTED) {
    return RUN_OUTCOMES.INTERRUPTED;
  }

  return RUN_OUTCOMES.FAILED;
}

function presentationForOutcome(outcome) {
  switch (outcome) {
    case RUN_OUTCOMES.COMPLETED:
      return {
        phase: RUN_PHASES.COMPLETED,
        activityStatus: "completed",
        messageStatus: "complete",
        runtimeState: "idle",
        resumable: false
      };
    case RUN_OUTCOMES.CONTINUABLE:
      return {
        phase: RUN_PHASES.CHECKPOINT_READY,
        activityStatus: "checkpoint_ready",
        messageStatus: "complete",
        runtimeState: "idle",
        resumable: true
      };
    case RUN_OUTCOMES.NEEDS_INPUT:
      return {
        phase: RUN_PHASES.NEEDS_INPUT,
        activityStatus: "needs_input",
        messageStatus: "complete",
        runtimeState: "idle",
        resumable: false
      };
    case RUN_OUTCOMES.BLOCKED:
      return {
        phase: RUN_PHASES.BLOCKED,
        activityStatus: "blocked",
        messageStatus: "complete",
        runtimeState: "idle",
        resumable: false
      };
    case RUN_OUTCOMES.NEEDS_RECONCILIATION:
      return {
        phase: RUN_PHASES.RECONCILING,
        activityStatus: "needs_reconciliation",
        messageStatus: "interrupted",
        runtimeState: "idle",
        resumable: true
      };
    case RUN_OUTCOMES.NEEDS_CONFIRMATION:
      return {
        phase: RUN_PHASES.NEEDS_CONFIRMATION,
        activityStatus: "needs_confirmation",
        messageStatus: "interrupted",
        runtimeState: "idle",
        resumable: true
      };
    case RUN_OUTCOMES.UNKNOWN:
      return {
        phase: RUN_PHASES.UNKNOWN,
        activityStatus: "unknown",
        messageStatus: "interrupted",
        runtimeState: "idle",
        resumable: true
      };
    case RUN_OUTCOMES.CANCELLED:
      return {
        phase: RUN_PHASES.CANCELLED,
        activityStatus: "cancelled",
        messageStatus: "aborted",
        runtimeState: "idle",
        resumable: false
      };
    case RUN_OUTCOMES.INTERRUPTED:
      return {
        phase: RUN_PHASES.INTERRUPTED,
        activityStatus: "interrupted",
        messageStatus: "interrupted",
        runtimeState: "idle",
        resumable: true
      };
    case RUN_OUTCOMES.FAILED:
    default:
      return {
        phase: RUN_PHASES.FAILED,
        activityStatus: "failed",
        messageStatus: "complete",
        runtimeState: "error",
        resumable: false
      };
  }
}


export function recoveryOutcomeFromSnapshot(runtimeRecovery) {
  if (Number(runtimeRecovery?.needsConfirmation) > 0) {
    return RUN_OUTCOMES.NEEDS_CONFIRMATION;
  }
  if (Number(runtimeRecovery?.needsReconciliation) > 0) {
    return RUN_OUTCOMES.NEEDS_RECONCILIATION;
  }
  if (Number(runtimeRecovery?.unresolvedCount) > 0) {
    return RUN_OUTCOMES.UNKNOWN;
  }
  return "";
}

export class RunStateMachine {
  constructor({
    startedAt = Date.now()
  } = {}) {
    this.state = {
      phase: RUN_PHASES.EXECUTING,
      outcome: RUN_OUTCOMES.RUNNING,
      executionStopReason: "",
      activityStatus: "running",
      messageStatus: "running",
      runtimeState: "running",
      resumable: false,
      terminal: false,
      startedAt: Math.max(0, Number(startedAt) || Date.now()),
      endedAt: null,
      lastError: ""
    };
  }

  markExecuting() {
    this.assertMutable();
    this.state.phase = RUN_PHASES.EXECUTING;
    this.state.runtimeState = "running";
    return this.snapshot();
  }

  requestCancellation() {
    this.assertMutable();
    this.state.phase = RUN_PHASES.CANCELLING;
    this.state.runtimeState = "cancelling";
    return this.snapshot();
  }

  beginFinalization(executionStopReason) {
    this.assertMutable();
    this.state.phase = RUN_PHASES.FINALIZING;
    this.state.executionStopReason = normalizeRunStopReason(
      executionStopReason,
      RUN_STOP_REASONS.UNKNOWN
    );
    this.state.runtimeState = "running";
    return this.snapshot();
  }

  requireRecovery(runtimeRecovery, {
    executionStopReason = RUN_STOP_REASONS.INTERRUPTED,
    endedAt = Date.now()
  } = {}) {
    const outcome = recoveryOutcomeFromSnapshot(runtimeRecovery);
    if (!outcome) {
      return this.snapshot();
    }
    return this.finalize({
      executionStopReason,
      outcome,
      endedAt
    });
  }

  finalize({
    executionStopReason,
    outcome,
    lastError = "",
    endedAt = Date.now()
  } = {}) {
    if (this.state.terminal) {
      return this.snapshot();
    }

    const normalizedReason = normalizeRunStopReason(
      executionStopReason,
      RUN_STOP_REASONS.UNKNOWN
    );
    const normalizedOutcome = TERMINAL_OUTCOMES.has(outcome)
      ? outcome
      : outcomeFromStopReason(normalizedReason);
    const presentation = presentationForOutcome(normalizedOutcome);

    this.state = {
      ...this.state,
      ...presentation,
      outcome: normalizedOutcome,
      executionStopReason: normalizedReason,
      terminal: true,
      endedAt: Math.max(
        this.state.startedAt,
        Number(endedAt) || Date.now()
      ),
      lastError: String(lastError ?? "").trim()
    };

    return this.snapshot();
  }

  snapshot() {
    return structuredClone(this.state);
  }

  assertMutable() {
    if (this.state.terminal) {
      throw new Error("Run state is already terminal.");
    }
  }
}
