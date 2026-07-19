import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  RunPlanStore
} from "../../electron/agent/orchestration/agentTools.js";

import {
  createAgentToolSession
} from "../../electron/tools/createAgentToolSession.js";

describe("executable task plans", () => {
  it("requires exactly one active step while unfinished work remains", () => {
    const store = new RunPlanStore();

    assert.throws(
      () => {
        store.update([
          {
            id: "one",
            title: "Inspect",
            status: "pending"
          },
          {
            id: "two",
            title: "Summarize",
            status: "pending"
          }
        ]);
      },
      /必须且只能有一个进行中的步骤/u
    );
  });

  it("tracks the active step and completion state", () => {
    const store = new RunPlanStore();

    store.update([
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
    ]);

    assert.equal(
      store.getExecutionState().active.id,
      "one"
    );
    assert.equal(
      store.getExecutionState().canFinish,
      false
    );

    store.update([
      {
        id: "one",
        title: "Inspect",
        status: "completed"
      },
      {
        id: "two",
        title: "Summarize",
        status: "in_progress"
      }
    ]);

    assert.equal(
      store.getExecutionState().active.id,
      "two"
    );
  });

  it("accepts needs_input as an unsuccessful terminal plan state", () => {
    const store = new RunPlanStore();

    store.update([
      {
        id: "path",
        title: "Read requested file",
        status: "needs_input",
        reason: "File path is missing"
      }
    ]);

    const state = store.getExecutionState();

    assert.equal(state.hasUnfinished, false);
    assert.equal(state.canFinish, true);
    assert.equal(state.needsInput, 1);
    assert.equal(state.isSuccessful, false);
    assert.equal(
      store.canRunTool("calculator").code,
      "PLAN_STEP_REQUIRED"
    );
  });

  it("blocks ordinary tools when a plan has no active step", async () => {
    const session = createAgentToolSession({
      initialPlan: [
        {
          id: "one",
          title: "Inspect",
          status: "pending"
        }
      ]
    });

    const result = await session.tools
      .calculator.execute(
        {
          expression: "1 + 1"
        },
        {
          toolCallId: "plan-guard"
        }
      );

    assert.equal(result.ok, false);
    assert.equal(
      result.error.code,
      "PLAN_STEP_REQUIRED"
    );
  });

  it("associates tool activity with the active plan step", async () => {
    const session = createAgentToolSession({
      initialPlan: [
        {
          id: "one",
          title: "Calculate",
          status: "in_progress"
        }
      ]
    });

    await session.tools.calculator.execute(
      {
        expression: "2 + 2"
      },
      {
        toolCallId: "plan-step-call"
      }
    );

    assert.deepEqual(
      session.getRecords()[0].planStep,
      {
        id: "one",
        title: "Calculate"
      }
    );
  });
});

it("keeps an accepted plan update when its observer throws", () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...values) => {
    warnings.push(values);
  };

  try {
    const store = new RunPlanStore([], {
      onChange: () => {
        throw new Error("renderer disconnected");
      }
    });

    const plan = store.update([
      {
        id: "one",
        title: "Inspect",
        status: "in_progress"
      }
    ]);

    assert.equal(plan[0].status, "in_progress");
    assert.equal(store.get()[0].id, "one");
    assert.equal(store.getLastChange().revision, 1);
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
  }
});
