import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, test } from "node:test";

import {
  ConversationManager
} from "../../electron/conversation/ConversationManager.js";
import {
  ConversationStore
} from "../../electron/conversation/ConversationStore.js";
import {
  createEmptyConversationData,
  sanitizeConversationData
} from "../../electron/conversation/conversationSchema.js";
import {
  ROUTING_ACTIONS,
  ROUTING_DECISION_STATES,
  ROUTING_SOURCES,
  THREAD_COMMANDS,
  createThreadRoutingDecision,
  threadRoutingDecisionStore
} from "../../electron/execution-model/index.js";

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

const temporaryDirectories = [];
const stores = [];
afterEach(async () => {
  threadRoutingDecisionStore.clear();
  await Promise.all(stores.splice(0).map((store) => store.flush()));
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Execution Model phase D persistence", () => {
  it("migrates one v22 executionThread into the v23 thread collection", () => {
    const data = sanitizeConversationData({
      version: 22,
      currentConversationId: "conversation-1",
      conversations: [{
        id: "conversation-1",
        mode: "coding",
        workspaceId: "workspace-1",
        title: "Legacy",
        createdAt: 1,
        updatedAt: 2,
        messages: [],
        executionThread: {
          version: 1,
          id: "thread-1",
          taskId: "task-1",
          status: "waiting",
          mode: "coding",
          workspaceId: "workspace-1",
          lastRunId: "run-1",
          createdAt: 1,
          updatedAt: 2
        }
      }]
    });
    const conversation = data.conversations[0];
    assert.equal(data.version, 23);
    assert.equal(conversation.activeExecutionThreadId, "thread-1");
    assert.equal(conversation.executionThreads.length, 1);
    assert.equal(conversation.executionThreads[0].version, 2);
    assert.equal(conversation.executionThreads[0].runs[0].id, "run-1");
    assert.equal(conversation.executionThreads[0].runs[0].state, "continuable");
    assert.deepEqual(conversation.executionThread, conversation.executionThreads[0]);
  });

  it("preserves old threads while a new active thread is created", () => {
    const store = new MemoryStore();
    const manager = createManager(store);
    const conversation = manager.create({ mode: "coding", workspaceId: "workspace-1" });

    manager.beginExecutionThread({
      conversationId: conversation.id,
      threadId: "thread-1",
      taskId: "task-1",
      runId: "run-1",
      mode: "coding",
      workspaceId: "workspace-1"
    });
    manager.finishExecutionThread({
      conversationId: conversation.id,
      threadId: "thread-1",
      outcome: "completed",
      stopReason: "completed"
    });
    manager.beginExecutionThread({
      conversationId: conversation.id,
      threadId: "thread-2",
      taskId: "task-2",
      runId: "run-2",
      mode: "coding",
      workspaceId: "workspace-1"
    });

    const current = manager.getConversation(conversation.id);
    assert.equal(current.activeExecutionThreadId, "thread-2");
    assert.equal(current.executionThreads.length, 2);
    assert.equal(current.executionThreads.find((thread) => thread.id === "thread-1").status, "completed");
    assert.equal(current.executionThread.id, "thread-2");
  });

  it("persists bounded run lineage and provider continuation", () => {
    const store = new MemoryStore();
    const manager = createManager(store);
    const conversation = manager.create({ mode: "coding", workspaceId: "workspace-1" });
    manager.beginExecutionThread({
      conversationId: conversation.id,
      threadId: "thread-1",
      taskId: "task-1",
      runId: "run-1",
      userMessageId: "user-1",
      mode: "coding",
      workspaceId: "workspace-1"
    });
    manager.finishExecutionThread({
      conversationId: conversation.id,
      threadId: "thread-1",
      outcome: "completed",
      stopReason: "completed"
    });
    manager.beginExecutionThread({
      conversationId: conversation.id,
      threadId: "thread-1",
      taskId: "task-1",
      runId: "run-2",
      relation: "resume",
      previousRunId: "run-1",
      userMessageId: "user-2"
    });
    const continuation = manager.recordProviderContinuation({
      conversationId: conversation.id,
      threadId: "thread-1",
      continuation: {
        providerId: "openai-compatible",
        modelConfigId: "deepseek-v4",
        responseId: "response-2"
      }
    });
    assert.equal(continuation.ok, true);

    const reloaded = createManager(store, 500);
    const thread = reloaded.getConversation(conversation.id).executionThread;
    assert.deepEqual(thread.runs.map((run) => [run.id, run.relation, run.previousRunId]), [
      ["run-1", "initial", ""],
      ["run-2", "resume", "run-1"]
    ]);
    assert.equal(thread.runs[0].state, "completed");
    assert.equal(thread.runs[1].state, "continuable");
    assert.equal(thread.providerContinuation.responseId, "response-2");
  });

  it("persists sanitized routing decisions and hydrates the diagnostic store", () => {
    const store = new MemoryStore();
    const first = createManager(store);
    const conversation = first.create({ mode: "chat" });
    const decision = createThreadRoutingDecision({
      id: "decision-1",
      command: THREAD_COMMANDS.RESUME,
      action: ROUTING_ACTIONS.RESUME,
      state: ROUTING_DECISION_STATES.PROPOSED,
      source: ROUTING_SOURCES.SEMANTIC_FALLBACK,
      conversationId: conversation.id,
      targetThreadId: "thread-1",
      targetRunId: "run-2",
      reason: "feedback-on-current-thread",
      evidence: ["message-intent:feedback"],
      legacyAction: ROUTING_ACTIONS.START,
      shadowMode: true,
      now: 120
    });
    assert.equal(first.recordThreadRoutingDecision({
      conversationId: conversation.id,
      decision
    }).ok, true);

    threadRoutingDecisionStore.clear();
    const reloaded = createManager(store, 500);
    const persisted = reloaded.getConversation(conversation.id).routingDecisions;
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].shadow.mismatch, true);
    assert.doesNotMatch(JSON.stringify(persisted), /still wrong|还是不对/u);
    assert.equal(
      threadRoutingDecisionStore.snapshot({ conversationId: conversation.id }).total,
      1
    );
  });

  it("recovers every running thread without automatically dispatching another run", () => {
    const store = new MemoryStore();
    const first = createManager(store);
    const conversation = first.create({ mode: "coding", workspaceId: "workspace-1" });
    first.beginExecutionThread({
      conversationId: conversation.id,
      threadId: "thread-1",
      taskId: "task-1",
      runId: "run-1",
      mode: "coding",
      workspaceId: "workspace-1"
    });
    first.beginExecutionThread({
      conversationId: conversation.id,
      threadId: "thread-2",
      taskId: "task-2",
      runId: "run-2",
      mode: "coding",
      workspaceId: "workspace-1"
    });

    const reloaded = createManager(store, 500);
    const threads = reloaded.listExecutionThreads({ conversationId: conversation.id });
    assert.deepEqual(
      threads.map((thread) => [thread.id, thread.status, thread.runs.at(-1).state]).sort(),
      [
        ["thread-1", "waiting", "continuable"],
        ["thread-2", "waiting", "continuable"]
      ]
    );
    assert.equal(reloaded.getConversation(conversation.id).activeExecutionThreadId, "thread-2");
  });
});

