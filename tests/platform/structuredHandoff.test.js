import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createStructuredHandoff,
  validateStructuredHandoff
} from "../../electron/platform/StructuredHandoff.js";

describe("Structured Handoff", () => {
  it("binds the handoff to the task, agent and graph revision", () => {
    const run = { goalRevision: 2, taskGraphRevision: 4 };
    const task = { id: "task" };
    const agentRun = { id: "agent", role: "implementer", attempt: 1 };
    const handoff = createStructuredHandoff({
      run,
      task,
      agentRun,
      checkpoint: { commit: "abc", baselineCommit: "base", changed: true },
      result: { ok: true, summary: "done", evidence: ["receipt"] },
      now: () => 123
    });

    assert.equal(validateStructuredHandoff(handoff, { run, task, agentRun }).ok, true);
    assert.equal(
      validateStructuredHandoff({ ...handoff, taskId: "other" }, { run, task, agentRun }).code,
      "handoff-fingerprint-invalid"
    );
    assert.equal(
      validateStructuredHandoff({ ...handoff, fingerprint: "" }, { run, task, agentRun }).code,
      "handoff-fingerprint-missing"
    );
    assert.equal(
      validateStructuredHandoff(handoff, {
        run: { ...run, taskGraphRevision: 5 },
        task,
        agentRun
      }).code,
      "handoff-task-graph-stale"
    );
  });
});
