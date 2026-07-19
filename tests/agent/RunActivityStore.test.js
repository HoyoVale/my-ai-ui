import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RunActivityStore } from "../../electron/agent/RunActivityStore.js";

describe("RunActivityStore", () => {
  it("updates one tool event through its lifecycle", () => {
    const store = new RunActivityStore({ taskId: "task-1", runId: "run-1", startedAt: 100 });
    store.upsertTool({ id: "call-1", name: "read_text_file", status: "queued", queuedAt: 110, input: { path: "src/App.jsx" } });
    store.upsertTool({ id: "call-1", name: "read_text_file", status: "running", queuedAt: 110, startedAt: 120, input: { path: "src/App.jsx" } });
    store.upsertTool({ id: "call-1", name: "read_text_file", status: "completed", queuedAt: 110, startedAt: 120, endedAt: 160, durationMs: 40, result: { status: "success", summary: "读取完成" } });

    const events = store.snapshot().events.filter((event) => event.type === "tool");
    assert.equal(events.length, 1);
    assert.equal(events[0].status, "completed");
    assert.equal(events[0].tool.durationMs, 40);
    assert.equal(events[0].tool.result.summary, "读取完成");
  });

  it("preserves developer-only Tool visibility for diagnostics", () => {
    const store = new RunActivityStore({ taskId: "task-hidden", runId: "run-hidden", startedAt: 100 });
    store.upsertTool({
      id: "call-hidden",
      name: "calculator",
      title: "Calculator",
      status: "completed",
      activityVisibility: "developer",
      countsTowardLimit: false,
      countsTowardRepeatLimit: false,
      queuedAt: 110,
      startedAt: 111,
      endedAt: 112,
      result: { status: "success", summary: "4" }
    });

    const tool = store.snapshot().events.find((event) => event.type === "tool").tool;
    assert.equal(tool.activityVisibility, "developer");
    assert.equal(tool.countsTowardLimit, false);
    assert.equal(tool.countsTowardRepeatLimit, false);
  });

  it("records plan revisions and a final needs-input state", () => {
    const store = new RunActivityStore({ taskId: "task-2", runId: "run-2", startedAt: 100 });
    store.recordPlan([{ id: "step-1", title: "Inspect", status: "needs_input", reason: "Need a folder path" }], 110);
    const snapshot = store.finalize("needs_input", 130);

    assert.equal(snapshot.status, "needs_input");
    assert.equal(snapshot.stopReason, "needs_input");
    assert.equal(snapshot.events.some((event) => event.type === "plan"), true);
    assert.equal(snapshot.events.some((event) => event.type === "question"), false);
  });

  it("keeps public progress events append-only", () => {
    const store = new RunActivityStore({ taskId: "task-3", runId: "run-3", startedAt: 100 });
    const first = store.recordProgress({ title: "开始执行任务" }, 110);
    const second = store.recordProgress({ title: "保存当前进展", status: "completed" }, 120);
    const progress = store.snapshot().events.filter((event) => String(event.id).startsWith("progress:"));

    assert.equal(progress.length, 2);
    assert.equal(first.id, "progress:run-3:1");
    assert.equal(second.id, "progress:run-3:2");
    assert.equal(progress[1].status, "completed");
  });
});
