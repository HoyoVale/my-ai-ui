import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConversationManager } from "../../electron/conversation/ConversationManager.js";
import {
  createEmptyConversationData,
  sanitizeConversationData
} from "../../electron/conversation/conversationSchema.js";

class MemoryStore {
  constructor(data = createEmptyConversationData()) {
    this.data = sanitizeConversationData(data);
  }

  load() {
    return structuredClone(this.data);
  }

  save(data) {
    this.data = sanitizeConversationData(data);
    return this.load();
  }
}

function createManager(store) {
  let now = 100;
  let id = 0;
  return new ConversationManager({
    store,
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

describe("Legacy Goal compatibility", () => {
  it("projects a migrated Goal for reading without keeping it at the schema root", () => {
    const store = new MemoryStore({
      version: 23,
      currentConversationId: "conversation-1",
      conversations: [{
        id: "conversation-1",
        title: "Legacy goal",
        createdAt: 1,
        updatedAt: 2,
        messages: [],
        goal: {
          id: "goal-1",
          objective: "历史目标",
          status: "active",
          createdAt: 1,
          updatedAt: 2
        }
      }]
    });
    const manager = createManager(store);
    const conversation = manager.getConversation("conversation-1");

    assert.equal(conversation.goal.id, "goal-1");
    assert.equal(conversation.goal.objective, "历史目标");
    assert.equal(conversation.legacyAdvancedReadOnly, true);
    assert.equal(Object.hasOwn(store.data.conversations[0], "goal"), false);
    assert.equal(
      store.data.conversations[0].metadata.legacyAdvanced.goal.id,
      "goal-1"
    );
  });

  it("does not expose Goal mutation methods on the Core Lite branch", () => {
    const store = new MemoryStore();
    const manager = createManager(store);
    const conversation = manager.create();

    for (const method of [
      "setGoal",
      "beginGoalRun",
      "recordGoalCheckpoint",
      "recordGoalVerification",
      "completeGoal"
    ]) {
      assert.equal(method in manager, false);
    }

    assert.equal(manager.getConversation(conversation.id).goal, null);
  });

});
