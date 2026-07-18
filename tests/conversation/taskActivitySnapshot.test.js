import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  createActivitySnapshot
} from "../../src/Conversation/utils/taskActivity.js";

function assistantMessage({
  id,
  runId,
  startedAt
}) {
  return {
    id,
    role: "assistant",
    taskId: "task-1",
    activity: {
      version: 1,
      taskId: "task-1",
      runId,
      status: "completed",
      startedAt,
      endedAt: startedAt + 10,
      durationMs: 10,
      stopReason: "completed",
      events: [
        {
          id: "tool:call-1",
          type: "tool",
          sequence: 0,
          status: "completed",
          createdAt: startedAt,
          updatedAt: startedAt + 10,
          tool: {
            id: "call-1",
            name: "read_text_file",
            status: "completed"
          }
        }
      ]
    }
  };
}

describe("task activity snapshots", () => {
  it("isolates activity to the selected assistant message and run", () => {
    const first = assistantMessage({
      id: "message-1",
      runId: "run-1",
      startedAt: 100
    });
    const second = assistantMessage({
      id: "message-2",
      runId: "run-2",
      startedAt: 200
    });
    const conversation = {
      messages: [first, second]
    };

    const snapshot = createActivitySnapshot(
      second,
      { conversation }
    );

    assert.equal(snapshot.toolCalls.length, 1);
    assert.equal(snapshot.messageId, "message-2");
    assert.equal(snapshot.runId, "run-2");
    assert.match(snapshot.toolCalls[0].activityId, /^run-2:/u);
  });
});
