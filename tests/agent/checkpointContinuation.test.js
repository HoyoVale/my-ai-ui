import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  createCheckpointContinuationState,
  resolveCheckpointContinuation
} from "../../electron/agent/checkpointResume.js";

function resumableConversation(stopReason = "agent_segment_limit") {
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
          stopReason,
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
            stopReason,
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
            planState: {
              schemaVersion: 2,
              rootItems: [
                { id: "inspect", title: "Inspect", status: "completed" },
                { id: "finish", title: "Finish", status: "in_progress" }
              ],
              subplans: [
                {
                  rootStepId: "finish",
                  items: [
                    { id: "detail", title: "Verify", status: "in_progress" }
                  ]
                }
              ]
            },
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
    assert.equal(state.initialPlanState.schemaVersion, 2);
    assert.equal(state.initialPlanState.subplans[0].items[0].id, "detail");
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
  it("inherits checkpoints from any graceful internal boundary", () => {
    const continuation = resolveCheckpointContinuation({
      conversation: resumableConversation("tool_call_limit"),
      message: "继续"
    });

    assert.equal(continuation.messageId, "assistant-1");
    assert.equal(continuation.checkpoint.stopReason, "tool_call_limit");
  });

  it("does not inherit ordinary follow-up messages without an explicit continue intent", () => {
    assert.equal(
      resolveCheckpointContinuation({
        conversation: resumableConversation(),
        message: "Docker Desktop 为什么占用这么多内存？"
      }),
      null
    );

    assert.equal(
      resolveCheckpointContinuation({
        conversation: resumableConversation(),
        message: "好的"
      }),
      null
    );
  });

  it("recognizes a direct reference to the previous recommendation as continuation", () => {
    const continuation = resolveCheckpointContinuation({
      conversation: resumableConversation(),
      message: "按你的建议做"
    });

    assert.equal(continuation.messageId, "assistant-1");
  });

  it("supports an explicit continuation flag for a future Continue Task button", () => {
    const continuation = resolveCheckpointContinuation({
      conversation: resumableConversation(),
      message: "按建议处理",
      explicit: true
    });

    assert.equal(continuation.messageId, "assistant-1");
  });

});