describe("ConversationStore interrupted replacement recovery", () => {
  it("loads a valid temporary snapshot when the primary file is missing", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "conversation-phase-d-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "conversations.json");
    fs.writeFileSync(`${filePath}.tmp`, JSON.stringify({
      version: 23,
      currentConversationId: "conversation-1",
      conversations: [{
        id: "conversation-1",
        title: "Recovered",
        createdAt: 1,
        updatedAt: 1,
        messages: []
      }]
    }), "utf8");
    const store = new ConversationStore({ getFilePath: () => filePath, writeDelayMs: 0 });
    stores.push(store);
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const loaded = store.load();
      assert.equal(loaded.currentConversationId, "conversation-1");
      assert.equal(loaded.conversations[0].title, "Recovered");
      await store.flush();
      assert.equal(fs.existsSync(filePath), true);
    } finally {
      console.warn = originalWarn;
    }
  });
});

test("phase D persistence keeps the legacy rollback path during guarded rollout", () => {
  const schema = fs.readFileSync(new URL("../../electron/conversation/conversationSchema.js", import.meta.url), "utf8");
  const preparation = fs.readFileSync(new URL("../../electron/agent/preparation/AgentRunPreparation.js", import.meta.url), "utf8");
  assert.match(schema, /const STORE_VERSION = 23;/u);
  assert.match(preparation, /recordThreadRoutingDecision/u);
  assert.match(preparation, /effectiveRoutingAction/u);
  assert.match(preparation, /relation:\s*"regenerate"/u);
  assert.match(preparation, /regeneratedFromRunId:\s*regenerationSourceRunId/u);
  assert.doesNotMatch(preparation, /steeringQueue\.enqueue/u);
});
