import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  RunStateMachine,
  RUN_OUTCOMES,
  RUN_PHASES
} from "../../electron/agent/RunStateMachine.js";

import {
  RUN_STOP_REASONS
} from "../../electron/agent/runStopReasons.js";

describe("RunStateMachine", () => {
  it("keeps the real execution reason while presenting a resumable handoff", () => {
    const machine = new RunStateMachine({
      startedAt: 100
    });

    machine.beginFinalization(
      RUN_STOP_REASONS.TOOL_CALL_LIMIT
    );
    const state = machine.finalize({
      executionStopReason:
        RUN_STOP_REASONS.TOOL_CALL_LIMIT,
      endedAt: 200
    });

    assert.equal(
      state.executionStopReason,
      RUN_STOP_REASONS.TOOL_CALL_LIMIT
    );
    assert.equal(
      state.outcome,
      RUN_OUTCOMES.CONTINUABLE
    );
    assert.equal(
      state.phase,
      RUN_PHASES.CHECKPOINT_READY
    );
    assert.equal(state.activityStatus, "checkpoint_ready");
    assert.equal(state.messageStatus, "complete");
    assert.equal(state.runtimeState, "idle");
    assert.equal(state.resumable, true);
    assert.equal(state.terminal, true);
  });

  it("maps cancellation to one consistent terminal presentation", () => {
    const machine = new RunStateMachine();

    const cancelling = machine.requestCancellation();
    assert.equal(cancelling.phase, RUN_PHASES.CANCELLING);
    assert.equal(cancelling.runtimeState, "cancelling");

    const cancelled = machine.finalize({
      executionStopReason:
        RUN_STOP_REASONS.CANCELLED_BY_USER,
      outcome: RUN_OUTCOMES.CANCELLED
    });

    assert.equal(cancelled.phase, RUN_PHASES.CANCELLED);
    assert.equal(cancelled.activityStatus, "cancelled");
    assert.equal(cancelled.messageStatus, "aborted");
    assert.equal(cancelled.outcome, RUN_OUTCOMES.CANCELLED);
  });

  it("does not let later branches overwrite a terminal state", () => {
    const machine = new RunStateMachine();
    const completed = machine.finalize({
      executionStopReason: RUN_STOP_REASONS.COMPLETED,
      outcome: RUN_OUTCOMES.COMPLETED,
      endedAt: 100
    });
    const second = machine.finalize({
      executionStopReason: RUN_STOP_REASONS.MODEL_ERROR,
      outcome: RUN_OUTCOMES.FAILED,
      endedAt: 200
    });

    assert.deepEqual(second, completed);
    assert.throws(
      () => machine.markExecuting(),
      /already terminal/u
    );
  });
});
