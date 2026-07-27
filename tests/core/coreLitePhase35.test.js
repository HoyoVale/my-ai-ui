import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CoreLiteRunLoop } from "../../electron/agent/execution/CoreLiteRunLoop.js";
import { ConversationManager } from "../../electron/conversation/ConversationManager.js";
import {
  projectConversationForRead,
  sanitizeConversationData
} from "../../electron/conversation/conversationSchema.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

class MemoryStore {
  constructor(data) {
    this.data = sanitizeConversationData(data);
  }

  load() {
    return structuredClone(this.data);
  }

  save(data) {
    this.data = sanitizeConversationData(data);
    return this.load();
  }
}

function legacyExecutionData() {
  return {
    version: 23,
    currentConversationId: "conversation-legacy",
    conversations: [{
      id: "conversation-legacy",
      title: "Legacy execution",
      mode: "coding",
      createdAt: 1,
      updatedAt: 4,
      messages: [],
      activeExecutionThreadId: "thread-1",
      executionThreads: [{
        version: 3,
        id: "thread-1",
        taskId: "task-1",
        objective: "历史执行任务",
        status: "waiting",
        runs: [{
          id: "run-1",
          threadId: "thread-1",
          sequence: 1,
          state: "checkpointed",
          createdAt: 2,
          updatedAt: 3
        }],
        checkpoint: { stopReason: "interrupted" },
        createdAt: 1,
        updatedAt: 3
      }],
      routingDecisions: [{
        id: "decision-1",
        command: "resume",
        action: "resume",
        state: "applied",
        conversationId: "conversation-legacy",
        targetThreadId: "thread-1",
        createdAt: 4
      }]
    }]
  };
}

function createManager(store) {
  return new ConversationManager({
    store,
    now: () => 10,
    createId: () => "message-new"
  });
}

test("Core Lite 3.5 physically removes Execution Model and legacy orchestrators", () => {
  const removed = [
    "electron/execution-model",
    "electron/agent/ExecutionThread.js",
    "electron/agent/RunEngine.js",
    "electron/agent/GoalCompletionVerifier.js",
    "electron/agent/orchestration/LongTaskOrchestrator.js",
    "electron/agent/orchestration/SegmentExecutionLoop.js",
    "electron/agent/checkpointResume.js",
    "electron/agent/runCheckpoint.js",
    "electron/conversation/services/ConversationExecutionService.js",
    "electron/platform/bridge/PlatformExecutionBridgeService.js",
    "tests/execution-model"
  ];

  for (const relativePath of removed) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, relativePath);
  }
});

test("Core Lite 3.5 leaves one direct run lifecycle in production", () => {
  const sources = [
    "electron/agent/AgentRuntime.js",
    "electron/agent/execution/AgentRunExecution.js",
    "electron/agent/execution/CoreLiteRunLoop.js"
  ].map(read).join("\n");

  assert.match(sources, /runLoop\.runToCompletion/u);
  assert.match(sources, /executeModelLoop/u);
  assert.match(sources, /executeRun/u);
  assert.doesNotMatch(
    sources,
    /ExecutionThread|RunEngine|LongTaskOrchestrator|SegmentExecutionLoop|executeAgentSegment|executeSegment|onSegmentStart|onSegmentComplete|threadCommand/u
  );

  const toolSessionSource = read(
    "electron/tools/createAgentToolSession.js"
  );
  assert.match(
    toolSessionSource,
    /segmentId\s*\|\|\s*runId/u
  );
  assert.match(
    toolSessionSource,
    /getSegmentId\?\.\(\)\s*\|\|\s*runtimePartitionId/u
  );
});

test("Core Lite 3.5 CoreLiteRunLoop accepts only executeRun", async () => {
  const loop = new CoreLiteRunLoop({
    runId: "run-1",
    objective: "single run",
    runDeadline: 10_000,
    now: () => 1,
    finalizationPolicy: () => false,
    outcomeResolver: ({ stopReason }) => ({
      outcome: "completed",
      stopReason
    })
  });

  await assert.rejects(
    () => loop.run({ executeSegment: async () => ({}) }),
    /requires executeRun/u
  );

  const result = await loop.run({
    executeRun: async ({ runUnit }) => ({
      finishReason: "stop",
      executionStopReason: "completed",
      records: [{ id: "receipt-1", runUnitId: runUnit.id }]
    })
  });

  assert.equal(result.decision, "complete");
  assert.equal(result.runUnit.id, "run:run-1");
  assert.equal(Object.hasOwn(result, "segment"), false);
  assert.equal(Object.hasOwn(result, "segmentOutcome"), false);
});

test("Core Lite 3.5 preserves historical Execution Thread data as inert read-only metadata", () => {
  const canonical = sanitizeConversationData(legacyExecutionData());
  const stored = canonical.conversations[0];

  assert.equal(Object.hasOwn(stored, "executionThread"), false);
  assert.equal(Object.hasOwn(stored, "executionThreads"), false);
  assert.equal(Object.hasOwn(stored, "routingDecisions"), false);
  assert.equal(
    stored.metadata.legacyAdvanced.execution.executionThreads[0].id,
    "thread-1"
  );

  const projected = projectConversationForRead(stored);
  assert.equal(projected.executionThread.id, "thread-1");
  assert.equal(projected.executionThreads.length, 1);
  assert.equal(projected.routingDecisions[0].id, "decision-1");
  assert.equal(projected.legacyAdvancedReadOnly, true);
});

test("Core Lite 3.5 historical execution snapshot survives JSON round trips without regaining authority", () => {
  const first = sanitizeConversationData(legacyExecutionData());
  const second = sanitizeConversationData(JSON.parse(JSON.stringify(first)));
  const stored = second.conversations[0];

  assert.equal(Object.hasOwn(stored, "activeExecutionThreadId"), false);
  assert.equal(Object.hasOwn(stored, "executionThreads"), false);
  assert.equal(
    stored.metadata.legacyAdvanced.execution.executionThreads[0].checkpoint.stopReason,
    "interrupted"
  );
  assert.equal(projectConversationForRead(stored).executionThread.id, "thread-1");
});

test("Core Lite 3.5 exposes no Execution Thread mutation API and ignores new executionThreadId writes", () => {
  const store = new MemoryStore({
    version: 24,
    currentConversationId: "conversation-new",
    conversations: [{
      id: "conversation-new",
      title: "New",
      mode: "chat",
      createdAt: 1,
      updatedAt: 1,
      messages: []
    }]
  });
  const manager = createManager(store);

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

  manager.appendMessage({
    conversationId: "conversation-new",
    role: "assistant",
    content: "Done",
    executionThreadId: "forbidden-thread"
  });

  const persisted = store.data.conversations[0].messages[0];
  assert.equal(Object.hasOwn(persisted.metadata ?? {}, "legacyExecutionThreadId"), false);
  assert.equal(Object.hasOwn(persisted, "executionThreadId"), false);
});

