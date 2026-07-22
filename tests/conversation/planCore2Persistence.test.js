import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createEmptyConversationData,
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

describe("Plan Core 2.0 persistence", () => {
  it("migrates a legacy flat message plan into a versioned root plan state", () => {
    const data = sanitizeConversationData({
      version: 15,
      currentConversationId: "conversation",
      conversations: [
        {
          id: "conversation",
          title: "Legacy",
          mode: "coding",
          createdAt: 1,
          updatedAt: 2,
          messages: [
            {
              id: "assistant",
              role: "assistant",
              content: "Progress",
              status: "complete",
              createdAt: 2,
              plan: [
                {
                  id: "root",
                  title: "Implement",
                  status: "completed"
                }
              ]
            }
          ]
        }
      ]
    });

    const message = data.conversations[0].messages[0];
    assert.equal(data.version, createEmptyConversationData().version);
    assert.equal(message.planState.schemaVersion, 3);
    assert.deepEqual(message.planState.rootItems, message.plan);
    assert.deepEqual(message.planState.subplans, []);
  });

  it("stores root and internal plan state on assistant messages", () => {
    const store = new MemoryStore();
    const manager = new ConversationManager({
      store,
      now: () => 100,
      createId: (() => {
        let index = 0;
        return () => `id-${++index}`;
      })()
    });
    const conversation = manager.create({
      title: "Plan",
      mode: "chat"
    });

    const message = manager.appendMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Working",
      plan: [
        { id: "root", title: "Implement", status: "in_progress", reason: "" }
      ],
      planState: {
        schemaVersion: 2,
        revision: 2,
        rootRevision: 1,
        rootArchivedCount: 0,
        rootItems: [
          { id: "root", title: "Implement", status: "in_progress", reason: "" }
        ],
        subplans: [
          {
            rootStepId: "root",
            revision: 1,
            archivedCount: 0,
            items: [
              { id: "detail", title: "Update schema", status: "in_progress", reason: "" }
            ]
          }
        ]
      }
    });

    assert.equal(message.plan.length, 1);
    assert.equal(message.planState.subplans[0].items[0].id, "detail");
    assert.equal(
      manager.getConversation(conversation.id).messages[0].planState.schemaVersion,
      2
    );
  });
});
