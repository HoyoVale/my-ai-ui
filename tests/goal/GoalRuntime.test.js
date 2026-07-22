import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  applyGoalVerification,
  beginGoalRun,
  completeGoal,
  finishGoalRun,
  GOAL_PHASES,
  heartbeatGoal,
  recordGoalCheckpoint,
  recoverInterruptedGoal,
  sanitizeGoal,
  transitionGoal,
  upsertGoal
} from "../../electron/goal/GoalRuntime.js";

function createGoal(overrides = {}) {
  return upsertGoal(
    null,
    {
      objective: "稳定完成长时间任务",
      criteria: [
        { id: "tests", text: "npm test 全部通过" },
        { id: "review", text: "用户确认结果可用", verificationKind: "manual" }
      ],
      ...overrides
    },
    {
      now: 100,
      createId: () => "goal-1"
    }
  ).goal;
}

describe("GoalRuntime", () => {
  it("creates a versioned lifecycle object with progress and audit history", () => {
    const goal = createGoal();

    assert.equal(goal.version, 4);
    assert.equal(goal.phase, GOAL_PHASES.IDLE);
    assert.equal(goal.runtimeRevision, 1);
    assert.equal(goal.runtime.attempt, 0);
    assert.deepEqual(goal.progress, {
      passed: 0,
      total: 2,
      ratio: 0,
      updatedAt: 100
    });
    assert.equal(goal.eventHistory.at(-1).type, "goal_created");
  });

  it("tracks run start, execution, evaluation, replanning and checkpoint state", () => {
    let goal = createGoal();

    const started = beginGoalRun(goal, {
      runId: "run-1",
      taskId: "task-1",
      platformRunId: "platform-1",
      now: 110
    });
    assert.equal(started.ok, true);
    goal = started.goal;
    assert.equal(goal.phase, GOAL_PHASES.PLANNING);
    assert.equal(goal.runtime.activeRunId, "run-1");
    assert.equal(goal.runtime.attempt, 1);

    goal = heartbeatGoal(goal, {
      runId: "run-1",
      phase: GOAL_PHASES.EXECUTING,
      now: 120
    }).goal;
    assert.equal(goal.phase, GOAL_PHASES.EXECUTING);
    assert.equal(goal.runtime.lastHeartbeatAt, 120);

    goal = heartbeatGoal(goal, {
      runId: "run-1",
      phase: GOAL_PHASES.EVALUATING,
      now: 130
    }).goal;
    assert.equal(goal.phase, GOAL_PHASES.EVALUATING);

    const checkpointed = recordGoalCheckpoint(goal, {
      id: "checkpoint-1",
      runId: "run-1",
      taskId: "task-1",
      messageId: "message-1",
      segmentId: "segment-1",
      phase: "evaluating",
      outcome: "running",
      resumable: true,
      publicStatus: "已完成第一阶段",
      continuationCount: 1,
      updatedAt: 135
    }, { now: 135 });
    goal = checkpointed.goal;
    assert.equal(goal.checkpoint.id, "checkpoint-1");
    assert.equal(goal.checkpoint.summary, "已完成第一阶段");
    assert.equal(goal.runtime.continuationCount, 1);

    goal = transitionGoal(goal, {
      phase: GOAL_PHASES.REPLANNING,
      reason: "missing-verification",
      runId: "run-1",
      now: 140
    }).goal;
    assert.equal(goal.phase, GOAL_PHASES.REPLANNING);

    goal = finishGoalRun(goal, {
      runId: "run-1",
      outcome: "continuable",
      stopReason: "segment_limit",
      now: 150
    }).goal;
    assert.equal(goal.phase, GOAL_PHASES.WAITING);
    assert.equal(goal.waiting.kind, "checkpoint");
    assert.equal(goal.waiting.requiredAction, "continue_goal");
    assert.equal(goal.runtime.activeRunId, null);
    assert.equal(goal.runtime.resumable, true);
  });

  it("rejects invalid transitions and stale run heartbeats", () => {
    let goal = createGoal();
    goal = beginGoalRun(goal, {
      runId: "run-current",
      now: 110
    }).goal;

    const stale = heartbeatGoal(goal, {
      runId: "run-stale",
      phase: GOAL_PHASES.EXECUTING,
      now: 120
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.code, "goal-run-changed");

    const invalid = transitionGoal(goal, {
      phase: GOAL_PHASES.IDLE,
      now: 120
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.code, "goal-transition-invalid");

    const bypassCompletion = transitionGoal(goal, {
      phase: GOAL_PHASES.COMPLETED,
      now: 120
    });
    assert.equal(bypassCompletion.ok, false);
    assert.equal(bypassCompletion.code, "goal-completion-verification-required");
  });

  it("recovers a persisted in-flight Goal after application restart", () => {
    let goal = createGoal();
    goal = beginGoalRun(goal, {
      runId: "run-crashed",
      taskId: "task-crashed",
      now: 110
    }).goal;
    goal = heartbeatGoal(goal, {
      runId: "run-crashed",
      phase: GOAL_PHASES.EXECUTING,
      now: 120
    }).goal;
    goal = recordGoalCheckpoint(goal, {
      id: "checkpoint-crashed",
      runId: "run-crashed",
      taskId: "task-crashed",
      messageId: "message-crashed",
      phase: "executing",
      resumable: true,
      updatedAt: 125
    }, { now: 125 }).goal;

    const recovered = recoverInterruptedGoal(goal, { now: 200 });
    assert.equal(recovered.changed, true);
    assert.equal(recovered.goal.phase, GOAL_PHASES.WAITING);
    assert.equal(recovered.goal.waiting.kind, "recovery");
    assert.equal(recovered.goal.waiting.requiredAction, "resume_from_checkpoint");
    assert.equal(recovered.goal.runtime.activeRunId, null);
    assert.equal(recovered.goal.runtime.lastRunId, "run-crashed");
    assert.equal(recovered.goal.eventHistory.at(-1).type, "goal_recovered");
  });

  it("clears the active run when a running Goal is paused and keeps it resumable", () => {
    const created = upsertGoal(null, {
      objective: "Pause a long-running Goal safely"
    }, {
      now: 1,
      createId: () => "goal-pause"
    });
    const running = beginGoalRun(created.goal, {
      runId: "run-pause",
      taskId: "task-pause",
      now: 2
    });

    const paused = upsertGoal(running.goal, {
      objective: running.goal.objective,
      status: "paused",
      criteria: running.goal.criteria
    }, {
      now: 3,
      createId: () => "unused"
    });

    assert.equal(paused.goal.status, "paused");
    assert.equal(paused.goal.phase, GOAL_PHASES.WAITING);
    assert.equal(paused.goal.runtime.activeRunId, null);
    assert.equal(paused.goal.runtime.lastRunId, "run-pause");
    assert.equal(paused.goal.runtime.resumable, true);
    assert.equal(paused.goal.waiting.kind, "user_paused");
  });

  it("requires verified evidence before terminal completion", () => {
    let goal = createGoal();
    goal = beginGoalRun(goal, {
      runId: "run-1",
      now: 110
    }).goal;
    goal = applyGoalVerification(goal, {
      version: 3,
      status: "verified",
      verified: true,
      checks: [
        {
          criterionId: "tests",
          verificationKind: "test",
          passed: true,
          detail: "tests passed",
          evidence: ["receipt:test"]
        },
        {
          criterionId: "review",
          verificationKind: "manual",
          passed: true,
          detail: "user confirmed",
          evidence: ["user-confirmed"]
        }
      ]
    }, { now: 120 }).goal;

    const missingPermit = completeGoal(goal, {
      verification: {
        version: 3,
        status: "verified",
        verified: true,
        checks: []
      },
      now: 129
    });
    assert.equal(missingPermit.ok, false);
    assert.equal(
      missingPermit.code,
      "goal-completion-fingerprint-required"
    );

    const completed = completeGoal(goal, {
      verification: {
        version: 3,
        status: "verified",
        verified: true,
        checks: []
      },
      completionFingerprint: "permit:platform-1",
      now: 130
    });
    assert.equal(completed.ok, true);
    assert.equal(completed.goal.status, "completed");
    assert.equal(completed.goal.phase, GOAL_PHASES.COMPLETED);
    assert.equal(completed.goal.runtime.resumable, false);
    assert.equal(completed.goal.eventHistory.at(-1).type, "goal_completed");
  });

  it("bounds lifecycle history and deduplicates repeated checkpoint ids", () => {
    let goal = createGoal();
    for (let index = 0; index < 60; index += 1) {
      const phase = index % 2 === 0
        ? GOAL_PHASES.WAITING
        : GOAL_PHASES.IDLE;
      goal = transitionGoal(goal, {
        phase,
        reason: `transition-${index}`,
        waiting: phase === GOAL_PHASES.WAITING
          ? { kind: "checkpoint" }
          : undefined,
        now: 200 + index,
        force: true
      }).goal;
    }
    assert.equal(goal.eventHistory.length, 48);

    const first = recordGoalCheckpoint(goal, {
      id: "same-checkpoint",
      runId: "run-1",
      phase: "waiting",
      resumable: true
    }, { now: 300 });
    const firstCount = first.goal.eventHistory.length;
    const repeated = recordGoalCheckpoint(first.goal, {
      id: "same-checkpoint",
      runId: "run-1",
      phase: "waiting",
      resumable: true
    }, { now: 301 });
    assert.equal(repeated.changed, false);
    assert.equal(repeated.goal.eventHistory.length, firstCount);
  });

  it("migrates legacy version 3 Goal data without losing verification", () => {
    const goal = sanitizeGoal({
      version: 3,
      id: "legacy-goal",
      revision: 2,
      objective: "迁移旧 Goal",
      status: "paused",
      criteria: [{
        id: "tests",
        text: "测试通过",
        verificationKind: "test",
        status: "passed",
        evidence: ["receipt:test"],
        verifiedAt: 20
      }],
      createdAt: 10,
      updatedAt: 20,
      lastVerification: {
        status: "verified",
        verified: true,
        checkedAt: 20
      }
    });

    assert.equal(goal.version, 4);
    assert.equal(goal.phase, GOAL_PHASES.WAITING);
    assert.equal(goal.waiting.kind, "user_paused");
    assert.equal(goal.criteria[0].status, "passed");
    assert.deepEqual(goal.criteria[0].evidence, ["receipt:test"]);
    assert.equal(goal.progress.passed, 1);
  });
});
