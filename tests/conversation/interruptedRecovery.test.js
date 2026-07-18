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

  it("keeps waiting ask_user checkpoints resumable", () => {
    const manager = createManager();
    const conversation = manager.create();
    manager.appendMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "",
      status: "waiting",
      pendingQuestion: {
        question: "Choose",
        status: "waiting",
        options: []
      },
      activity: {
        version: 3,
        taskId: "task",
        runId: "run",
        status: "waiting_for_user",
        startedAt: 1000,
        endedAt: null,
        durationMs: 0,
        stopReason: "waiting_for_user",
        events: []
      }
    });

    const result = manager.recoverInterruptedRuns();
    const message = manager.getConversation(conversation.id).messages[0];

    assert.equal(result.recovered, 0);
    assert.equal(message.pendingQuestion.status, "waiting");
    assert.equal(message.activity.status, "waiting_for_user");
  });
});
