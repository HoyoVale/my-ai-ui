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
  contextTurns = 8,
  workspaces = []
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

    getWorkspaceById: (workspaceId) =>
      workspaces.find(
        (workspace) => workspace.id === workspaceId
      ) ?? null,

    createWorkspaceSnapshot: (workspace) => ({
      id: workspace.id,
      name: workspace.name,
      rootPath: workspace.rootPath,
      canonicalPath: workspace.canonicalPath ?? workspace.rootPath
    }),

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
      "renames a conversation and rejects an empty title",
      () => {
        const manager =
          createManager();

        const conversation =
          manager.create();

        const renamed =
          manager.rename({
            conversationId:
              conversation.id,
            title:
              "  新的 会话名称  "
          });

        assert.equal(
          renamed.ok,
          true
        );
        assert.equal(
          manager.getConversation(
            conversation.id
          ).title,
          "新的 会话名称"
        );

        const rejected =
          manager.rename({
            conversationId:
              conversation.id,
            title: "   "
          });

        assert.equal(
          rejected.ok,
          false
        );
        assert.equal(
          rejected.code,
          "empty-title"
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

describe(
  "ConversationManager regeneration",
  () => {
    it(
      "stores assistant generation metadata",
      () => {
        const manager =
          createManager();
        const conversation =
          manager.create();

        manager.appendMessage({
          conversationId:
            conversation.id,
          role: "assistant",
          content: "reply",
          durationMs: 1250,
          toolCalls: [
            {
              id: "tool-1",
              name: "read_file",
              status: "complete",
              input: {
                path: "README.md"
              },
              output: "ok"
            }
          ],
          plan: [
            {
              id: "inspect",
              title: "Inspect project",
              status: "completed"
            }
          ]
        });

        const message =
          manager.getConversation(
            conversation.id
          ).messages[0];

        assert.equal(
          message.durationMs,
          1250
        );
        assert.equal(
          message.toolCalls[0].name,
          "read_file"
        );
        assert.equal(
          message.plan[0].status,
          "completed"
        );
      }
    );

    it(
      "prepares and replaces the latest assistant reply without duplicating the user message",
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

        const assistant =
          manager.appendMessage({
            conversationId:
              conversation.id,
            role: "assistant",
            content: "old reply"
          });

        const plan =
          manager.prepareRegeneration({
            conversationId:
              conversation.id,
            messageId:
              assistant.id
          });

        assert.equal(
          plan.ok,
          true
        );
        assert.equal(
          plan.conversation
            .messages.length,
          1
        );
        assert.equal(
          plan.userMessage.content,
          "question"
        );

        const replaced =
          manager.replaceAssistantMessage({
            conversationId:
              conversation.id,
            messageId:
              assistant.id,
            content: "new reply",
            durationMs: 800
          });

        assert.equal(
          replaced.ok,
          true
        );

        const saved =
          manager.getConversation(
            conversation.id
          );

        assert.equal(
          saved.messages.length,
          2
        );
        assert.equal(
          saved.messages[1].content,
          "new reply"
        );
        assert.equal(
          saved.messages[1].durationMs,
          800
        );
      }
    );

    it(
      "rejects regeneration for an assistant reply that is no longer the latest message",
      () => {
        const manager =
          createManager();
        const conversation =
          manager.create();

        manager.appendMessage({
          conversationId:
            conversation.id,
          role: "user",
          content: "first"
        });
        const oldAssistant =
          manager.appendMessage({
            conversationId:
              conversation.id,
            role: "assistant",
            content: "reply"
          });
        manager.appendMessage({
          conversationId:
            conversation.id,
          role: "user",
          content: "second"
        });

        const result =
          manager.prepareRegeneration({
            conversationId:
              conversation.id,
            messageId:
              oldAssistant.id
          });

        assert.equal(
          result.ok,
          false
        );
        assert.equal(
          result.code,
          "not-latest-assistant-message"
        );
      }
    );
  }
);


describe(
  "ConversationManager workspace binding",
  () => {
    const workspaces = [
      {
        id: "workspace-a",
        name: "Project A",
        rootPath: "/projects/a",
        canonicalPath: "/projects/a"
      },
      {
        id: "workspace-b",
        name: "Project B",
        rootPath: "/projects/b",
        canonicalPath: "/projects/b"
      }
    ];

    it(
      "binds one workspace snapshot to a conversation and never mutates it when switching",
      () => {
        const manager = createManager({ workspaces });
        const first = manager.create({
          workspaceId: "workspace-a"
        });

        manager.appendMessage({
          conversationId: first.id,
          role: "user",
          content: "Project A task"
        });

        const switched = manager.switchWorkspace(
          "workspace-b"
        );

        assert.equal(switched.ok, true);
        assert.equal(switched.created, true);
        assert.notEqual(
          switched.conversation.id,
          first.id
        );
        assert.equal(
          switched.conversation.workspaceId,
          "workspace-b"
        );
        assert.equal(
          manager.getConversation(first.id).workspaceId,
          "workspace-a"
        );
        assert.equal(
          manager.getConversation(first.id).workspaceSnapshot.name,
          "Project A"
        );
      }
    );

    it(
      "filters summaries by workspace and keeps no-workspace sessions separate",
      () => {
        const manager = createManager({ workspaces });
        manager.create({
          title: "A",
          workspaceId: "workspace-a"
        });
        manager.create({
          title: "None",
          workspaceId: null
        });
        manager.create({
          title: "B",
          workspaceId: "workspace-b"
        });

        assert.deepEqual(
          manager.list({ workspaceId: "workspace-a" })
            .map((conversation) => conversation.title),
          ["A"]
        );
        assert.deepEqual(
          manager.list({ workspaceId: null })
            .map((conversation) => conversation.title),
          ["None"]
        );
      }
    );

    it(
      "rejects binding a new conversation to an unknown workspace",
      () => {
        const manager = createManager({ workspaces });

        assert.throws(
          () => manager.create({
            workspaceId: "missing"
          }),
          /工作区不存在/u
        );
      }
    );
    it(
      "binds and clears a Skill snapshot per conversation",
      () => {
        const manager = createManager();
        const conversation = manager.create({
          mode: "chat",
          skillId: "debug",
          skillSnapshot: {
            id: "debug",
            name: "Debug",
            version: "1.0.0",
            description: "Find issues.",
            modes: ["chat"],
            requiredCapabilities: ["runtime.info"],
            optionalCapabilities: [],
            permissions: { localWrite: "deny" },
            manifestHash: "a".repeat(64),
            promptHash: "b".repeat(64),
            packageHash: "c".repeat(64)
          }
        });

        assert.equal(conversation.skillId, "debug");
        assert.equal(manager.getState().currentSkill.name, "Debug");
        assert.equal(conversation.skillSnapshot.promptHash, "b".repeat(64));
        assert.deepEqual(conversation.skillSnapshot.requiredCapabilities, ["runtime.info"]);

        const changed = manager.setSkillSelection({
          conversationId: conversation.id,
          skill: {
            id: "review",
            name: "Review",
            version: "2.0.0",
            description: "Review changes."
          }
        });
        assert.equal(changed.ok, true);
        assert.equal(changed.conversation.skillId, "review");
        assert.equal(changed.conversation.skillSnapshot.version, "2.0.0");

        const cleared = manager.setSkillSelection({
          conversationId: conversation.id,
          skill: null
        });
        assert.equal(cleared.ok, true);
        assert.equal(cleared.conversation.skillId, null);
        assert.equal(cleared.conversation.skillSnapshot, null);
      }
    );

  }
);
