import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createFallbackFinalSummary,
  createFinalizationInstruction,
  getPlanCompletionState,
  sanitizeFinalizationText,
  shouldRunFinalization
} from "../../electron/agent/finalization.js";
import { RUN_STOP_REASONS } from "../../electron/agent/runStopReasons.js";

const completePlan = [
  { id: "one", title: "Inspect", status: "completed" },
  { id: "two", title: "Summarize", status: "completed" }
];

describe("agent finalization phase", () => {
  it("reserves a final answer after a completed tool-only plan hits the execution step limit", () => {
    assert.equal(shouldRunFinalization({
      plan: completePlan,
      records: [{ name: "calculator", status: "completed" }],
      finishReason: "tool-calls",
      stopReason: RUN_STOP_REASONS.AGENT_STEP_LIMIT,
      finalText: ""
    }), true);
    assert.equal(getPlanCompletionState(completePlan).isComplete, true);
  });

  it("builds a tool-free finalization instruction from plan and tool results", () => {
    const instruction = createFinalizationInstruction({
      plan: completePlan,
      records: [{
        name: "get_current_time",
        title: "Get current time",
        status: "completed",
        result: { summary: "Current time loaded" }
      }]
    });

    assert.match(instruction, /Do not call tools/u);
    assert.match(instruction, /Current time loaded/u);
    assert.doesNotMatch(instruction, /answered checkpoint|same question/u);
  });

  it("creates a deterministic fallback summary when the model returns no final text", () => {
    const summary = createFallbackFinalSummary({
      plan: completePlan,
      records: [{
        name: "calculator",
        title: "Calculate",
        status: "completed",
        result: { summary: "2 + 2 = 4" }
      }]
    });

    assert.match(summary, /计划已执行完成/u);
    assert.match(summary, /2 \+ 2 = 4/u);
  });

  it("uses the same natural handoff for tool, step, timeout and model boundaries", () => {
    const reasons = [
      RUN_STOP_REASONS.TOOL_CALL_LIMIT,
      RUN_STOP_REASONS.AGENT_STEP_LIMIT,
      RUN_STOP_REASONS.AGENT_RUN_TIMEOUT,
      RUN_STOP_REASONS.REPEATED_TOOL_CALL,
      RUN_STOP_REASONS.NO_PROGRESS,
      RUN_STOP_REASONS.MODEL_RECOVERY
    ];
    const plan = [{ id: "next", title: "Continue remaining work", status: "in_progress" }];

    for (const reason of reasons) {
      const instruction = createFinalizationInstruction({ plan, executionStopReason: reason });
      const fallback = createFallbackFinalSummary({ plan, executionStopReason: reason });
      const sanitized = sanitizeFinalizationText(`Reached the maximum tool limit. ${reason} checkpoint_ready`, reason);

      assert.match(instruction, /natural progress handoff/u);
      assert.doesNotMatch(instruction, /Execution stop reason/u);
      assert.match(fallback, /下一步建议/u);
      assert.doesNotMatch(fallback, new RegExp(reason, "iu"));
      assert.doesNotMatch(sanitized, /limit|checkpoint_ready|agent_|tool_|no_progress|model_error/iu);
    }
  });

  it("presents a recoverable tool error as a progress handoff", () => {
    const plan = [{ id: "edit", title: "Retry the edit", status: "in_progress" }];
    const records = [{
      name: "replace_text_in_file",
      status: "failed",
      result: {
        error: {
          code: "TEXT_NOT_FOUND",
          category: "not_found",
          message: "The target text changed"
        }
      }
    }];
    const instruction = createFinalizationInstruction({
      plan,
      records,
      executionStopReason: RUN_STOP_REASONS.TOOL_ERROR
    });
    const fallback = createFallbackFinalSummary({
      plan,
      records,
      executionStopReason: RUN_STOP_REASONS.TOOL_ERROR
    });

    assert.match(instruction, /natural progress handoff/u);
    assert.doesNotMatch(instruction, /Execution stop reason/u);
    assert.match(fallback, /下一步建议/u);
    assert.doesNotMatch(fallback, /tool_error/u);
  });

  it("turns the segment boundary into a natural progress handoff", () => {
    const plan = [
      { id: "one", title: "Inspect", status: "completed" },
      { id: "two", title: "Implement continuation", status: "in_progress" }
    ];
    const instruction = createFinalizationInstruction({ plan, executionStopReason: RUN_STOP_REASONS.AGENT_SEGMENT_LIMIT });
    const fallback = createFallbackFinalSummary({ plan, executionStopReason: RUN_STOP_REASONS.AGENT_SEGMENT_LIMIT });
    const sanitized = sanitizeFinalizationText(
      "已达到任务分段上限，checkpoint_ready。下一步从 checkpoint 继续。",
      RUN_STOP_REASONS.AGENT_SEGMENT_LIMIT
    );

    assert.match(instruction, /natural progress handoff/u);
    assert.match(instruction, /recommended next action/u);
    assert.doesNotMatch(fallback, /agent_segment_limit|分段/u);
    assert.match(fallback, /下一步建议/u);
    assert.match(fallback, /Implement continuation/u);
    assert.doesNotMatch(sanitized, /分段上限|checkpoint/iu);
    assert.match(sanitized, /下一步/u);
  });
});
