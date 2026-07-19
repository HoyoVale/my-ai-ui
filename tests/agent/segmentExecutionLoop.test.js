import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  SegmentExecutionLoop
} from "../../electron/agent/orchestration/SegmentExecutionLoop.js";

import {
  LongTaskOrchestrator
} from "../../electron/agent/orchestration/LongTaskOrchestrator.js";

import {
  RUN_STOP_REASONS
} from "../../electron/agent/runStopReasons.js";

function createOrchestrator(overrides = {}) {
  return new LongTaskOrchestrator({
    goalId: "goal-1",
    taskId: "task-1",
    runId: "run-1",
    objective: "Test the segment loop",
    maxSegments: 3,
    maxNoProgressSegments: 2,
    ...overrides
  });
}

describe("SegmentExecutionLoop", () => {
  it("continues unfinished work and returns one terminal segment outcome", async () => {
    const orchestrator = createOrchestrator();
    const signal = new AbortController().signal;
    let plan = [{
      id: "step-1",
      title: "Do work",
      status: "pending"
    }];
    let calls = 0;
    const started = [];

    const loop = new SegmentExecutionLoop({
      orchestrator,
      runDeadline: Date.now() + 10000,
      signal
    });
    const result = await loop.run({
      getPlan: () => plan,
      getRecords: () => [],
      executeSegment: async () => {
        calls += 1;

        if (calls === 1) {
          return {
            plan,
            records: [],
            finishReason: "tool-calls",
            executionStopReason:
              RUN_STOP_REASONS.AGENT_STEP_LIMIT,
            finalText: ""
          };
        }

        plan = [{
          ...plan[0],
          status: "completed"
        }];
        return {
          plan,
          records: [],
          finishReason: "stop",
          executionStopReason:
            RUN_STOP_REASONS.COMPLETED,
          finalText: "Done"
        };
      },
      onSegmentStart: ({ segment }) => {
        started.push(segment.id);
      }
    });

    assert.equal(calls, 2);
    assert.equal(started.length, 2);
    assert.equal(result.decision, "complete");
    assert.equal(
      result.stopReason,
      RUN_STOP_REASONS.COMPLETED
    );
    assert.equal(orchestrator.snapshot().segmentCount, 2);
  });

  it("returns a timeout boundary before opening another segment", async () => {
    const orchestrator = createOrchestrator();
    const loop = new SegmentExecutionLoop({
      orchestrator,
      runDeadline: 99,
      signal: new AbortController().signal,
      now: () => 100
    });

    const result = await loop.run({
      getPlan: () => [],
      getRecords: () => [],
      executeSegment: async () => {
        throw new Error("should not execute");
      }
    });

    assert.equal(result.decision, "checkpoint");
    assert.equal(result.source, "run_timeout");
    assert.equal(
      result.stopReason,
      RUN_STOP_REASONS.AGENT_RUN_TIMEOUT
    );
    assert.equal(orchestrator.snapshot().segmentCount, 0);
  });

  it("turns an exhausted segment budget into a resumable boundary", async () => {
    const orchestrator = createOrchestrator({
      maxSegments: 1
    });
    const plan = [{
      id: "step-1",
      title: "Still running",
      status: "pending"
    }];
    const loop = new SegmentExecutionLoop({
      orchestrator,
      runDeadline: Date.now() + 10000,
      signal: new AbortController().signal
    });

    const result = await loop.run({
      getPlan: () => plan,
      getRecords: () => [],
      executeSegment: async () => ({
        plan,
        records: [],
        finishReason: "tool-calls",
        executionStopReason:
          RUN_STOP_REASONS.AGENT_STEP_LIMIT,
        finalText: ""
      })
    });

    assert.equal(result.decision, "checkpoint");
    assert.equal(
      result.stopReason,
      RUN_STOP_REASONS.AGENT_SEGMENT_LIMIT
    );
    assert.equal(
      result.snapshot.task.status,
      "continuable"
    );
  });
});
