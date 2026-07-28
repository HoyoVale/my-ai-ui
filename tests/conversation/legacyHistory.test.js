import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ConversationManager } from "../../electron/conversation/ConversationManager.js";
import {
  createEmptyConversationData,
  projectConversationSnapshot,
  projectMessageSnapshot,
  sanitizeConversationData
} from "../../electron/conversation/conversationSchema.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

class MemoryStore {
  constructor(data = createEmptyConversationData()) {
    this.data = sanitizeConversationData(data);
  }
  load() { return structuredClone(this.data); }
  save(data) {
    this.data = sanitizeConversationData(data);
    return this.load();
  }
}

function createManager(store) {
  let id = 0;
  return new ConversationManager({
    store,
    now: () => 100,
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

describe("Core Lite legacy history boundary", () => {
  it("migrates old Goal and Execution data into inert conversation metadata", () => {
    const data = sanitizeConversationData({
      version: 23,
      currentConversationId: "conversation-1",
      conversations: [{
        id: "conversation-1",
        title: "Legacy",
        createdAt: 1,
        updatedAt: 2,
        messages: [],
        goal: { id: "goal-1", objective: "历史目标", status: "active" },
        activeExecutionThreadId: "thread-1",
        executionThreads: [{ id: "thread-1", objective: "历史任务", status: "completed" }]
      }]
    });
    const conversation = data.conversations[0];
    const projected = projectConversationSnapshot(conversation);

    assert.equal(data.version, 25);
    assert.equal(conversation.metadata.legacyAdvanced.readOnly, true);
    assert.equal(conversation.metadata.legacyAdvanced.goal.id, "goal-1");
    assert.equal(
      conversation.metadata.legacyAdvanced.execution.executionThreads[0].id,
      "thread-1"
    );
    for (const field of [
      "goal",
      "activeExecutionThreadId",
      "executionThread",
      "executionThreads",
      "routingDecisions",
      "legacyAdvancedReadOnly"
    ]) {
      assert.equal(Object.hasOwn(projected, field), false, field);
    }
  });

  it("stores old Plan data only under message.metadata.legacyHistory", () => {
    const data = sanitizeConversationData({
      version: 15,
      currentConversationId: "conversation-1",
      conversations: [{
        id: "conversation-1",
        title: "Legacy plan",
        createdAt: 1,
        updatedAt: 2,
        messages: [{
          id: "assistant-1",
          role: "assistant",
          content: "Done",
          createdAt: 2,
          plan: [{ id: "step-1", title: "Inspect", status: "completed" }],
          executionThreadId: "thread-1"
        }]
      }]
    });
    const message = data.conversations[0].messages[0];
    const projected = projectMessageSnapshot(message);

    assert.equal(message.metadata.legacyHistory.plan[0].id, "step-1");
    assert.equal(message.metadata.legacyHistory.planState.readOnly, true);
    assert.equal(message.metadata.legacyHistory.executionThreadId, "thread-1");
    for (const field of [
      "plan",
      "planState",
      "executionThreadId",
      "taskId",
      "runOutcome",
      "runPhase",
      "runResumable"
    ]) {
      assert.equal(Object.hasOwn(projected, field), false, field);
    }
  });

  it("keeps new writes free of legacy Goal Plan and Execution fields", () => {
    const store = new MemoryStore();
    const manager = createManager(store);
    const conversation = manager.create({ title: "Core Lite" });
    const message = manager.appendMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Complete",
      plan: [{ id: "legacy", title: "Ignored", status: "in_progress" }],
      planState: { rootItems: [{ id: "legacy", title: "Ignored" }] },
      executionThreadId: "legacy-thread"
    });

    assert.equal(Object.hasOwn(message.metadata ?? {}, "legacyHistory"), false);
    for (const method of [
      "setGoal",
      "beginGoalRun",
      "beginExecutionThread",
      "recordExecutionThreadCheckpoint",
      "finishExecutionThread"
    ]) {
      assert.equal(method in manager, false, method);
    }
    assert.equal(
      fs.existsSync(path.join(root, "electron/conversation/services/ConversationExecutionService.js")),
      false
    );
  });

  it("preserves bounded legacy metadata across JSON round trips without aliases", () => {
    const initial = sanitizeConversationData({
      version: 23,
      currentConversationId: "conversation-1",
      conversations: [{
        id: "conversation-1",
        title: "Legacy",
        createdAt: 1,
        updatedAt: 2,
        messages: [],
        goal: { id: "goal-1", objective: "历史目标" },
        executionThreads: [{ id: "thread-1", objective: "历史任务" }]
      }]
    });
    const restored = sanitizeConversationData(JSON.parse(JSON.stringify(initial)));
    const conversation = restored.conversations[0];

    assert.equal(conversation.metadata.legacyAdvanced.goal.id, "goal-1");
    assert.equal(
      conversation.metadata.legacyAdvanced.execution.executionThreads[0].id,
      "thread-1"
    );
    assert.equal(Object.hasOwn(conversation, "goal"), false);
    assert.equal(Object.hasOwn(conversation, "executionThreads"), false);
  });
});
