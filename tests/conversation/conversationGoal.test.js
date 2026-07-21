import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  createEmptyConversationData,
  sanitizeConversationData
} from "../../electron/conversation/conversationSchema.js";

import {
  ConversationManager
} from "../../electron/conversation/ConversationManager.js";

class MemoryStore {
  constructor(data = createEmptyConversationData()) {
    this.data = structuredClone(data);
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
  let now = 100;
  let id = 0;
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

describe("conversation Goal", () => {
  it("creates, pauses, resumes, completes and clears a session Goal", () => {
    const manager = createManager();
    const conversation = manager.create();

    const created = manager.setGoal({
      conversationId: conversation.id,
      objective: "完成项目，并让测试通过。"
    });
    assert.equal(created.ok, true);
    assert.equal(created.goal.status, "active");
    assert.equal(manager.getState().currentConversation.goal.objective, "完成项目，并让测试通过。");

    const paused = manager.setGoal({
      conversationId: conversation.id,
      objective: created.goal.objective,
      status: "paused"
    });
    assert.equal(paused.goal.id, created.goal.id);
    assert.equal(paused.goal.status, "paused");

    const resumed = manager.setGoal({
      conversationId: conversation.id,
      objective: created.goal.objective,
      status: "active"
    });
    assert.equal(resumed.goal.id, created.goal.id);

    const completed = manager.completeGoal({
      conversationId: conversation.id,
      goalId: created.goal.id
    });
    assert.equal(completed.ok, true);
    assert.equal(completed.goal.status, "completed");
    assert.equal(typeof completed.goal.completedAt, "number");

    const cleared = manager.setGoal({
      conversationId: conversation.id,
      objective: ""
    });
    assert.equal(cleared.ok, true);
    assert.equal(manager.getConversation(conversation.id).goal, null);
  });

  it("sanitizes persisted Goal data and rejects stale completion", () => {
    const data = sanitizeConversationData({
      version: 16,
      currentConversationId: "conversation-1",
      conversations: [{
        id: "conversation-1",
        title: "Goal",
        mode: "chat",
        createdAt: 10,
        updatedAt: 11,
        messages: [],
        goal: {
          id: "goal-1",
          objective: "  保留这个目标  ",
          status: "paused",
          createdAt: 10,
          updatedAt: 11
        }
      }]
    });

    assert.equal(data.version, 17);
    assert.deepEqual(data.conversations[0].goal, {
      id: "goal-1",
      objective: "保留这个目标",
      status: "paused",
      createdAt: 10,
      updatedAt: 11,
      completedAt: null
    });
  });
});
