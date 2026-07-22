import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  applyGoalPlanState,
  recordGoalWorkingState,
  upsertGoal
} from "../../electron/goal/GoalRuntime.js";

import {
  createCheckpointContinuationState,
  resolveCheckpointContinuation
} from "../../electron/agent/checkpointResume.js";

import {
  PlatformKernel
} from "../../electron/platform/PlatformKernel.js";

function assistantCheckpoint({ goal, runId, messageId, taskId }) {
  return {
    id: messageId,
    role: "assistant",
    content: `Progress from ${runId}`,
    activity: {
      status: "checkpoint_ready",
      stopReason: "tool_error",
      resumable: true,
      checkpoint: {
        version: 5,
        goalId: goal.id,
        taskId,
        runId,
        messageId,
        objective: goal.objective,
        phase: "checkpoint_ready",
        stopReason: "tool_error",
        resumable: true,
        continuationCount: Number(runId.split("-").at(-1)) || 0,
        plan: goal.planAuthority.state.rootItems,
        planState: goal.planAuthority.state,
        workingState: goal.workingState,
        tools: [{
          name: "replace_text_in_file",
          status: "failed",
          result: {
            error: {
              code: "TEXT_NOT_FOUND",
              category: "not_found",
              message: "The old text changed",
              retryable: false
            }
          }
        }]
      }
    }
  };
}

describe("P0 continuity and Plan Authority", () => {
  it("keeps five feedback rounds on one Goal, task, Platform Run and root plan", () => {
    const storage = fs.mkdtempSync(path.join(os.tmpdir(), "continuity-platform-"));
    try {
      const kernel = new PlatformKernel({
        getStorageDirectory: () => storage,
        createId: () => "platform-run-1"
      });
      let goal = upsertGoal(null, {
        objective: "Build and visually verify a black-hole scene",
        criteria: [{ id: "visual", text: "Visual result is accepted" }]
      }, {
        now: 1,
        createId: () => "goal-black-hole"
      }).goal;
      const rootPlanId = goal.planAuthority.rootPlanId;
      goal = applyGoalPlanState(goal, {
        schemaVersion: 3,
        rootPlanId,
        authorityRevision: 1,
        rootItems: [
          { id: "inspect", title: "Inspect scene", status: "completed" },
          { id: "camera", title: "Correct camera", status: "in_progress" },
          { id: "verify", title: "Verify result", status: "pending" }
        ]
      }, { runId: "run-0", now: 2 }).goal;
      goal = recordGoalWorkingState(goal, {
        modifiedFiles: ["src/camera.js"],
        fileFingerprints: [{ path: "src/camera.js", hash: "hash-1", updatedAt: 2 }],
        nextRecommendedAction: "Correct camera",
        lastRunId: "run-0"
      }, { now: 3 }).goal;

      const conversation = {
        id: "conversation-1",
        mode: "coding",
        workspaceId: "workspace-1",
        goal,
        messages: [
          { id: "user-0", role: "user", content: goal.objective },
          assistantCheckpoint({
            goal,
            runId: "run-0",
            messageId: "assistant-0",
            taskId: "task-black-hole"
          })
        ]
      };
      const platformIds = new Set();
      const feedback = [
        "摄像机还是太近",
        "现在测试通过了，但视觉角度不正确",
        "把吸积盘倾角再降低一些",
        "这是最新截图，光晕仍然太亮",
        "继续修复最后的视觉问题"
      ];

      for (let index = 0; index < feedback.length; index += 1) {
        const continuation = resolveCheckpointContinuation({
          conversation,
          message: feedback[index]
        });
        const state = createCheckpointContinuationState(continuation);
        assert.ok(state);
        assert.equal(state.goalId, goal.id);
        assert.equal(state.taskId, "task-black-hole");
        assert.equal(state.initialPlanState.rootPlanId, rootPlanId);
        assert.equal(
          state.initialPlanState.rootItems.find((item) => item.id === "inspect").status,
          "completed"
        );
        assert.deepEqual(state.workingState.modifiedFiles, ["src/camera.js"]);

        const ensured = kernel.ensureRun({
          conversationId: conversation.id,
          goalId: goal.id,
          goalRevision: goal.revision,
          objective: goal.objective,
          criteria: goal.criteria,
          workspaceId: conversation.workspaceId,
          mode: conversation.mode
        });
        assert.equal(ensured.ok, true);
        platformIds.add(ensured.run.id);

        conversation.messages.push({
          id: `user-${index + 1}`,
          role: "user",
          content: feedback[index]
        });
        conversation.messages.push(assistantCheckpoint({
          goal,
          runId: `run-${index + 1}`,
          messageId: `assistant-${index + 1}`,
          taskId: "task-black-hole"
        }));
      }

      assert.deepEqual([...platformIds], ["platform-run-1"]);
      assert.equal(conversation.goal.planAuthority.rootPlanId, rootPlanId);
    } finally {
      fs.rmSync(storage, { recursive: true, force: true });
    }
  });
});
