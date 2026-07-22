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

  it("always allows paged result reads after a terminal plan", async () => {
    const session = createAgentToolSession({
      initialPlan: [
        {
          id: "one",
          title: "Done",
          status: "completed"
        }
      ]
    });

    const result = await session.tools.read_tool_result.execute(
      {
        resultId: "missing-result",
        offset: 0,
        limit: 500
      },
      { toolCallId: "read-result-after-plan" }
    );

    assert.notEqual(result.error?.code, "PLAN_STEP_REQUIRED");
    await session.closePersistence();
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

describe("Plan Core 2.0 root and internal step work", () => {
  it("migrates a legacy flat plan into a versioned root plan", () => {
    const store = new RunPlanStore([
      { id: "root", title: "Inspect", status: "in_progress" }
    ]);

    const state = store.getState();
    assert.equal(state.schemaVersion, 3);
    assert.equal(state.rootItems.length, 1);
    assert.deepEqual(state.subplans, []);
  });

  it("keeps internal step work separate from the user-visible root plan", () => {
    const changes = [];
    const store = new RunPlanStore([
      { id: "root", title: "Implement", status: "in_progress" }
    ], {
      onChange: (_plan, change) => changes.push(change)
    });

    const stepWork = store.updateStepWork("root", [
      { id: "read", title: "Read files", status: "completed" },
      { id: "edit", title: "Edit code", status: "in_progress" }
    ]);

    assert.equal(store.get().length, 1);
    assert.equal(store.get()[0].title, "Implement");
    assert.equal(stepWork.items.length, 2);
    assert.equal(store.getExecutionState().canFinish, false);
    assert.equal(changes.at(-1).scope, "step_work");
    assert.equal(changes.at(-1).planState.subplans.length, 1);
  });

  it("does not let unfinished internal work block a completed root plan", () => {
    const store = new RunPlanStore([
      { id: "root", title: "Implement", status: "in_progress" }
    ]);
    store.updateStepWork("root", [
      { id: "detail", title: "Optional cleanup", status: "in_progress" }
    ]);

    store.update([
      { id: "root", title: "Implement", status: "completed" }
    ]);

    const state = store.getExecutionState();
    assert.equal(state.canFinish, true);
    assert.equal(state.isSuccessful, true);
    assert.equal(
      store.getStepWork("root").items[0].status,
      "superseded"
    );
  });

  it("only allows internal work for the active root step", () => {
    const store = new RunPlanStore([
      { id: "one", title: "Done", status: "completed" },
      { id: "two", title: "Active", status: "in_progress" }
    ]);

    assert.throws(
      () => store.updateStepWork("one", [
        { id: "detail", title: "Late detail", status: "in_progress" }
      ]),
      (error) => error?.code === "PLAN_ROOT_STEP_NOT_ACTIVE"
    );
  });
});

