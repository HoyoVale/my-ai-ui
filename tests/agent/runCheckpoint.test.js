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
      phase: "executing",
      plan: [{ id: "one", title: "Inspect", status: "completed" }],
      answeredQuestions: [{ question: "Mode?", answer: "Safe" }]
    });
    const instruction = createCheckpointInstruction(checkpoint);

    assert.match(instruction, /Persisted run checkpoint/);
    assert.match(instruction, /\[completed\] Inspect/);
    assert.match(instruction, /Mode\?: Safe/);
  });
});
