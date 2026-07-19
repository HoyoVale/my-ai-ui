import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  compactRunStepContext
} from "../../electron/agent/contextCompaction.js";
import {
  createRunCheckpoint
} from "../../electron/agent/runCheckpoint.js";

describe("long Tool-flow context compaction", () => {
  it("keeps recent complete response messages and replaces older details with a checkpoint", () => {
    const initialMessages = [
      { role: "user", content: "Do a long task" }
    ];
    const responseMessages = Array.from({ length: 14 }, (_, index) => ({
      role: index % 2 === 0 ? "assistant" : "tool",
      content: "x".repeat(500)
    }));
    const checkpoint = createRunCheckpoint({
      plan: [{ id: "one", title: "Inspect", status: "completed" }]
    });

    const result = compactRunStepContext({
      initialMessages,
      responseMessages,
      checkpoint,
      contextTokenBudget: 1200,
      outputReserve: 200,
      maxRecentMessages: 4
    });

    assert.equal(result.compacted, true);
    assert.ok(result.removedMessages > 0);
    assert.equal(result.messages[0].role, "user");
    assert.notEqual(result.messages[1]?.role, "tool");
    assert.match(result.checkpointInstruction, /Saved task state/);
  });

  it("does not compact below the budget threshold", () => {
    const result = compactRunStepContext({
      initialMessages: [{ role: "user", content: "short" }],
      responseMessages: [],
      checkpoint: createRunCheckpoint(),
      contextTokenBudget: 64000,
      outputReserve: 4000
    });

    assert.equal(result.compacted, false);
    assert.equal(result.removedMessages, 0);
  });
});
