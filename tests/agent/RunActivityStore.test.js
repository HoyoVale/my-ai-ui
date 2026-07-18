import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  RunActivityStore
} from "../../electron/agent/RunActivityStore.js";

describe("RunActivityStore", () => {
  it("updates one tool event through its lifecycle", () => {
    const store = new RunActivityStore({
      taskId: "task-1",
      runId: "run-1",
      startedAt: 100
    });

    store.upsertTool({
      id: "call-1",
      name: "read_text_file",
      status: "queued",
      queuedAt: 110,
      input: { path: "src/App.jsx" }
    });
    store.upsertTool({
      id: "call-1",
      name: "read_text_file",
      status: "running",
      queuedAt: 110,
      startedAt: 120,
      input: { path: "src/App.jsx" }
    });
    store.upsertTool({
      id: "call-1",
      name: "read_text_file",
      status: "completed",
      queuedAt: 110,
      startedAt: 120,
      endedAt: 160,
      durationMs: 40,
      result: {
        status: "success",
        summary: "读取完成"
      }
    });

    const toolEvents = store
      .snapshot()
      .events
      .filter((event) => event.type === "tool");

    assert.equal(toolEvents.length, 1);
    assert.equal(toolEvents[0].status, "completed");
    assert.equal(toolEvents[0].tool.durationMs, 40);
    assert.equal(
      toolEvents[0].tool.result.summary,
      "读取完成"
    );
  });

  it("records plan revisions, questions and a final state", () => {
    const store = new RunActivityStore({
      taskId: "task-2",
      runId: "run-2",
      startedAt: 100
    });

    store.recordPlan([
      {
        id: "step-1",
        title: "Inspect",
        status: "in_progress"
      }
    ], 110);
    store.recordQuestion({
      question: "Continue?",
      options: []
    }, 120);
    const snapshot = store.finalize(
      "waiting_for_user",
      130
    );

    assert.equal(snapshot.status, "waiting_for_user");
    assert.equal(snapshot.stopReason, "waiting_for_user");
    assert.equal(
      snapshot.events.some((event) => event.type === "plan"),
      true
    );
    assert.equal(
      snapshot.events.some((event) => event.type === "question"),
      true
    );
  });
});
