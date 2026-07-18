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

import {
  RunActivityStore
} from "../../electron/agent/RunActivityStore.js";

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
  let now = 1000;

  return new ConversationManager({
    store: new MemoryStore(),
    createId: () => `id-${++id}`,
    now: () => ++now
  });
}

function createQuestionActivity() {
  return {
    version: 2,
    taskId: "task-1",
    runId: "run-1",
    status: "waiting_for_user",
    startedAt: 100,
    endedAt: 200,
    durationMs: 100,
    stopReason: "waiting_for_user",
    events: [
      {
        id: "question:run-1",
        type: "question",
        sequence: 0,
        status: "waiting_for_user",
        title: "等待你的回答",
        createdAt: 200,
        updatedAt: 200,
        question: {
          question: "Which folder should I inspect?",
          options: [
            {
              id: "src",
              label: "src"
            }
          ]
        }
      }
    ]
  };
}

describe("resumable ask_user tasks", () => {
  it("answers the checkpoint in place without appending a user turn", () => {
    const manager = createManager();
    const conversation = manager.create();
    const assistant = manager.appendMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "",
      stopReason: "waiting_for_user",
      taskId: "task-1",
      pendingQuestion: {
        question: "Which folder should I inspect?",
        status: "waiting",
        options: [
          {
            id: "src",
            label: "src"
          }
        ]
      },
      activity: createQuestionActivity()
    });

    const before = manager.getConversation(
      conversation.id
    );

    assert.equal(before.messages.length, 1);

    const result = manager.resolvePendingQuestion({
      conversationId: conversation.id,
      messageId: assistant.id,
      answer: "src",
      selectedOptionIds: ["src"]
    });

    assert.equal(result.ok, true);

    const after = manager.getConversation(
      conversation.id
    );
    const saved = after.messages[0];

    assert.equal(after.messages.length, 1);
    assert.equal(saved.id, assistant.id);
    assert.equal(saved.pendingQuestion.status, "answered");
    assert.equal(saved.pendingQuestion.answer, "src");
    assert.deepEqual(
      saved.pendingQuestion.selectedOptionIds,
      ["src"]
    );
    assert.equal(saved.activity.status, "resumed");
    assert.equal(saved.activity.events[0].status, "answered");
  });

  it("hydrates the same logical run and keeps prior activity", () => {
    const resumed = RunActivityStore.resumeFromSnapshot(
      createQuestionActivity(),
      {
        answeredQuestion: {
          answer: "src",
          selectedOptionIds: ["src"]
        },
        resumedAt: 300
      }
    );

    const snapshot = resumed.snapshot();

    assert.equal(snapshot.runId, "run-1");
    assert.equal(snapshot.taskId, "task-1");
    assert.equal(snapshot.status, "running");
    assert.equal(snapshot.endedAt, null);
    assert.equal(snapshot.events[0].status, "answered");
    assert.equal(snapshot.events[0].question.answer, "src");
  });
});
