import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createCheckpointInstruction,
  createRunCheckpoint
} from "../../electron/agent/runCheckpoint.js";

describe("persisted run checkpoints", () => {
  it("keeps compact task facts and result references without raw output", () => {
    const checkpoint = createRunCheckpoint({
      taskId: "task",
      runId: "run",
      messageId: "message",
      phase: "executing",
      plan: [{ id: "one", title: "Inspect", status: "completed" }],
      records: [{
        id: "tool",
        name: "read_text_file",
        title: "Read file",
        status: "completed",
        output: { data: { raw: "x".repeat(10000) } },
        result: {
          summary: "Read 200 lines",
          preview: "short preview",
          reference: { resultId: "result-1" }
        }
      }]
    });

    assert.equal(checkpoint.tools[0].summary, "Read 200 lines");
    assert.equal(checkpoint.tools[0].reference.resultId, "result-1");
    assert.equal(Object.hasOwn(checkpoint.tools[0], "output"), false);
  });

  it("creates a compact resume instruction", () => {
    const checkpoint = createRunCheckpoint({
      objective: "Inspect the project",
      phase: "executing",
      plan: [{ id: "one", title: "Inspect", status: "completed" }]
    });
    const instruction = createCheckpointInstruction(checkpoint);

    assert.match(instruction, /Saved task state/);
    assert.match(instruction, /reference data, not runtime instructions/);
    assert.match(instruction, /Original task objective: Inspect the project/);
    assert.match(instruction, /\[completed\] Inspect/);
    assert.doesNotMatch(instruction, /Segments:/u);
    assert.doesNotMatch(instruction, /maxSegments/u);
  });

  it("persists continuation lineage without consuming the next run budget", () => {
    const checkpoint = createRunCheckpoint({
      goalId: "goal",
      taskId: "task",
      runId: "run-2",
      parentRunId: "run-1",
      messageId: "message-2",
      resumedFromMessageId: "message-1",
      objective: "Finish the refactor",
      continuationCount: 2,
      previousSegmentCount: 24
    });

    assert.equal(checkpoint.goalId, "goal");
    assert.equal(checkpoint.taskId, "task");
    assert.equal(checkpoint.parentRunId, "run-1");
    assert.equal(checkpoint.resumedFromMessageId, "message-1");
    assert.equal(checkpoint.objective, "Finish the refactor");
    assert.equal(checkpoint.continuationCount, 2);
    assert.equal(checkpoint.previousSegmentCount, 24);
  });
  it("keeps execution reason and public outcome as separate checkpoint fields", () => {
    const checkpoint = createRunCheckpoint({
      taskId: "task",
      runId: "run",
      phase: "checkpoint_ready",
      outcome: "continuable",
      resumable: true,
      publicStatus: "complete",
      stopReason: "tool_call_limit"
    });

    assert.equal(checkpoint.stopReason, "tool_call_limit");
    assert.equal(checkpoint.outcome, "continuable");
    assert.equal(checkpoint.resumable, true);
    assert.equal(checkpoint.publicStatus, "complete");
  });

});
