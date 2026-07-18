import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  createFallbackFinalSummary,
  createFinalizationInstruction,
  getPlanCompletionState,
  shouldRunFinalization
} from "../../electron/agent/finalization.js";

import {
  RUN_STOP_REASONS
} from "../../electron/agent/runStopReasons.js";

const completePlan = [
  {
    id: "one",
    title: "Inspect",
    status: "completed"
  },
  {
    id: "two",
    title: "Summarize",
    status: "completed"
  }
];

describe("agent finalization phase", () => {
  it("reserves a final answer after a completed tool-only plan hits the execution step limit", () => {
    assert.equal(
      shouldRunFinalization({
        plan: completePlan,
        records: [
          {
            name: "calculator",
            status: "completed"
          }
        ],
        finishReason: "tool-calls",
        stopReason:
          RUN_STOP_REASONS.AGENT_STEP_LIMIT,
        finalText: ""
      }),
      true
    );

    assert.equal(
      getPlanCompletionState(
        completePlan
      ).isComplete,
      true
    );
  });

  it("does not finalize while waiting for the user", () => {
    assert.equal(
      shouldRunFinalization({
        pendingQuestion: {
          question: "Choose"
        },
        plan: completePlan,
        records: [{}],
        finishReason: "tool-calls",
        stopReason:
          RUN_STOP_REASONS.WAITING_FOR_USER
      }),
      false
    );
  });

  it("builds a tool-free finalization instruction that consumes an answered checkpoint", () => {
    const instruction =
      createFinalizationInstruction({
        plan: completePlan,
        records: [
          {
            name: "get_current_time",
            title: "Get current time",
            status: "completed",
            result: {
              summary: "Current time loaded"
            }
          }
        ],
        answeredQuestion: {
          question: "Choose A or B",
          answer: "A"
        }
      });

    assert.match(
      instruction,
      /Do not call tools/u
    );
    assert.match(
      instruction,
      /Do not ask the same question again/u
    );
    assert.match(
      instruction,
      /Current time loaded/u
    );
  });

  it("creates a deterministic fallback summary when the model returns no final text", () => {
    const summary =
      createFallbackFinalSummary({
        plan: completePlan,
        records: [
          {
            name: "calculator",
            title: "Calculate",
            status: "completed",
            result: {
              summary: "2 + 2 = 4"
            }
          }
        ]
      });

    assert.match(summary, /计划已执行完成/u);
    assert.match(summary, /2 \+ 2 = 4/u);
  });
});
