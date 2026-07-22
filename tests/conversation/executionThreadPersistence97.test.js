import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createEmptyConversationData
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

function createManager(store, start = 100) {
  let now = start;
  let id = 0;
  return new ConversationManager({
    store,
    now: () => ++now,
    createId: () => `id-${++id}`,
    getWorkspaceById: (workspaceId) => workspaceId === "workspace-1"
      ? {
          id: "workspace-1",
          name: "Workspace",
          rootPath: "/workspace",
          canonicalPath: "/workspace"
        }
      : null,
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

describe("ExecutionThread persistence", () => {
  it("persists one ordinary task thread and recovers an interrupted run", () => {
    const store = new MemoryStore();
    const first = createManager(store, 100);
    const conversation = first.create({
      mode: "coding",
      workspaceId: "workspace-1"
    });

    const begun = first.beginExecutionThread({
      conversationId: conversation.id,
      threadId: "thread-1",
      taskId: "task-1",
      objective: "Fix the scene test",
      mode: "coding",
      workspaceId: "workspace-1",
      runId: "run-1",
      planState: {
        rootPlanId: "thread-1:root",
        rootItems: [{ id: "fix", title: "Fix test", status: "in_progress" }]
      }
    });
    assert.equal(begun.ok, true);
    assert.equal(begun.thread.goalId, "");

    const saved = first.recordExecutionThreadCheckpoint({
      conversationId: conversation.id,
      threadId: "thread-1",
      runId: "run-1",
      checkpoint: {
        executionThreadId: "thread-1",
        taskId: "task-1",
        runId: "run-1"
      }
    });
    assert.equal(saved.ok, true);

    const reloaded = createManager(store, 500);
    const recovered = reloaded.getConversation(conversation.id).executionThread;
    assert.equal(recovered.id, "thread-1");
    assert.equal(recovered.taskId, "task-1");
    assert.equal(recovered.goalId, "");
    assert.equal(recovered.status, "waiting");
    assert.equal(recovered.stopReason, "interrupted");
    assert.equal(recovered.resumable, true);
    assert.equal(recovered.checkpoint.executionThreadId, "thread-1");
  });

  it("keeps a completed thread stable across reloads", () => {
    const store = new MemoryStore();
    const first = createManager(store, 100);
    const conversation = first.create({
      mode: "coding",
      workspaceId: "workspace-1"
    });
    first.beginExecutionThread({
      conversationId: conversation.id,
      threadId: "thread-2",
      taskId: "task-2",
      objective: "Complete tests",
      mode: "coding",
      runId: "run-2"
    });
    const finished = first.finishExecutionThread({
      conversationId: conversation.id,
      threadId: "thread-2",
      outcome: "completed",
      stopReason: "completed",
      lastAssistantMessageId: "assistant-2"
    });
    assert.equal(finished.ok, true);

    const reloaded = createManager(store, 500);
    const thread = reloaded.getConversation(conversation.id).executionThread;
    assert.equal(thread.id, "thread-2");
    assert.equal(thread.status, "completed");
    assert.equal(thread.lastAssistantMessageId, "assistant-2");
    assert.equal(thread.resumable, false);
  });
});
