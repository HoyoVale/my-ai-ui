import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createEmptyConversationData,
  projectMessageForRead,
  sanitizeConversationData
} from "../../electron/conversation/conversationSchema.js";

import {
  ConversationManager
} from "../../electron/conversation/ConversationManager.js";

class MemoryStore {
  constructor(data = null) {
    this.data = data ?? createEmptyConversationData();
  }

  load() {
    return this.data ? structuredClone(this.data) : null;
  }

  save(data) {
    this.data = structuredClone(data);
    return this.load();
  }
}

describe("legacy Plan read-only persistence", () => {
  it("migrates a legacy flat message plan into an inert metadata snapshot", () => {
    const data = sanitizeConversationData({
      version: 15,
      currentConversationId: "conversation",
      conversations: [{
        id: "conversation",
        title: "Legacy",
        mode: "coding",
        createdAt: 1,
        updatedAt: 2,
        messages: [{
          id: "assistant",
          role: "assistant",
          content: "Progress",
          status: "complete",
          createdAt: 2,
          plan: [{ id: "root", title: "Implement", status: "completed" }]
        }]
      }]
    });

    const message = data.conversations[0].messages[0];
    assert.equal(data.version, createEmptyConversationData().version);
    assert.equal(message.metadata.planState.schemaVersion, 3);
    assert.equal(message.metadata.planState.readOnly, true);
    assert.deepEqual(message.metadata.planState.rootItems, message.metadata.plan);
    assert.deepEqual(message.metadata.planState.subplans, []);
    assert.equal(Object.hasOwn(message, "plan"), false);
    assert.equal(Object.hasOwn(message, "planState"), false);

    const projected = projectMessageForRead(message);
    assert.equal(projected.plan[0].id, "root");
    assert.equal(projected.planState.readOnly, true);
  });

  it("ignores plan fields on all new assistant-message writes", () => {
    const store = new MemoryStore();
    const manager = new ConversationManager({
      store,
      now: () => 100,
      createId: (() => {
        let index = 0;
        return () => `id-${++index}`;
      })()
    });
    const conversation = manager.create({ title: "Plan", mode: "chat" });

    const message = manager.appendMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Working",
      plan: [{ id: "root", title: "Implement", status: "in_progress" }],
      planState: {
        schemaVersion: 2,
        rootItems: [{ id: "root", title: "Implement", status: "in_progress" }]
      }
    });

    assert.equal(Object.hasOwn(message, "plan"), false);
    assert.equal(Object.hasOwn(message, "planState"), false);
    assert.equal(Object.hasOwn(message.metadata ?? {}, "plan"), false);
    assert.equal(Object.hasOwn(message.metadata ?? {}, "planState"), false);

    const persisted = store.data.conversations[0].messages[0];
    assert.equal(Object.hasOwn(persisted.metadata ?? {}, "plan"), false);
    assert.equal(Object.hasOwn(persisted.metadata ?? {}, "planState"), false);
  });
});
