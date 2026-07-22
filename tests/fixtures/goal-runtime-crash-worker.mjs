import path from "node:path";

import {
  ConversationManager
} from "../../electron/conversation/ConversationManager.js";

import {
  ConversationStore
} from "../../electron/conversation/ConversationStore.js";

const [mode, directory] = process.argv.slice(2);
const filePath = path.join(directory, "conversations.json");
let now = 1000;
let id = 0;
const store = new ConversationStore({
  getFilePath: () => filePath,
  writeDelayMs: 0
});
const manager = new ConversationManager({
  store,
  now: () => ++now,
  createId: () => `goal-e2e-${++id}`,
  getSettings: () => ({
    conversation: {
      maxConversations: 100,
      contextTurns: 8,
      autoTitle: true,
      saveAbortedReplies: true
    }
  })
});

if (mode === "seed") {
  const conversation = manager.create();
  const created = manager.setGoal({
    conversationId: conversation.id,
    objective: "验证 Goal Runtime 崩溃恢复",
    criteria: ["恢复后检查点仍然存在"]
  });
  manager.beginGoalRun({
    conversationId: conversation.id,
    goalId: created.goal.id,
    runId: "run-before-crash",
    taskId: "task-before-crash"
  });
  manager.heartbeatGoal({
    conversationId: conversation.id,
    goalId: created.goal.id,
    runId: "run-before-crash",
    phase: "executing"
  });
  manager.recordGoalCheckpoint({
    conversationId: conversation.id,
    goalId: created.goal.id,
    checkpoint: {
      id: "checkpoint-before-crash",
      runId: "run-before-crash",
      taskId: "task-before-crash",
      messageId: "message-before-crash",
      segmentId: "segment-before-crash",
      phase: "executing",
      outcome: "running",
      resumable: true,
      publicStatus: "第一阶段已保存"
    }
  });
  await store.flush();
  process.exit(17);
}

if (mode === "recover") {
  const state = manager.getState();
  await store.flush();
  process.stdout.write(JSON.stringify(state.currentConversation.goal));
  process.exit(0);
}

throw new Error(`Unknown worker mode: ${mode}`);
