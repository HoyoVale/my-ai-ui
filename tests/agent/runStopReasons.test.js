import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyLatestToolFailure,
  inferRunStopReason,
  isGracefulRunBoundary,
  isRecoverableRunFailure,
  normalizeRunStopReason,
  RUN_STOP_REASONS,
  runStatusFromStopReason
} from "../../electron/agent/runStopReasons.js";

describe("run stop reasons", () => {
  it("migrates legacy names to canonical stop reasons", () => {
    assert.equal(normalizeRunStopReason("user_input_required"), RUN_STOP_REASONS.NEEDS_INPUT);
    assert.equal(normalizeRunStopReason("waiting_for_user"), RUN_STOP_REASONS.NEEDS_INPUT);
    assert.equal(normalizeRunStopReason("step_limit"), RUN_STOP_REASONS.AGENT_STEP_LIMIT);
    assert.equal(normalizeRunStopReason("aborted"), RUN_STOP_REASONS.CANCELLED_BY_USER);
  });

  it("prioritizes plan input requirements and concrete tool failures", () => {
    assert.equal(inferRunStopReason({ plan: [{ id: "folder", title: "Choose folder", status: "needs_input" }] }), RUN_STOP_REASONS.NEEDS_INPUT);
    assert.equal(inferRunStopReason({ records: [{ result: { error: { code: "TOOL_TIMEOUT" } } }] }), RUN_STOP_REASONS.TOOL_TIMEOUT);
  });

  it("maps canonical reasons to stable run states", () => {
    assert.equal(runStatusFromStopReason("completed"), "completed");
    assert.equal(runStatusFromStopReason("waiting_for_user"), "needs_input");
    assert.equal(runStatusFromStopReason("needs_input"), "needs_input");
    assert.equal(runStatusFromStopReason("blocked"), "blocked");
    assert.equal(runStatusFromStopReason("cancelled_by_user"), "cancelled");
    assert.equal(runStatusFromStopReason("tool_error"), "failed");
  });

  it("maps internal execution boundaries to a resumable checkpoint state", () => {
    for (const reason of [
      RUN_STOP_REASONS.AGENT_STEP_LIMIT,
      RUN_STOP_REASONS.AGENT_SEGMENT_LIMIT,
      RUN_STOP_REASONS.TOOL_CALL_LIMIT,
      RUN_STOP_REASONS.AGENT_RUN_TIMEOUT,
      RUN_STOP_REASONS.REPEATED_TOOL_CALL,
      RUN_STOP_REASONS.NO_PROGRESS,
      RUN_STOP_REASONS.MODEL_RECOVERY
    ]) {
      assert.equal(isGracefulRunBoundary(reason), true);
      assert.equal(runStatusFromStopReason(reason), "checkpoint_ready");
    }
  });

  it("does not report completion while planned work remains", () => {
    assert.equal(inferRunStopReason({ finishReason: "stop", plan: [{ id: "one", title: "Work", status: "pending" }] }), RUN_STOP_REASONS.PLAN_INCOMPLETE);
  });

  it("treats missing input and blocked plans as explicit terminal states", () => {
    assert.equal(inferRunStopReason({ plan: [{ id: "one", title: "Input", status: "needs_input" }] }), RUN_STOP_REASONS.NEEDS_INPUT);
    assert.equal(inferRunStopReason({ plan: [{ id: "one", title: "Blocked", status: "blocked" }] }), RUN_STOP_REASONS.BLOCKED);
  });

  it("distinguishes recoverable tool mistakes from fatal tool failures", () => {
    const recoverableRecords = [{
      name: "replace_text_in_file",
      status: "failed",
      result: {
        error: {
          code: "TEXT_NOT_FOUND",
          category: "not_found",
          message: "Old text no longer exists",
          retryable: false
        }
      }
    }];
    const fatalRecords = [{
      name: "write_text_file",
      status: "failed",
      result: {
        error: {
          code: "PERMISSION_DENIED",
          category: "permission_denied",
          message: "Denied",
          retryable: false
        }
      }
    }];

    assert.equal(classifyLatestToolFailure(recoverableRecords).recoverable, true);
    assert.equal(isRecoverableRunFailure({
      stopReason: RUN_STOP_REASONS.TOOL_ERROR,
      records: recoverableRecords
    }), true);
    assert.equal(isRecoverableRunFailure({
      stopReason: RUN_STOP_REASONS.TOOL_ERROR,
      records: fatalRecords
    }), false);
    assert.equal(isRecoverableRunFailure({
      stopReason: RUN_STOP_REASONS.TOOL_ERROR,
      records: []
    }), false);
  });

});
