import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RunActivityStore } from "../../electron/agent/RunActivityStore.js";
import { createAgentToolSession } from "../../electron/tools/createAgentToolSession.js";

describe("public commentary and tool batches", () => {
  it("groups related tool activity between public progress updates", () => {
    const store = new RunActivityStore({ taskId: "task-1", runId: "run-1", startedAt: 100 });
    const before = store.recordCommentary({ content: "我先检查消息活动的分组方式。", phase: "before_tools", objective: "检查活动分组" }, 110);
    store.upsertTool({ id: "call-1", name: "search_text", title: "搜索文本", status: "completed", queuedAt: 120, startedAt: 121, endedAt: 130, durationMs: 9 });
    const after = store.recordCommentary({ content: "已经确认活动错误地按 task 聚合，接下来改为按 run 隔离。", phase: "after_tools" }, 140);

    const snapshot = store.snapshot();
    const batch = snapshot.events.find((event) => event.type === "batch");
    const tool = snapshot.events.find((event) => event.type === "tool");

    assert.equal(before.phase, "before_tools");
    assert.equal(after.phase, "after_tools");
    assert.equal(batch.status, "completed");
    assert.equal(tool.batchId, batch.batch.id);
    assert.equal(tool.tool.batchObjective, "检查活动分组");
  });

  it("uses natural model text for commentary without registering a progress tool", () => {
    const store = new RunActivityStore({ taskId: "task-2", runId: "run-2" });
    const session = createAgentToolSession({ activityStore: store });
    store.recordCommentary({ content: "我先核对当前事件源。", phase: "before_tools", objective: "核对事件源" });

    assert.equal(Object.hasOwn(session.tools, "report_progress"), false);
    assert.equal(session.registryManifest.some((tool) => tool.name === "report_progress"), false);
    assert.equal(store.snapshot().events.some((event) => event.type === "commentary"), true);
  });
});
