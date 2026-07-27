import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ConversationManager } from "../../electron/conversation/ConversationManager.js";
import {
  projectConversationForRead,
  sanitizeConversationData
} from "../../electron/conversation/conversationSchema.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function legacyConversation() {
  return {
    version: 23,
    currentConversationId: "conversation-legacy-goal",
    conversations: [{
      id: "conversation-legacy-goal",
      title: "Legacy Goal",
      createdAt: 1,
      updatedAt: 3,
      goal: {
        version: 6,
        id: "goal-legacy",
        objective: "保留历史 Goal 供查看",
        status: "paused",
        phase: "waiting",
        criteria: [{
          id: "criterion-1",
          text: "历史完成标准",
          status: "passed",
          evidence: ["legacy-receipt"]
        }],
        waiting: {
          kind: "recovery",
          reason: "历史运行中断"
        },
        createdAt: 1,
        updatedAt: 3
      },
      messages: []
    }]
  };
}

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

test("Core Lite 3.3 physically removes Goal Runtime and mutation surfaces", () => {
  for (const relativePath of [
    "electron/goal/GoalRuntime.js",
    "src/Conversation/components/GoalPanel.jsx"
  ]) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, relativePath);
  }

  const manager = read("electron/conversation/ConversationManager.js");
  const ipc = read("electron/shared/ipcChannels.cjs");
  const preload = read("electron/preload/preload.cjs");

  for (const source of [manager]) {
    assert.doesNotMatch(
      source,
      /setGoal|completeGoal|beginGoalRun|transitionGoal|heartbeatGoal|recordGoal|replanGoal|mutateGoalRuntime|linkGoalPlatformRun/u
    );
  }
  assert.doesNotMatch(ipc, /SET_GOAL|conversation-set-goal/u);
  assert.doesNotMatch(preload, /setConversationGoal|CONVERSATION_SET_GOAL|conversation-set-goal/u);
});

test("Core Lite 3.3 retains historical Goal as an inert metadata snapshot", () => {
  const canonical = sanitizeConversationData(legacyConversation());
  const conversation = canonical.conversations[0];
  const goal = conversation.metadata.legacyAdvanced.goal;

  assert.equal(Object.hasOwn(conversation, "goal"), false);
  assert.equal(goal.id, "goal-legacy");
  assert.equal(goal.objective, "保留历史 Goal 供查看");
  assert.equal(goal.phase, "waiting");
  assert.equal(goal.criteria[0].evidence[0], "legacy-receipt");

  const projected = projectConversationForRead(conversation);
  assert.equal(projected.goal.id, "goal-legacy");
  assert.equal(projected.goal.waiting.kind, "recovery");
  assert.equal(projected.legacyAdvancedReadOnly, true);
});

test("Core Lite 3.3 legacy Goal sanitizer has no lifecycle behavior", () => {
  const source = read("electron/conversation/legacyGoalSnapshot.js");
  assert.match(source, /sanitizeLegacyGoalSnapshot/u);
  assert.match(source, /inert display data/u);
  assert.doesNotMatch(
    source,
    /upsertGoal|transitionGoal|beginGoalRun|finishGoalRun|completeGoal|recordGoal|replanGoal|recoverInterruptedGoal|PlanAuthority|ObjectiveCompatibilityGate/u
  );
});

test("Core Lite 3.3 ConversationManager exposes no Goal API", () => {
  const manager = new ConversationManager({
    store: new MemoryStore(legacyConversation())
  });

  for (const method of [
    "setGoal",
    "completeGoal",
    "beginGoalRun",
    "transitionGoal",
    "recordGoalCheckpoint",
    "recordGoalVerification",
    "replanGoal",
    "mutateGoalRuntime"
  ]) {
    assert.equal(method in manager, false, `${method} must be physically removed`);
  }

  const projected = manager.getConversation("conversation-legacy-goal");
  assert.equal(projected.goal.id, "goal-legacy");
  assert.equal(projected.legacyAdvancedReadOnly, true);
});

test("Core Lite 3.3 Goal compatibility survives a persistence round-trip", () => {
  const first = sanitizeConversationData(legacyConversation());
  const second = sanitizeConversationData(JSON.parse(JSON.stringify(first)));
  const canonical = second.conversations[0];

  assert.equal(Object.hasOwn(canonical, "goal"), false);
  assert.equal(canonical.metadata.legacyAdvanced.goal.id, "goal-legacy");
  assert.equal(
    projectConversationForRead(canonical).goal.criteria[0].text,
    "历史完成标准"
  );
});
