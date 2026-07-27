import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ConversationManager } from "../../electron/conversation/ConversationManager.js";
import {
  createEmptyConversationData,
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
  return new ConversationManager({
    store,
    now: () => 500,
    createId: () => "new-id",
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

describe("Legacy execution history compatibility", () => {
  it("migrates old threads into inert metadata and preserves the read projection", () => {
    const store = new MemoryStore({
      version: 23,
      currentConversationId: "conversation-1",
      conversations: [{
        id: "conversation-1",
        title: "Legacy thread",
        createdAt: 1,
        updatedAt: 2,
        messages: [],
        activeExecutionThreadId: "thread-1",
        executionThreads: [{
          id: "thread-1",
          taskId: "task-1",
          objective: "历史任务",
          status: "completed",
          createdAt: 1,
          updatedAt: 2
        }]
      }]
    });
    const manager = createManager(store);
    const conversation = manager.getConversation("conversation-1");

    assert.equal(conversation.executionThread.id, "thread-1");
    assert.equal(conversation.executionThreads.length, 1);
    assert.equal(Object.hasOwn(store.data.conversations[0], "executionThreads"), false);
    assert.equal(
      store.data.conversations[0].metadata.legacyAdvanced.execution.executionThreads[0].id,
      "thread-1"
    );
  });

  it("removes every Execution Thread API from ConversationManager", () => {
    const manager = createManager(new MemoryStore());
    for (const method of [
      "beginExecutionThread",
      "recordExecutionThreadCheckpoint",
      "finishExecutionThread",
      "listExecutionThreads",
      "selectExecutionThread",
      "recordProviderContinuation",
      "recordThreadRoutingDecision"
    ]) {
      assert.equal(method in manager, false, method);
    }
    assert.equal(
      fs.existsSync(path.join(
        root,
        "electron/conversation/services/ConversationExecutionService.js"
      )),
      false
    );
  });

  it("keeps historical execution snapshots stable across JSON round trips", () => {
    const initial = sanitizeConversationData({
      version: 23,
      currentConversationId: "conversation-1",
      conversations: [{
        id: "conversation-1",
        title: "Legacy thread",
        createdAt: 1,
        updatedAt: 2,
        messages: [],
        activeExecutionThreadId: "thread-1",
        executionThreads: [{
          id: "thread-1",
          taskId: "task-1",
          objective: "历史任务",
          status: "waiting",
          checkpoint: { stopReason: "interrupted" },
          createdAt: 1,
          updatedAt: 2
        }],
        routingDecisions: [{
          id: "decision-1",
          command: "resume",
          action: "resume",
          state: "applied",
          conversationId: "conversation-1",
          targetThreadId: "thread-1",
          createdAt: 2
        }]
      }]
    });
    const restored = sanitizeConversationData(
      JSON.parse(JSON.stringify(initial))
    );
    const legacy = restored.conversations[0].metadata.legacyAdvanced.execution;

    assert.equal(legacy.readOnly, undefined);
    assert.equal(legacy.executionThreads[0].checkpoint.stopReason, "interrupted");
    assert.equal(legacy.routingDecisions[0].id, "decision-1");
    assert.equal(Object.hasOwn(restored.conversations[0], "executionThreads"), false);
  });
});
