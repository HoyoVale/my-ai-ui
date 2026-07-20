import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createEmptyConversationData
} from "../../electron/conversation/conversationSchema.js";
import {
  ConversationManager
} from "../../electron/conversation/ConversationManager.js";

class MemoryStore {
  constructor() {
    this.data = createEmptyConversationData();
  }
  load() {
    return structuredClone(this.data);
  }
  save(data) {
    this.data = structuredClone(data);
    return this.load();
  }
}

function createManager() {
  let now = 2000;
  let id = 0;
  return new ConversationManager({
    store: new MemoryStore(),
    now: () => ++now,
    createId: () => `id-${++id}`
  });
}

describe("interrupted run recovery", () => {
  it("closes persisted running messages and tools after an app restart", () => {
    const manager = createManager();
    const conversation = manager.create();
    manager.appendMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "",
      status: "running",
      plan: [
        { id: "one", title: "Inspect", status: "in_progress" },
        { id: "two", title: "Test", status: "pending" }
      ],
      activity: {
        version: 3,
        taskId: "task",
        runId: "run",
        status: "running",
        startedAt: 1000,
        endedAt: null,
        durationMs: 0,
        stopReason: "",
        events: [{
          id: "tool:one",
          type: "tool",
          sequence: 0,
          status: "running",
          createdAt: 1001,
          updatedAt: 1002,
          tool: { id: "one", name: "read_text_file", status: "running" }
        }]
      }
    });

    const result = manager.recoverInterruptedRuns();
    const message = manager.getConversation(conversation.id).messages[0];

    assert.equal(result.recovered, 1);
    assert.equal(message.status, "interrupted");
    assert.equal(message.stopReason, "interrupted");
    assert.equal(message.plan[0].status, "blocked");
    assert.equal(message.activity.status, "interrupted");
    assert.equal(message.activity.events[0].tool.status, "cancelled");
  });

  it("uses startup Runtime recovery decisions instead of cancelling uncertain writes", () => {
    const manager = createManager();
    const conversation = manager.create();
    manager.appendMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "",
      status: "running",
      taskId: "task-uncertain",
      activity: {
        version: 3,
        taskId: "task-uncertain",
        runId: "run-1",
        status: "running",
        startedAt: 1000,
        events: [{
          id: "tool:call-1",
          type: "tool",
          sequence: 0,
          status: "running",
          createdAt: 1001,
          updatedAt: 1002,
          tool: {
            id: "call-1",
            name: "remote_write",
            status: "running"
          }
        }]
      }
    });

    manager.recoverInterruptedRuns({
      runtimeRecoveries: [{
        taskId: "task-uncertain",
        applyToConversation: true,
        phase: "reconciling",
        outcome: "needs_reconciliation",
        activityStatus: "needs_reconciliation",
        messageStatus: "interrupted",
        stopReason: "needs_reconciliation",
        resumable: true,
        title: "有工具操作需要核验",
        checkpoint: {
          version: 3,
          taskId: "task-uncertain",
          runId: "run-1",
          unresolvedCallIds: ["call-1"]
        },
        recovery: {
          unresolvedCount: 1,
          calls: [{
            callId: "call-1",
            toolName: "remote_write",
            recovery: "needs_reconciliation",
            actions: ["recheck", "confirm_applied"]
          }]
        }
      }]
    });

    const message = manager.getConversation(conversation.id).messages[0];
    assert.equal(message.activity.status, "needs_reconciliation");
    assert.equal(message.activity.outcome, "needs_reconciliation");
    assert.equal(message.activity.events[0].status, "attention");
    assert.equal(
      message.activity.events[0].tool.runtime.recovery,
      "needs_reconciliation"
    );
    assert.equal(
      message.activity.checkpoint.unresolvedCallIds[0],
      "call-1"
    );
  });

});
