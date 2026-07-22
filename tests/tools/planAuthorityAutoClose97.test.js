import assert from "node:assert/strict";
import { it } from "node:test";

import {
  RunPlanStore
} from "../../electron/agent/orchestration/agentTools.js";

it("automatically closes the active root step after all internal steps complete", () => {
  const store = new RunPlanStore([
    { id: "fix", title: "Fix the test", status: "in_progress" }
  ], { rootPlanId: "thread-1:root" });

  store.updateStepWork("fix", [
    { id: "inspect", title: "Inspect", status: "completed" },
    { id: "change", title: "Change", status: "completed" },
    { id: "verify", title: "Verify", status: "completed" }
  ]);

  assert.equal(store.get()[0].status, "completed");
  assert.equal(store.getState().rootPlanId, "thread-1:root");
  assert.equal(store.getLastChange().rootAutoClosed, true);
});
