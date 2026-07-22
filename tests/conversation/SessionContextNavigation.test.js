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
  encodeModelOptionValue,
  flattenModels,
  parseModelOptionValue
} from "../../src/Input/hooks/useInputContext.js";

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

const WORKSPACES = [
  {
    id: "workspace-a",
    name: "Alpha",
    rootPath: "/workspace/alpha",
    canonicalPath: "/workspace/alpha"
  },
  {
    id: "workspace-b",
    name: "Beta",
    rootPath: "/workspace/beta",
    canonicalPath: "/workspace/beta"
  }
];

const MODEL_SETTINGS = {
  activeProvider: "provider-a",
  providers: {
    "provider-a": {
      id: "provider-a",
      name: "Provider A",
      activeModelId: "model-a",
      models: [
        {
          id: "model-a",
          name: "Model A",
          modelId: "model-a-api"
        },
        {
          id: "model-b",
          name: "Model B",
          modelId: "model-b-api"
        }
      ]
    }
  }
};

function createManager() {
  let timestamp = 1000;
  let sequence = 0;

  return new ConversationManager({
    store: new MemoryStore(),
    now: () => ++timestamp,
    createId: () => `conversation-${++sequence}`,
    getSettings: () => ({
      conversation: {
        maxConversations: 100,
        contextTurns: 8,
        autoTitle: true,
        saveAbortedReplies: true
      },
      model: MODEL_SETTINGS
    }),
    getWorkspaceById: (workspaceId) =>
      WORKSPACES.find((workspace) => workspace.id === workspaceId) ?? null,
    createWorkspaceSnapshot: (workspace) =>
      workspace
        ? {
            id: workspace.id,
            name: workspace.name,
            rootPath: workspace.rootPath,
            canonicalPath: workspace.canonicalPath
          }
        : null
  });
}

function createMutableSettingsManager() {
  let settings = structuredClone(MODEL_SETTINGS);
  let timestamp = 2000;
  let sequence = 0;
  const manager = new ConversationManager({
    store: new MemoryStore(),
    now: () => ++timestamp,
    createId: () => `mutable-conversation-${++sequence}`,
    getSettings: () => ({
      conversation: {
        maxConversations: 100,
        contextTurns: 8,
        autoTitle: true,
        saveAbortedReplies: true
      },
      model: settings
    })
  });
  return {
    manager,
    setModelSettings(next) {
      settings = structuredClone(next);
    }
  };
}

