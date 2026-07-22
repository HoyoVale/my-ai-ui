import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  RunPlanStore
} from "../../electron/agent/orchestration/agentTools.js";

describe("Plan replanning foundation", () => {
  it("preserves completed work and supersedes omitted unfinished steps", () => {
    const store = new RunPlanStore([
      { id: "one", title: "Done", status: "completed" },
      { id: "two", title: "Old active", status: "in_progress" },
      { id: "three", title: "Old pending", status: "pending" }
    ]);

    const plan = store.replan([
      { id: "one", title: "Done", status: "completed" },
      { id: "four", title: "New active", status: "in_progress" },
      { id: "five", title: "New pending", status: "pending" }
    ], {
      reason: "The runtime layer is the real root cause",
      failedAssumption: "The old implementation path was sufficient"
    });

    assert.equal(plan.find((item) => item.id === "one").status, "completed");
    assert.equal(plan.find((item) => item.id === "two").status, "superseded");
    assert.equal(plan.find((item) => item.id === "three").status, "superseded");
    assert.equal(plan.find((item) => item.id === "four").status, "in_progress");
    assert.match(
      plan.find((item) => item.id === "two").reason,
      /root cause/
    );
  });

  it("reports terminal and successful states separately", () => {
    const store = new RunPlanStore([
      { id: "one", title: "Done", status: "completed" },
      { id: "two", title: "No longer needed", status: "skipped" },
      { id: "three", title: "Replaced", status: "superseded" }
    ]);
    const state = store.getExecutionState();

    assert.equal(state.canFinish, true);
    assert.equal(state.isSuccessful, true);
    assert.equal(state.terminal, 3);
  });
});

it("bounds superseded plan history during repeated replanning", () => {
  const store = new RunPlanStore();

  store.update([
    { id: "step-0", title: "Revision 0", status: "in_progress" }
  ]);
  for (let index = 1; index < 75; index += 1) {
    store.replan([
      {
        id: `step-${index}`,
        title: `Revision ${index}`,
        status: "in_progress"
      }
    ], {
      reason: `revision-${index}`,
      failedAssumption: `assumption-${index - 1}`
    });
  }

  const state = store.getExecutionState();
  assert.equal(state.total, 40);
  assert.equal(state.active.id, "step-74");
  assert.equal(state.archived > 0, true);
});
