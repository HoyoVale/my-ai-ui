import {
  describe,
  it
} from "node:test";

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
  let now = 1000;
  let id = 0;
  return new ConversationManager({
    store: new MemoryStore(),
    now: () => ++now,
    createId: () => `id-${++id}`
  });
}

function appendCancellingMessage(manager, conversationId) {
  return manager.appendMessage({
    conversationId,
    role: "assistant",
    content: "partial",
    status: "running",
    taskId: "task-cancel",
    runOutcome: "running",
    runPhase: "cancelling",
    activity: {
      version: 3,
      taskId: "task-cancel",
      runId: "run-cancel",
      status: "cancelling",
      startedAt: 900,
      events: [{
        id: "tool:one",
        type: "tool",
        sequence: 0,
        status: "running",
        createdAt: 901,
        updatedAt: 902,
        tool: {
          id: "one",
          name: "read_text_file",
          status: "running"
        }
      }]
    }
  });
}

describe("cancelled run startup recovery", () => {
  it("restores a persisted cancelling run as cancelled, not resumable", () => {
    const manager = createManager();
    const conversation = manager.create();
    appendCancellingMessage(manager, conversation.id);

    manager.recoverInterruptedRuns();
    const message = manager.getConversation(conversation.id).messages[0];

    assert.equal(message.status, "aborted");
    assert.equal(message.stopReason, "cancelled_by_user");
    assert.match(message.content, /本次任务已取消/u);
    assert.equal(message.metadata.run.outcome, "cancelled");
    assert.equal(message.metadata.run.phase, "cancelled");
    assert.equal(message.metadata.run.resumable, false);
    assert.equal(message.activity.status, "cancelled");
    assert.equal(message.activity.resumable, false);
    assert.equal(message.activity.events[0].tool.status, "cancelled");
    assert.equal(
      message.activity.events[0].tool.result.error.code,
      "USER_CANCELLED"
    );
  });

  it("lets uncertain Tool recovery override a pending cancellation", () => {
    const manager = createManager();
    const conversation = manager.create();
    appendCancellingMessage(manager, conversation.id);

    manager.recoverInterruptedRuns({
      runtimeRecoveries: [{
        taskId: "task-cancel",
        applyToConversation: true,
        phase: "reconciling",
        outcome: "needs_reconciliation",
        activityStatus: "needs_reconciliation",
        messageStatus: "interrupted",
        stopReason: "needs_reconciliation",
        resumable: true,
        title: "有工具操作需要核验",
        recovery: {
          unresolvedCount: 1,
          calls: [{
            callId: "one",
            toolName: "read_text_file",
            recovery: "needs_reconciliation",
            actions: ["recheck"]
          }]
        }
      }]
    });

    const message = manager.getConversation(conversation.id).messages[0];
    assert.equal(message.status, "interrupted");
    assert.equal(message.metadata.run.outcome, "needs_reconciliation");
    assert.equal(message.metadata.run.resumable, true);
    assert.equal(message.activity.events[0].status, "attention");
  });
});
