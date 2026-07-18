import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  LongTaskOrchestrator
} from "../../electron/agent/orchestration/LongTaskOrchestrator.js";
import {
  RUN_STOP_REASONS
} from "../../electron/agent/runStopReasons.js";

function activePlan() {
  return [
    { id: "inspect", title: "Inspect", status: "in_progress" },
    { id: "summarize", title: "Summarize", status: "pending" }
  ];
}

describe("LongTaskOrchestrator", () => {
  it("models Goal -> Task -> Segment -> Step -> Tool Call and continues", () => {
    const orchestrator = new LongTaskOrchestrator({
      goalId: "goal-1",
      taskId: "task-1",
      runId: "run-1",
      objective: "Inspect and summarize",
      maxSegmentSteps: 2,
      maxSegments: 3,
      maxNoProgressSegments: 2
    });
    const first = orchestrator.beginSegment({ plan: activePlan() });

    orchestrator.recordStep({
      stepNumber: 0,
      finishReason: "tool-calls",
      toolCalls: [{ toolCallId: "call-1", toolName: "read_text_file" }]
    });

    const firstOutcome = orchestrator.completeSegment({
      stopReason: RUN_STOP_REASONS.AGENT_STEP_LIMIT,
      finishReason: "tool-calls",
      plan: activePlan(),
      records: [{
        id: "call-1",
        name: "read_text_file",
        status: "completed",
        segmentId: first.id,
        input: { path: "README.md" },
        result: { summary: "Read README" }
      }]
    });

    assert.equal(firstOutcome.decision, "continue");
    assert.equal(firstOutcome.madeProgress, true);

    const second = orchestrator.beginSegment({
      plan: activePlan(),
      records: [{
        name: "read_text_file",
        status: "completed",
        input: { path: "README.md" },
        result: { summary: "Read README" }
      }]
    });
    orchestrator.recordStep({ stepNumber: 0, finishReason: "stop" });

    const completedPlan = [
      { id: "inspect", title: "Inspect", status: "completed" },
      { id: "summarize", title: "Summarize", status: "completed" }
    ];
    const secondOutcome = orchestrator.completeSegment({
      stopReason: RUN_STOP_REASONS.COMPLETED,
      finishReason: "stop",
      plan: completedPlan,
      finalText: "Done"
    });
    const snapshot = secondOutcome.snapshot;

    assert.deepEqual(snapshot.goal.taskIds, ["task-1"]);
    assert.deepEqual(snapshot.task.segmentIds, [first.id, second.id]);
    assert.equal(secondOutcome.decision, "complete");
    assert.equal(snapshot.goal.id, "goal-1");
    assert.equal(snapshot.goal.status, "completed");
    assert.equal(snapshot.task.id, "task-1");
    assert.equal(snapshot.segmentCount, 2);
    assert.equal(snapshot.segments[0].toolCallIds[0], "call-1");
    assert.equal(snapshot.segments[1].id, second.id);
    assert.equal(snapshot.segments[0].steps[0].toolCalls[0].name, "read_text_file");
  });

  it("stops after consecutive segments make no semantic progress", () => {
    const orchestrator = new LongTaskOrchestrator({
      taskId: "task",
      runId: "run",
      maxSegments: 5,
      maxNoProgressSegments: 2
    });

    orchestrator.beginSegment({ plan: activePlan() });
    const first = orchestrator.completeSegment({
      stopReason: RUN_STOP_REASONS.PLAN_INCOMPLETE,
      plan: activePlan()
    });
    assert.equal(first.decision, "continue");
    assert.equal(first.noProgressSegments, 1);

    orchestrator.beginSegment({ plan: activePlan() });
    const second = orchestrator.completeSegment({
      stopReason: RUN_STOP_REASONS.PLAN_INCOMPLETE,
      plan: activePlan()
    });

    assert.equal(second.decision, "stop");
    assert.equal(second.stopReason, RUN_STOP_REASONS.NO_PROGRESS);
    assert.equal(second.snapshot.task.status, "failed");
  });

  it("uses needs_input as a terminal state without an ask tool", () => {
    const orchestrator = new LongTaskOrchestrator({
      taskId: "task",
      runId: "run"
    });
    orchestrator.beginSegment({ plan: activePlan() });

    const outcome = orchestrator.completeSegment({
      stopReason: RUN_STOP_REASONS.PLAN_INCOMPLETE,
      plan: [{
        id: "inspect",
        title: "Inspect file",
        status: "needs_input",
        reason: "File path is missing"
      }]
    });

    assert.equal(outcome.decision, "stop");
    assert.equal(outcome.stopReason, RUN_STOP_REASONS.NEEDS_INPUT);
    assert.equal(outcome.snapshot.goal.status, "needs_input");
  });

  it("keeps an absolute total segment bound", () => {
    const orchestrator = new LongTaskOrchestrator({
      taskId: "task",
      runId: "run",
      maxSegments: 1,
      maxNoProgressSegments: 3
    });
    const segment = orchestrator.beginSegment({ plan: activePlan() });

    const outcome = orchestrator.completeSegment({
      stopReason: RUN_STOP_REASONS.AGENT_STEP_LIMIT,
      plan: activePlan(),
      records: [{
        id: "new-result",
        name: "calculator",
        status: "completed",
        segmentId: segment.id,
        input: { expression: "2+2" },
        result: { summary: "4" }
      }]
    });

    assert.equal(outcome.decision, "stop");
    assert.equal(outcome.stopReason, RUN_STOP_REASONS.AGENT_SEGMENT_LIMIT);
  });

  it("terminates an active segment consistently on cancellation", () => {
    const orchestrator = new LongTaskOrchestrator({
      goalId: "goal",
      taskId: "task",
      runId: "run"
    });
    orchestrator.beginSegment({ plan: activePlan() });

    const snapshot = orchestrator.terminate(
      RUN_STOP_REASONS.CANCELLED_BY_USER
    );

    assert.equal(snapshot.goal.status, "cancelled");
    assert.equal(snapshot.task.status, "cancelled");
    assert.equal(snapshot.currentSegmentId, "");
    assert.equal(snapshot.segments[0].status, "cancelled");
  });
});
