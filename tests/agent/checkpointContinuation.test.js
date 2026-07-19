import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  createCheckpointContinuationState,
  resolveCheckpointContinuation
} from "../../electron/agent/checkpointResume.js";

function resumableConversation() {
  return {
    messages: [
      {
        id: "user-1",
        role: "user",
        content: "Do the task"
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "Progress summary and next recommendation",
        activity: {
          taskId: "task-1",
          runId: "run-1",
          status: "checkpoint_ready",
          stopReason: "agent_segment_limit",
          resumable: true,
          checkpoint: {
            goalId: "goal-1",
            taskId: "task-1",
            runId: "run-1",
            messageId: "assistant-1",
            objective: "Do the task",
            continuationCount: 1,
            previousSegmentCount: 12,
            phase: "checkpoint_ready",
            stopReason: "agent_segment_limit",
            plan: [
              {
                id: "inspect",
                title: "Inspect",
                status: "completed"
              },
              {
                id: "finish",
                title: "Finish",
                status: "in_progress"
              }
            ],
            counts: {
              contextCompactions: 3
            },
            orchestration: {
              segmentCount: 12
            }
          }
        }
      }
    ]
  };
}

describe("segment-boundary task continuation", () => {
  it("inherits the task into a fresh run budget", () => {
    const continuation = resolveCheckpointContinuation({
      conversation: resumableConversation(),
      message: "继续完成剩余部分"
    });
    const state = createCheckpointContinuationState(
      continuation
    );

    assert.equal(continuation.messageId, "assistant-1");
    assert.equal(state.goalId, "goal-1");
    assert.equal(state.taskId, "task-1");
    assert.equal(state.parentRunId, "run-1");
    assert.equal(state.resumedFromMessageId, "assistant-1");
    assert.equal(state.continuationCount, 2);
    assert.equal(state.previousSegmentCount, 24);
    assert.equal(state.contextCompactionCount, 3);
    assert.equal(state.initialPlan[1].status, "in_progress");
    assert.equal(Object.hasOwn(state, "segmentCount"), false);
  });

  it("does not inherit when the user explicitly starts a new task", () => {
    assert.equal(
      resolveCheckpointContinuation({
        conversation: resumableConversation(),
        message: "新任务：解释 Docker"
      }),
      null
    );
  });
});
