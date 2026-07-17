import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import {
  createEmptyConversationData
} from "../../electron/conversation/conversationSchema.js";

import {
  ConversationManager
} from "../../electron/conversation/ConversationManager.js";

class MemoryStore {
  constructor() {
    this.data =
      createEmptyConversationData();
  }

  load() {
    return structuredClone(
      this.data
    );
  }

  save(data) {
    this.data =
      structuredClone(data);

    return this.load();
  }
}

function createManager({
  maxConversations = 100,
  contextTurns = 8
} = {}) {
  let timestamp = 1000;
  let id = 0;

  return new ConversationManager({
    store:
      new MemoryStore(),

    now: () => {
      timestamp += 1;
      return timestamp;
    },

    createId: () => {
      id += 1;
      return `id-${id}`;
    },

    getSettings: () => ({
      conversation: {
        maxConversations,
        contextTurns,
        autoTitle: true,
        saveAbortedReplies:
          true
      }
    })
  });
}

describe(
  "ConversationManager",
  () => {
    it(
      "creates a conversation and derives its title from the first user message",
      () => {
        const manager =
          createManager();

        const conversation =
          manager.create();

        manager.appendMessage({
          conversationId:
            conversation.id,
          role: "user",
          content:
            "这是第一条会话消息"
        });

        const saved =
          manager.getConversation(
            conversation.id
          );

        assert.equal(
          saved.title,
          "这是第一条会话消息"
        );

        assert.equal(
          saved.messages.length,
          1
        );
      }
    );

    it(
      "builds context from the active conversation only",
      () => {
        const manager =
          createManager({
            contextTurns: 1
          });

        const first =
          manager.create();

        manager.appendMessage({
          conversationId:
            first.id,
          role: "user",
          content: "u1"
        });

        manager.appendMessage({
          conversationId:
            first.id,
          role: "assistant",
          content: "a1"
        });

        manager.appendMessage({
          conversationId:
            first.id,
          role: "user",
          content: "u2"
        });

        assert.deepEqual(
          manager.buildContext(
            first.id
          ),
          [
            {
              role: "user",
              content: "u2"
            }
          ]
        );
      }
    );

    it(
      "prunes old conversations to the configured limit",
      () => {
        const manager =
          createManager({
            maxConversations: 2
          });

        manager.create({
          title: "one"
        });

        manager.create({
          title: "two"
        });

        manager.create({
          title: "three"
        });

        assert.equal(
          manager.list().length,
          2
        );

        assert.deepEqual(
          manager
            .list()
            .map(
              (conversation) =>
                conversation.title
            ),
          [
            "three",
            "two"
          ]
        );
      }
    );

    it(
      "does not include aborted assistant output in context",
      () => {
        const manager =
          createManager();

        const conversation =
          manager.create();

        manager.appendMessage({
          conversationId:
            conversation.id,
          role: "user",
          content: "question"
        });

        manager.appendMessage({
          conversationId:
            conversation.id,
          role: "assistant",
          content: "partial",
          status: "aborted"
        });

        assert.deepEqual(
          manager.buildContext(
            conversation.id
          ),
          [
            {
              role: "user",
              content:
                "question"
            }
          ]
        );
      }
    );
  }
);

  // Additional managed-context behavior is tested in a separate suite

describe(
  "ConversationManager context controls",
  () => {
    it(
      "updates message flags and reset boundary without deleting history",
      () => {
        const manager =
          createManager();

        const conversation =
          manager.create();

        const first =
          manager.appendMessage({
            conversationId:
              conversation.id,
            role: "user",
            content: "first"
          });

        manager.appendMessage({
          conversationId:
            conversation.id,
          role: "assistant",
          content: "reply"
        });


        manager.updateMessageContext({
          conversationId:
            conversation.id,
          messageId: first.id,
          pinnedToContext: true
        });

        const reset =
          manager.resetContext(
            conversation.id
          );

        const saved =
          manager.getConversation(
            conversation.id
          );

        assert.equal(
          saved.messages[0]
            .pinnedToContext,
          true
        );
        assert.equal(
          reset.ok,
          true
        );
        assert.equal(
          saved.messages.length,
          2
        );
        assert.equal(
          manager.buildContext(
            conversation.id
          ).length,
          0
        );
      }
    );

    it(
      "excluding a message also removes its pin",
      () => {
        const manager =
          createManager();
        const conversation =
          manager.create();
        const message =
          manager.appendMessage({
            conversationId:
              conversation.id,
            role: "user",
            content: "message"
          });

        manager.updateMessageContext({
          conversationId:
            conversation.id,
          messageId: message.id,
          pinnedToContext: true
        });
        manager.updateMessageContext({
          conversationId:
            conversation.id,
          messageId: message.id,
          includeInContext: false
        });

        const saved =
          manager.getConversation(
            conversation.id
          ).messages[0];

        assert.equal(
          saved.includeInContext,
          false
        );
        assert.equal(
          saved.pinnedToContext,
          false
        );
      }
    );
  }
);
