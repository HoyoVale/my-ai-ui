import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RunPlanStore,
  createAgentToolDefinitions
} from "../../electron/agent/orchestration/agentTools.js";

describe("Plan Authority 3.0", () => {
  it("keeps the root plan id stable and rejects structural updates", () => {
    const store = new RunPlanStore([], { rootPlanId: "goal-1:root-plan" });
    store.update([
      { id: "inspect", title: "Inspect", status: "in_progress" },
      { id: "implement", title: "Implement", status: "pending" }
    ]);
    const rootPlanId = store.getState().rootPlanId;

    assert.throws(
      () => store.update([
        { id: "replace", title: "Replace everything", status: "in_progress" }
      ]),
      (error) => error?.code === "PLAN_REPLAN_REQUIRED"
    );
    assert.equal(store.getState().rootPlanId, rootPlanId);
  });

  it("never lets an ordinary progress update regress completed work", () => {
    const store = new RunPlanStore([
      { id: "inspect", title: "Inspect", status: "completed" },
      { id: "implement", title: "Implement", status: "in_progress" }
    ]);

    assert.throws(
      () => store.update([
        { id: "inspect", title: "Inspect", status: "pending" },
        { id: "implement", title: "Implement", status: "in_progress" }
      ]),
      (error) => error?.code === "PLAN_REPLAN_REQUIRED"
    );
    assert.equal(store.get()[0].status, "completed");
  });

  it("resumes blocked or input-waiting work without replacing the root plan", () => {
    const store = new RunPlanStore([
      { id: "inspect", title: "Inspect", status: "completed" },
      { id: "implement", title: "Implement", status: "blocked", reason: "Application restarted" },
      { id: "verify", title: "Verify", status: "pending" }
    ], { rootPlanId: "goal-1:root-plan" });

    store.update([
      { id: "inspect", title: "Inspect", status: "completed" },
      { id: "implement", title: "Implement", status: "in_progress" },
      { id: "verify", title: "Verify", status: "pending" }
    ], { reason: "Resume from the saved checkpoint" });

    assert.equal(store.getState().rootPlanId, "goal-1:root-plan");
    assert.equal(store.get().find((item) => item.id === "implement").status, "in_progress");
    assert.equal(store.get().find((item) => item.id === "inspect").status, "completed");
  });

  it("requires the dedicated replan interface for structural changes", () => {
    const store = new RunPlanStore([
      { id: "inspect", title: "Inspect", status: "completed" },
      { id: "implement", title: "Implement", status: "in_progress" }
    ], { rootPlanId: "goal-1:root-plan", runId: "run-2" });

    const plan = store.replan([
      { id: "inspect", title: "Inspect", status: "completed" },
      { id: "camera", title: "Correct camera", status: "in_progress" }
    ], {
      reason: "Visual evidence invalidated the original implementation phase",
      failedAssumption: "The default camera was sufficient"
    });

    assert.equal(plan.find((item) => item.id === "inspect").status, "completed");
    assert.equal(plan.find((item) => item.id === "implement").status, "superseded");
    assert.equal(store.getState().rootPlanId, "goal-1:root-plan");
    assert.equal(store.getState().replanRevision, 1);
  });

  it("requires both a replan reason and the failed assumption", () => {
    const store = new RunPlanStore([
      { id: "implement", title: "Implement", status: "in_progress" }
    ]);

    assert.throws(
      () => store.replan([
        { id: "camera", title: "Correct camera", status: "in_progress" }
      ], { reason: "Visual evidence changed" }),
      (error) => error?.code === "PLAN_REPLAN_ASSUMPTION_REQUIRED"
    );
  });

  it("accepts progress updates that echo read-only superseded history", () => {
    const store = new RunPlanStore([
      { id: "inspect", title: "Inspect", status: "completed" },
      { id: "implement", title: "Implement", status: "in_progress" }
    ], { rootPlanId: "goal-1:root-plan" });
    const replanned = store.replan([
      { id: "inspect", title: "Inspect", status: "completed" },
      { id: "camera", title: "Correct camera", status: "in_progress" }
    ], {
      reason: "Camera evidence changed",
      failedAssumption: "The previous camera task was sufficient"
    });

    store.update(replanned.map((item) =>
      item.id === "camera"
        ? { ...item, status: "completed" }
        : item
    ));

    assert.equal(store.get().find((item) => item.id === "camera").status, "completed");
    assert.equal(store.get().find((item) => item.id === "implement").status, "superseded");
  });

  it("serializes all root plan control tools through one concurrency key", () => {
    const definitions = createAgentToolDefinitions({
      planStore: new RunPlanStore()
    });
    for (const name of ["update_plan", "replan_goal", "update_step_work"]) {
      assert.equal(
        definitions.find((definition) => definition.name === name).concurrencyKey,
        "control:goal-plan"
      );
      assert.equal(
        definitions.find((definition) => definition.name === name).exclusiveConcurrency,
        true
      );
    }
  });
});
