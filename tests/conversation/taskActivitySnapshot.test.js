import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  createActivitySnapshot,
  describeToolBatch,
  groupToolActivityEvents
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

  it("groups consecutive calls by batch and leaves boundaries intact", () => {
    const tool = (id, batchId = "", status = "completed") => ({
      id,
      type: "tool",
      batchId,
      status,
      tool: {
        id,
        name: "read_text_file",
        status
      }
    });
    const events = [
      tool("one", "batch-a"),
      tool("two", "batch-a"),
      {
        id: "commentary",
        type: "commentary",
        content: "next"
      },
      tool("three"),
      tool("four"),
      tool("five", "batch-b", "running")
    ];

    const grouped = groupToolActivityEvents(events);

    assert.deepEqual(
      grouped.map((event) => event.type),
      ["tool_batch", "commentary", "tool_batch", "tool"]
    );
    assert.equal(grouped[0].events.length, 2);
    assert.equal(grouped[0].batchId, "batch-a");
    assert.equal(describeToolBatch(grouped[0]), "运行了 2 个工具");
    assert.equal(grouped[2].batchId, "");
    assert.equal(grouped[3].id, "five");
  });
});

it("restores the versioned root plan and developer subplans from history", () => {
  const message = {
    id: "message-plan-2",
    role: "assistant",
    taskId: "task-plan-2",
    plan: [
      { id: "stale", title: "旧投影", status: "pending" }
    ],
    planState: {
      schemaVersion: 2,
      revision: 5,
      rootRevision: 2,
      rootItems: [
        { id: "inspect", title: "检查项目", status: "completed" },
        { id: "implement", title: "实现修复", status: "in_progress" }
      ],
      subplans: [
        {
          rootStepId: "implement",
          revision: 3,
          items: [
            { id: "renderer", title: "修改 Renderer", status: "in_progress" }
          ]
        }
      ]
    },
    activity: {
      runId: "run-plan-2",
      status: "completed",
      events: [
        {
          id: "plan:one",
          type: "plan",
          revision: 1,
          rootRevision: 1,
          title: "制定了一个 2 步计划",
          createdAt: 10,
          updatedAt: 10,
          plan: [
            { id: "inspect", title: "检查项目", status: "in_progress" },
            { id: "implement", title: "实现修复", status: "pending" }
          ]
        },
        {
          id: "plan:two",
          type: "plan",
          revision: 4,
          rootRevision: 2,
          title: "更新了任务计划",
          reason: "发现需要先完成 Renderer 修复。",
          createdAt: 20,
          updatedAt: 20,
          plan: [
            { id: "inspect", title: "检查项目", status: "completed" },
            { id: "implement", title: "实现修复", status: "in_progress" }
          ]
        }
      ]
    }
  };

  const snapshot = createActivitySnapshot(message);

  assert.deepEqual(
    snapshot.plan.map((item) => item.id),
    ["inspect", "implement"]
  );
  assert.equal(snapshot.planState.schemaVersion, 2);
  assert.equal(snapshot.planState.subplans.length, 1);
  assert.equal(snapshot.activeSubplan.rootStepId, "implement");
  assert.equal(snapshot.planAdjusted, true);
  assert.equal(snapshot.planRevision, 2);
  assert.equal(
    snapshot.planAdjustmentReason,
    "发现需要先完成 Renderer 修复。"
  );
});
