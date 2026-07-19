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
    assert.equal(progress[0].category, "runtime");
    assert.equal(progress[0].activityVisibility, "developer");
    assert.equal(progress[1].activityVisibility, "developer");
  });

  it("keeps lifecycle status events developer-only while preserving real failures", () => {
    const store = new RunActivityStore({
      taskId: "task-runtime",
      runId: "run-runtime",
      startedAt: 100
    });

    const running = store.snapshot().events.find((event) => event.type === "status");
    assert.equal(running.category, "runtime");
    assert.equal(running.activityVisibility, "developer");

    const failed = store.finalize("model_error", 140, {
      status: "failed",
      outcome: "failed"
    }).events.find((event) => event.id === "run:run-runtime");

    assert.equal(failed.status, "failed");
    assert.equal(failed.activityVisibility, "developer");
  });
  it("persists the internal reason separately from the public run outcome", () => {
    const store = new RunActivityStore({
      taskId: "task-boundary",
      runId: "run-boundary",
      startedAt: 100
    });
    store.updateCheckpoint({
      taskId: "task-boundary",
      runId: "run-boundary",
      phase: "checkpoint_ready",
      stopReason: "tool_call_limit"
    });
    const snapshot = store.finalize(
      "tool_call_limit",
      150,
      {
        status: "checkpoint_ready",
        outcome: "continuable",
        resumable: true
      }
    );

    assert.equal(snapshot.stopReason, "tool_call_limit");
    assert.equal(snapshot.status, "checkpoint_ready");
    assert.equal(snapshot.outcome, "continuable");
    assert.equal(snapshot.resumable, true);
  });

});

describe("RunActivityStore commentary batches", () => {
  it("does not suppress an identical before-tools update that starts a new batch", () => {
    const store = new RunActivityStore({
      taskId: "task-repeat",
      runId: "run-repeat",
      startedAt: 100
    });

    const first = store.recordCommentary({
      content: "准备读取文件",
      phase: "before_tools"
    }, 110);
    const second = store.recordCommentary({
      content: "准备读取文件",
      phase: "before_tools"
    }, 120);
    const snapshot = store.snapshot();
    const batches = snapshot.events.filter(
      (event) => event.type === "batch"
    );
    const commentary = snapshot.events.filter(
      (event) => event.type === "commentary"
    );

    assert.notEqual(first.batchId, second.batchId);
    assert.equal(batches.length, 2);
    assert.equal(batches[0].status, "completed");
    assert.equal(batches[1].status, "running");
    assert.equal(commentary.length, 2);
  });

  it("closes the active batch even when an after-tools update is deduplicated", () => {
    const store = new RunActivityStore({
      taskId: "task-close",
      runId: "run-close",
      startedAt: 100
    });

    store.beginBatch("读取文件", 110);
    store.recordCommentary({
      content: "读取完成",
      phase: "after_tools"
    }, 120);
    store.beginBatch("再次读取", 130);
    store.recordCommentary({
      content: "读取完成",
      phase: "after_tools"
    }, 140);

    assert.equal(store.getActiveBatch(), null);
    assert.equal(
      store.snapshot().events.filter(
        (event) => event.type === "commentary"
      ).length,
      2
    );
  });
});
