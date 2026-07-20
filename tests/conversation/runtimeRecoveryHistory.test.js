import assert from "node:assert/strict";
import test from "node:test";

import {
  ConversationManager
} from "../../electron/conversation/ConversationManager.js";
import {
  createEmptyConversationData
} from "../../electron/conversation/conversationSchema.js";

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
  let id = 0;
  let now = 1_000;
  return new ConversationManager({
    store: new MemoryStore(),
    now: () => ++now,
    createId: () => `id-${++id}`,
    getSettings: () => ({
      conversation: {
        maxConversations: 100,
        contextTurns: 8,
        autoTitle: true,
        saveAbortedReplies: true
      }
    })
  });
}

test("ConversationManager builds a task-scoped recovery history", () => {
  const manager = createManager();
  const conversation = manager.create();
  const message = manager.appendMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "任务需要确认。",
    status: "interrupted",
    taskId: "task-1",
    activity: {
      taskId: "task-1",
      runId: "run-1",
      status: "attention",
      checkpoint: {
        toolRuntime: {
          version: 2,
          totalCalls: 1,
          unresolvedCount: 1,
          needsConfirmation: 1,
          needsReconciliation: 0,
          calls: [{
            callId: "call-1",
            toolName: "remote.write",
            recovery: "needs_confirmation",
            state: "unknown",
            actions: ["confirm_applied"]
          }]
        }
      }
    }
  });

  const history = manager.listToolRuntimeRecoveryHistory();
  assert.equal(history.taskCount, 1);
  assert.equal(history.unresolvedCount, 1);
  assert.equal(history.items[0].conversationId, conversation.id);
  assert.equal(history.items[0].messageId, message.id);
  assert.equal(history.items[0].taskId, "task-1");

  const record = manager.getTaskRuntimeRecord("task-1");
  assert.equal(record.message.id, message.id);
  assert.equal(record.conversation.id, conversation.id);
});

test("ConversationManager keeps only the latest recovery record for a task", () => {
  const manager = createManager();
  const conversation = manager.create();

  const oldMessage = manager.appendMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "旧的恢复状态。",
    status: "interrupted",
    taskId: "task-shared",
    createdAt: 1_100,
    activity: {
      taskId: "task-shared",
      runId: "run-old",
      status: "attention",
      checkpoint: {
        updatedAt: 1_200,
        toolRuntime: {
          version: 2,
          totalCalls: 1,
          unresolvedCount: 1,
          needsConfirmation: 1,
          needsReconciliation: 0,
          calls: [{
            callId: "call-old",
            toolName: "remote.write",
            recovery: "needs_confirmation",
            state: "unknown",
            actions: ["confirm_applied"]
          }]
        }
      }
    }
  });

  const latestMessage = manager.appendMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "新的恢复状态。",
    status: "completed",
    taskId: "task-shared",
    createdAt: 1_300,
    activity: {
      taskId: "task-shared",
      runId: "run-latest",
      status: "completed",
      checkpoint: {
        updatedAt: 1_400,
        toolRuntime: {
          version: 2,
          totalCalls: 1,
          unresolvedCount: 0,
          needsConfirmation: 0,
          needsReconciliation: 0,
          calls: [{
            callId: "call-latest",
            toolName: "remote.write",
            recovery: "resolved",
            state: "reported",
            actions: []
          }]
        }
      }
    }
  });

  const history = manager.listToolRuntimeRecoveryHistory();
  assert.equal(history.taskCount, 1);
  assert.equal(history.unresolvedCount, 0);
  assert.equal(history.items[0].messageId, latestMessage.id);
  assert.equal(history.items[0].runId, "run-latest");

  const record = manager.getTaskRuntimeRecord("task-shared");
  assert.equal(record.message.id, latestMessage.id);

  const replacement = {
    version: 2,
    totalCalls: 1,
    unresolvedCount: 1,
    needsConfirmation: 0,
    needsReconciliation: 1,
    calls: [{
      callId: "call-latest",
      toolName: "remote.write",
      recovery: "needs_reconciliation",
      state: "unknown",
      actions: ["reconcile"]
    }]
  };
  const updated = manager.updateToolRuntimeRecovery({
    taskId: "task-shared",
    recovery: replacement
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.message.id, latestMessage.id);

  const after = manager.getConversation(conversation.id).messages;
  const oldAfter = after.find((message) => message.id === oldMessage.id);
  const latestAfter = after.find((message) => message.id === latestMessage.id);
  assert.equal(oldAfter.activity.checkpoint.toolRuntime.calls[0].callId, "call-old");
  assert.equal(latestAfter.activity.checkpoint.toolRuntime.needsReconciliation, 1);
});
