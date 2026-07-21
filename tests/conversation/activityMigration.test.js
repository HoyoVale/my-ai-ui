import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  sanitizeMessage
} from "../../electron/conversation/conversationSchema.js";

describe("conversation activity migration", () => {
  it("migrates legacy plan, tool calls and stop reasons into one event stream", () => {
    const message = sanitizeMessage({
      id: "assistant-1",
      role: "assistant",
      content: "Done",
      createdAt: 2000,
      durationMs: 500,
      stopReason: "step_limit",
      plan: [
        {
          id: "step-1",
          title: "Inspect",
          status: "completed"
        }
      ],
      toolCalls: [
        {
          id: "tool-1",
          name: "search_files",
          status: "complete",
          output: { ok: true }
        }
      ]
    });

    assert.equal(message.stopReason, "agent_step_limit");
    assert.equal(message.activity.version, 3);
    assert.equal(message.activity.taskId, "assistant-1");
    assert.equal(
      message.activity.events.some((event) => event.type === "plan"),
      true
    );
    assert.equal(
      message.activity.events.some((event) => event.type === "tool"),
      true
    );
    assert.equal(
      message.activity.events.some((event) => event.type === "summary"),
      false
    );
  });

  it("preserves public commentary and tool batches across conversation sanitization", () => {
    const message = sanitizeMessage({
      id: "assistant-progress",
      role: "assistant",
      content: "Done",
      createdAt: 500,
      activity: {
        version: 2,
        taskId: "task-progress",
        runId: "run-progress",
        status: "completed",
        startedAt: 100,
        endedAt: 500,
        durationMs: 400,
        stopReason: "completed",
        events: [
          {
            id: "batch:run-progress:1",
            type: "batch",
            sequence: 0,
            status: "completed",
            title: "检查活动分组",
            createdAt: 100,
            updatedAt: 400,
            batch: {
              id: "batch:run-progress:1",
              objective: "检查活动分组",
              status: "completed",
              startedAt: 100,
              endedAt: 400
            }
          },
          {
            id: "commentary:run-progress:1",
            type: "commentary",
            sequence: 1,
            status: "completed",
            title: "检查活动分组",
            content: "我先检查活动数据的分组方式。",
            phase: "before_tools",
            batchId: "batch:run-progress:1",
            createdAt: 110,
            updatedAt: 110
          },
          {
            id: "tool:call-progress",
            type: "tool",
            sequence: 2,
            status: "completed",
            title: "搜索文本",
            batchId: "batch:run-progress:1",
            createdAt: 120,
            updatedAt: 200,
            tool: {
              id: "call-progress",
              name: "search_text",
              title: "搜索文本",
              status: "completed",
              batchId: "batch:run-progress:1",
              batchObjective: "检查活动分组",
              startedAt: 120,
              endedAt: 200,
              durationMs: 80
            }
          }
        ]
      }
    });

    const batch = message.activity.events.find(
      (event) => event.type === "batch"
    );
    const commentary = message.activity.events.find(
      (event) => event.type === "commentary"
    );
    const tool = message.activity.events.find(
      (event) => event.type === "tool"
    );

    assert.equal(message.activity.version, 3);
    assert.equal(message.activity.runId, "run-progress");
    assert.equal(batch.batch.objective, "检查活动分组");
    assert.equal(commentary.phase, "before_tools");
    assert.equal(commentary.batchId, batch.batch.id);
    assert.equal(tool.tool.batchId, batch.batch.id);
  });

  it("does not invent an activity stream for ordinary historical replies", () => {
    const message = sanitizeMessage({
      id: "assistant-plain",
      role: "assistant",
      content: "Hello",
      createdAt: 100
    });

    assert.equal(
      Object.hasOwn(message, "activity"),
      false
    );
  });
  it("preserves root plan revision metadata for Plan UI history", () => {
    const message = sanitizeMessage({
      id: "assistant-plan-revision",
      role: "assistant",
      content: "Done",
      createdAt: 300,
      activity: {
        version: 3,
        taskId: "task-plan-revision",
        runId: "run-plan-revision",
        status: "completed",
        startedAt: 100,
        endedAt: 300,
        stopReason: "completed",
        events: [
          {
            id: "plan:run-plan-revision:2",
            type: "plan",
            sequence: 0,
            status: "running",
            title: "更新了任务计划",
            reason: "发现新的必要步骤。",
            revision: 4,
            rootRevision: 2,
            scope: "root",
            createdAt: 180,
            updatedAt: 180,
            plan: [
              {
                id: "implement",
                title: "实现修复",
                status: "in_progress"
              }
            ]
          }
        ]
      }
    });

    const planEvent = message.activity.events.find(
      (event) => event.type === "plan"
    );

    assert.equal(planEvent.rootRevision, 2);
    assert.equal(planEvent.scope, "root");
    assert.equal(planEvent.reason, "发现新的必要步骤。");
  });

});
