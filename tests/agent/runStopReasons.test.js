import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  inferRunStopReason,
  normalizeRunStopReason,
  RUN_STOP_REASONS,
  runStatusFromStopReason
} from "../../electron/agent/runStopReasons.js";

describe("run stop reasons", () => {
  it("migrates legacy names to canonical stop reasons", () => {
    assert.equal(
      normalizeRunStopReason("user_input_required"),
      RUN_STOP_REASONS.WAITING_FOR_USER
    );
    assert.equal(
      normalizeRunStopReason("step_limit"),
      RUN_STOP_REASONS.AGENT_STEP_LIMIT
    );
    assert.equal(
      normalizeRunStopReason("aborted"),
      RUN_STOP_REASONS.CANCELLED_BY_USER
    );
  });

  it("prioritizes waiting and concrete tool failures", () => {
    assert.equal(
      inferRunStopReason({
        pendingQuestion: {
          question: "Which folder?"
        }
      }),
      RUN_STOP_REASONS.WAITING_FOR_USER
    );

    assert.equal(
      inferRunStopReason({
        records: [
          {
            result: {
              error: {
                code: "TOOL_TIMEOUT"
              }
            }
          }
        ]
      }),
      RUN_STOP_REASONS.TOOL_TIMEOUT
    );
  });

  it("maps canonical reasons to stable run states", () => {
    assert.equal(
      runStatusFromStopReason("completed"),
      "completed"
    );
    assert.equal(
      runStatusFromStopReason("waiting_for_user"),
      "waiting_for_user"
    );
    assert.equal(
      runStatusFromStopReason("cancelled_by_user"),
      "cancelled"
    );
    assert.equal(
      runStatusFromStopReason("tool_error"),
      "failed"
    );
  });
  it("does not report completion while planned work remains", () => {
    assert.equal(
      inferRunStopReason({
        plan: [
          {
            id: "one",
            title: "Inspect",
            status: "in_progress"
          },
          {
            id: "two",
            title: "Summarize",
            status: "pending"
          }
        ]
      }),
      RUN_STOP_REASONS.PLAN_INCOMPLETE
    );
  });

});
