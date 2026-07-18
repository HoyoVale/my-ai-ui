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

    const plan = store.update([
      { id: "four", title: "New active", status: "in_progress" },
      { id: "five", title: "New pending", status: "pending" }
    ], { reason: "The runtime layer is the real root cause" });

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
