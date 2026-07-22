import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  createEmptyConversationData,
  sanitizeConversationData
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

function createManager() {
  let now = 100;
  let id = 0;
  return new ConversationManager({
    store: new MemoryStore(),
    now: () => ++now,
    createId: () => `id-${++id}`,
    completionAuthority: {
      verify: (permit, expected) => permit?.approved === true
        ? {
            ok: true,
            fingerprint: `permit:${expected.platformRunId}`
          }
        : { ok: false, code: "completion-signature-invalid" }
    },
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

describe("conversation Goal", () => {
  it("creates, pauses, resumes, completes and clears a session Goal", () => {
    const manager = createManager();
    const conversation = manager.create();

    const created = manager.setGoal({
      conversationId: conversation.id,
      objective: "完成项目，并让测试通过。"
    });
    assert.equal(created.ok, true);
    assert.equal(created.goal.status, "active");
    assert.equal(manager.getState().currentConversation.goal.objective, "完成项目，并让测试通过。");

    const paused = manager.setGoal({
      conversationId: conversation.id,
      objective: created.goal.objective,
      status: "paused"
    });
    assert.equal(paused.goal.id, created.goal.id);
    assert.equal(paused.goal.status, "paused");

    const resumed = manager.setGoal({
      conversationId: conversation.id,
      objective: created.goal.objective,
      status: "active"
    });
    assert.equal(resumed.goal.id, created.goal.id);

    manager.linkGoalPlatformRun({
      conversationId: conversation.id,
      goalId: created.goal.id,
      platformRunId: "platform-run-1"
    });

    const completed = manager.completeGoal({
      conversationId: conversation.id,
      goalId: created.goal.id,
      verification: {
        version: 3,
        status: "verified",
        verified: true,
        checks: []
      },
      completionPermit: { approved: true }
    });
    assert.equal(completed.ok, true);
    assert.equal(completed.goal.status, "completed");
    assert.equal(typeof completed.goal.completedAt, "number");

    const cleared = manager.setGoal({
      conversationId: conversation.id,
      objective: ""
    });
    assert.equal(cleared.ok, true);
    assert.equal(manager.getConversation(conversation.id).goal, null);
  });

  it("sanitizes persisted Goal data and rejects stale completion", () => {
    const data = sanitizeConversationData({
      version: 16,
      currentConversationId: "conversation-1",
      conversations: [{
        id: "conversation-1",
        title: "Goal",
        mode: "chat",
        createdAt: 10,
        updatedAt: 11,
        messages: [],
        goal: {
          id: "goal-1",
          objective: "  保留这个目标  ",
          status: "paused",
          createdAt: 10,
          updatedAt: 11
        }
      }]
    });

    assert.equal(data.version, 19);
    assert.deepEqual(data.conversations[0].goal, {
      version: 3,
      id: "goal-1",
      revision: 1,
      objective: "保留这个目标",
      criteria: [],
      autoContinue: true,
      status: "paused",
      platformRunId: null,
      completionFingerprint: null,
      createdAt: 10,
      updatedAt: 11,
      completedAt: null,
      lastVerification: null,
      verificationHistory: []
    });
  });

  it("persists structured Done when criteria and verification progress", () => {
    const manager = createManager();
    const conversation = manager.create();
    const created = manager.setGoal({
      conversationId: conversation.id,
      objective: "交付稳定版本",
      criteria: [
        { text: "npm test 全部通过" },
        { text: "人工确认界面可用", verificationKind: "manual", manualSatisfied: true }
      ],
      autoContinue: false
    });

    assert.equal(created.goal.version, 3);
    assert.equal(created.goal.autoContinue, false);
    assert.equal(created.goal.criteria.length, 2);
    assert.equal(created.goal.criteria[1].manualSatisfied, true);

    const progress = manager.recordGoalVerification({
      conversationId: conversation.id,
      goalId: created.goal.id,
      verification: {
        version: 2,
        status: "incomplete",
        verified: false,
        checkedAt: 120,
        reason: "仍缺测试",
        checks: [{
          id: `criterion:${created.goal.criteria[0].id}`,
          criterionId: created.goal.criteria[0].id,
          verificationKind: "test",
          passed: false,
          detail: "缺少测试证据",
          evidence: []
        }]
      }
    });

    assert.equal(progress.ok, true);
    assert.equal(progress.goal.criteria[0].verificationKind, "test");
    assert.equal(progress.goal.criteria[0].status, "failed");
    assert.equal(progress.goal.lastVerification.status, "incomplete");
    assert.equal(progress.goal.verificationHistory.length, 1);
  });

  it("reserves completion for the verifier and deduplicates criterion ids", () => {
    const manager = createManager();
    const conversation = manager.create();
    const created = manager.setGoal({
      conversationId: conversation.id,
      objective: "安全完成目标",
      status: "completed",
      criteria: [
        { id: "same", text: "测试通过" },
        { id: "same", text: "构建通过" }
      ]
    });

    assert.equal(created.goal.status, "active");
    assert.equal(new Set(created.goal.criteria.map((item) => item.id)).size, 2);

    const rejected = manager.completeGoal({
      conversationId: conversation.id,
      goalId: created.goal.id,
      verification: {
        version: 3,
        status: "verified",
        verified: true
      }
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "goal-completion-authority-unavailable");
  });
});