describe("session mode, workspace and model navigation", () => {
  it("reuses the latest Chat session for a workspace and creates only when absent", () => {
    const manager = createManager();
    const noWorkspace = manager.create({ mode: "chat", workspaceId: null });

    const firstSwitch = manager.navigateContext({
      mode: "chat",
      workspaceId: "workspace-a"
    });

    assert.equal(firstSwitch.ok, true);
    assert.equal(firstSwitch.created, true);
    assert.equal(firstSwitch.conversation.workspaceId, "workspace-a");
    assert.equal(manager.list().length, 2);

    manager.select(noWorkspace.id);

    const secondSwitch = manager.navigateContext({
      mode: "chat",
      workspaceId: "workspace-a"
    });

    assert.equal(secondSwitch.ok, true);
    assert.equal(secondSwitch.created, false);
    assert.equal(secondSwitch.conversation.id, firstSwitch.conversation.id);
    assert.equal(manager.list().length, 2);
  });

  it("requires a workspace for Coding and never rebinds an existing Coding session", () => {
    const manager = createManager();
    manager.create({ mode: "chat", workspaceId: null });

    const missingWorkspace = manager.navigateContext({ mode: "coding" });
    assert.equal(missingWorkspace.ok, false);
    assert.equal(missingWorkspace.code, "coding-workspace-required");

    const alpha = manager.navigateContext({
      mode: "coding",
      workspaceId: "workspace-a"
    });
    assert.equal(alpha.ok, true);
    assert.equal(alpha.created, true);
    assert.equal(alpha.conversation.workspaceId, "workspace-a");

    const beta = manager.navigateContext({
      mode: "coding",
      workspaceId: "workspace-b"
    });
    assert.equal(beta.ok, true);
    assert.equal(beta.created, true);
    assert.notEqual(beta.conversation.id, alpha.conversation.id);
    assert.equal(manager.getConversation(alpha.conversation.id).workspaceId, "workspace-a");

    manager.select(alpha.conversation.id);
    const alphaAgain = manager.navigateContext({
      mode: "coding",
      workspaceId: "workspace-a"
    });
    assert.equal(alphaAgain.created, false);
    assert.equal(alphaAgain.conversation.id, alpha.conversation.id);
  });

  it("switches models inside one session without creating another session", () => {
    const manager = createManager();
    const conversation = manager.create({
      mode: "chat",
      workspaceId: null
    });

    const changed = manager.setModelSelection({
      conversationId: conversation.id,
      providerId: "provider-a",
      modelConfigId: "model-b"
    });

    assert.equal(changed.ok, true);
    assert.deepEqual(changed.conversation.modelSelection, {
      providerId: "provider-a",
      modelConfigId: "model-b"
    });
    assert.equal(changed.conversation.modelSnapshot.modelId, "model-b-api");
    assert.equal(manager.list().length, 1);
  });

  it("keeps Chat and Coding sessions as separate mode groups", () => {
    const manager = createManager();
    manager.create({ mode: "chat", workspaceId: null });
    manager.create({ mode: "chat", workspaceId: "workspace-a" });
    manager.create({ mode: "coding", workspaceId: "workspace-a" });

    assert.equal(manager.list({ mode: "chat" }).length, 2);
    assert.equal(manager.list({ mode: "coding" }).length, 1);
    assert.equal(
      manager.list({ mode: "chat", workspaceId: "workspace-a" }).length,
      1
    );
  });

  it("reconciles every conversation when a configured model changes or is removed", () => {
    const value = createMutableSettingsManager();
    const conversation = value.manager.create({
      modelSelection: {
        providerId: "provider-a",
        modelConfigId: "model-b"
      }
    });
    assert.equal(conversation.modelSnapshot.modelName, "Model B");

    const renamed = structuredClone(MODEL_SETTINGS);
    renamed.providers["provider-a"].models[1].name = "Model B renamed";
    value.setModelSettings(renamed);
    value.manager.reconcileSettings();
    assert.equal(
      value.manager.getState().currentModel.modelName,
      "Model B renamed"
    );

    const removed = structuredClone(MODEL_SETTINGS);
    removed.providers["provider-a"].models = [
      removed.providers["provider-a"].models[0]
    ];
    value.setModelSettings(removed);
    value.manager.reconcileSettings();
    assert.deepEqual(value.manager.getState().currentModelSelection, {
      providerId: "provider-a",
      modelConfigId: "model-a"
    });
  });
  it("encodes custom model ids without colon collisions and puts the active model first", () => {
    const value = encodeModelOptionValue("provider:custom", "model:qwen:7b");

    assert.deepEqual(parseModelOptionValue(value), {
      providerId: "provider:custom",
      modelConfigId: "model:qwen:7b"
    });
    assert.equal(parseModelOptionValue("invalid"), null);

    const models = flattenModels({
      model: {
        activeProvider: "provider-b",
        providers: {
          "provider-a": {
            id: "provider-a",
            name: "A",
            activeModelId: "a",
            models: [{ id: "a", name: "A" }]
          },
          "provider-b": {
            id: "provider-b",
            name: "B",
            activeModelId: "b",
            models: [{ id: "b", name: "B" }]
          }
        }
      }
    });

    assert.equal(models[0].providerId, "provider-b");
    assert.equal(models[0].modelConfigId, "b");
  });

});
