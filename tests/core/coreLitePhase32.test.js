import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  projectConversationForRead,
  sanitizeConversationData
} from "../../electron/conversation/conversationSchema.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function legacyFixture() {
  return {
    version: 23,
    currentConversationId: "conversation-legacy",
    conversations: [{
      id: "conversation-legacy",
      title: "Legacy",
      createdAt: 1,
      updatedAt: 2,
      goal: {
        id: "goal-legacy",
        objective: "保留历史目标",
        status: "active",
        createdAt: 1,
        updatedAt: 2
      },
      activeExecutionThreadId: "thread-legacy",
      executionThreads: [{
        id: "thread-legacy",
        taskId: "task-legacy",
        objective: "保留历史执行线程",
        status: "completed",
        createdAt: 1,
        updatedAt: 2
      }],
      messages: [{
        id: "assistant-legacy",
        role: "assistant",
        content: "历史回复",
        status: "complete",
        createdAt: 2,
        plan: [{ id: "step-1", title: "历史计划", status: "completed" }],
        taskId: "task-legacy",
        executionThreadId: "thread-legacy",
        runOutcome: "completed",
        runPhase: "completed",
        runResumable: false
      }]
    }]
  };
}

test("Core Lite 3.2 migrates advanced conversation roots into read-only metadata", () => {
  const data = sanitizeConversationData(legacyFixture());
  const conversation = data.conversations[0];

  assert.equal(data.version, 24);
  for (const key of [
    "goal",
    "activeExecutionThreadId",
    "executionThreads",
    "executionThread",
    "routingDecisions"
  ]) {
    assert.equal(Object.hasOwn(conversation, key), false, `${key} must not remain canonical`);
  }

  assert.equal(conversation.metadata.schema, "core-lite");
  assert.equal(conversation.metadata.legacyAdvanced.readOnly, true);
  assert.equal(conversation.metadata.legacyAdvanced.goal.id, "goal-legacy");
  assert.equal(
    conversation.metadata.legacyAdvanced.execution.executionThreads[0].id,
    "thread-legacy"
  );
});

test("Core Lite 3.2 keeps historical advanced fields in a read-only projection", () => {
  const canonical = sanitizeConversationData(legacyFixture()).conversations[0];
  const projected = projectConversationForRead(canonical);

  assert.equal(projected.goal.id, "goal-legacy");
  assert.equal(projected.executionThread.id, "thread-legacy");
  assert.equal(projected.executionThreads.length, 1);
  assert.equal(projected.legacyAdvancedReadOnly, true);
});

test("Core Lite 3.2 stores display Plan and run bindings under Message metadata", () => {
  const message = sanitizeConversationData(legacyFixture())
    .conversations[0]
    .messages[0];

  for (const key of [
    "plan",
    "planState",
    "taskId",
    "executionThreadId",
    "runOutcome",
    "runPhase",
    "runResumable"
  ]) {
    assert.equal(Object.hasOwn(message, key), false, `${key} must not remain canonical`);
  }

  assert.equal(message.metadata.plan[0].title, "历史计划");
  assert.equal(message.metadata.taskId, "task-legacy");
  assert.equal(message.metadata.legacyExecutionThreadId, "thread-legacy");
  assert.deepEqual(message.metadata.run, {
    outcome: "completed",
    phase: "completed",
    resumable: false
  });

  const projected = projectConversationForRead(
    sanitizeConversationData(legacyFixture()).conversations[0]
  ).messages[0];
  assert.equal(projected.plan[0].title, "历史计划");
  assert.equal(projected.taskId, "task-legacy");
  assert.equal(projected.executionThreadId, "thread-legacy");
  assert.equal(projected.runOutcome, "completed");
});

test("Core Lite 3.2 keeps new canonical conversations free of legacy advanced state", () => {
  const conversation = sanitizeConversationData({
    currentConversationId: "conversation-new",
    conversations: [{
      id: "conversation-new",
      title: "New",
      createdAt: 1,
      updatedAt: 1,
      messages: [{
        id: "user-1",
        role: "user",
        content: "Hello",
        createdAt: 1
      }]
    }]
  }).conversations[0];

  assert.deepEqual(conversation.metadata, {
    schema: "core-lite",
    version: 1
  });
  assert.equal(Object.hasOwn(conversation.metadata, "legacyAdvanced"), false);
});


test("Core Lite 3.2 persistence round-trip never writes compatibility aliases", () => {
  const first = sanitizeConversationData(legacyFixture());
  const serialized = JSON.stringify(first);
  const second = sanitizeConversationData(JSON.parse(serialized));
  const conversation = second.conversations[0];
  const message = conversation.messages[0];

  for (const key of [
    "goal",
    "activeExecutionThreadId",
    "executionThreads",
    "executionThread",
    "routingDecisions"
  ]) {
    assert.equal(Object.hasOwn(conversation, key), false);
  }
  for (const key of [
    "plan",
    "planState",
    "taskId",
    "executionThreadId",
    "runOutcome",
    "runPhase",
    "runResumable"
  ]) {
    assert.equal(Object.hasOwn(message, key), false);
  }

  assert.equal(
    conversation.metadata.legacyAdvanced.execution.executionThreads[0].id,
    "thread-legacy"
  );
  assert.equal(message.metadata.taskId, "task-legacy");
});

test("Core Lite 3.2 canonical storage remains independent from removed advanced services", () => {
  const state = read("electron/conversation/services/ConversationStateService.js");
  const manager = read("electron/conversation/ConversationManager.js");
  const schema = read("electron/conversation/conversationSchema.js");

  assert.doesNotMatch(state, /recoverInterruptedGoal|recoverExecutionThreadCollection|threadRoutingDecisionStore/u);
  assert.doesNotMatch(state, /conversation\.goal\s*=|conversation\.executionThreads\s*=/u);
  assert.doesNotMatch(manager, /ConversationExecutionService|beginExecutionThread|recordThreadRoutingDecision/u);
  assert.equal(
    fs.existsSync(path.join(root, "electron/conversation/services/ConversationExecutionService.js")),
    false
  );
  assert.match(schema, /const STORE_VERSION = 24/u);
  assert.match(schema, /metadata:\s*\{[\s\S]*schema: "core-lite"/u);
});
