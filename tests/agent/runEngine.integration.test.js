import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  RunEngine
} from "../../electron/agent/RunEngine.js";

import {
  RunStateMachine,
  RUN_OUTCOMES
} from "../../electron/agent/RunStateMachine.js";

import {
  LongTaskOrchestrator
} from "../../electron/agent/orchestration/LongTaskOrchestrator.js";

import {
  SegmentExecutionLoop
} from "../../electron/agent/orchestration/SegmentExecutionLoop.js";

import {
  RUN_STOP_REASONS
} from "../../electron/agent/runStopReasons.js";

function createHarness({
  maxSegments = 2
} = {}) {
  const orchestrator = new LongTaskOrchestrator({
    goalId: "goal-1",
    taskId: "task-1",
    runId: "run-1",
    objective: "Finish the task",
    maxSegmentSteps: 2,
    maxSegments,
    maxNoProgressSegments: 2,
    startedAt: 1
  });
  const loop = new SegmentExecutionLoop({
    orchestrator,
    runDeadline: 100000,
    now: () => 100,
    signal: new AbortController().signal
  });

  return {
    orchestrator,
    engine: new RunEngine({
      segmentLoop: loop
    })
  };
}

describe("RunEngine integration", () => {
  it("runs multiple segments, finalizes once and returns one continuable handoff", async () => {
    const { engine } = createHarness({ maxSegments: 2 });
    const stateMachine = new RunStateMachine({ startedAt: 1 });
    const plan = [
      {
        id: "inspect",
        title: "Inspect",
        status: "in_progress"
      }
    ];
    const records = [];
    let segmentNumber = 0;
    let finalText = "";
    let finalizationCalls = 0;

    const result = await engine.run({
      segmentCallbacks: {
        getPlan: () => plan,
        getRecords: () => records,
        createCheckpoint: () => ({
          taskId: "task-1",
          plan
        }),
        executeSegment: ({ segment }) => {
          segmentNumber += 1;
          records.push({
            id: `tool-${segmentNumber}`,
            name: "read_text_file",
            status: "completed",
            segmentId: segment.id,
            result: {
              summary: `Result ${segmentNumber}`
            }
          });

          return {
            plan,
            records,
            finishReason: "tool-calls",
            executionStopReason:
              RUN_STOP_REASONS.AGENT_STEP_LIMIT,
            finalText: "",
            steps: [
              {
                stepNumber: 1,
                finishReason: "tool-calls",
                toolCalls: []
              }
            ]
          };
        }
      },
      getFinalText: () => finalText,
      setFinalText: (value) => {
        finalText = value;
      },
      runFinalization: async ({ executionStopReason }) => {
        finalizationCalls += 1;
        assert.equal(
          executionStopReason,
          RUN_STOP_REASONS.AGENT_SEGMENT_LIMIT
        );
        finalText = "已完成检查，下一步继续修改实现。";
      }
    });

    const state = stateMachine.finalize({
      executionStopReason: result.executionStopReason,
      outcome: result.outcome
    });

    assert.equal(segmentNumber, 2);
    assert.equal(finalizationCalls, 1);
    assert.equal(result.outcome, RUN_OUTCOMES.CONTINUABLE);
    assert.equal(state.activityStatus, "checkpoint_ready");
    assert.equal(state.messageStatus, "complete");
    assert.equal(result.finalText, "已完成检查，下一步继续修改实现。");
  });

  it("keeps a recoverable tool error continuable instead of failing the Goal", async () => {
    const { engine } = createHarness({ maxSegments: 3 });
    const plan = [
      { id: "edit", title: "Apply the remaining edit", status: "in_progress" }
    ];
    const records = [{
      id: "tool-recoverable",
      name: "replace_text_in_file",
      status: "failed",
      result: {
        error: {
          code: "TEXT_NOT_FOUND",
          category: "not_found",
          message: "The file changed after the last read",
          retryable: false
        }
      }
    }];
    let finalText = "";

    const result = await engine.run({
      segmentCallbacks: {
        getPlan: () => plan,
        getRecords: () => records,
        createCheckpoint: () => ({ taskId: "task-1", plan }),
        executeSegment: () => ({
          plan,
          records,
          finishReason: "tool-calls",
          executionStopReason: RUN_STOP_REASONS.TOOL_ERROR,
          finalText: ""
        })
      },
      getFinalText: () => finalText,
      setFinalText: (value) => {
        finalText = value;
      },
      runFinalization: async () => {
        finalText = "已保存当前进展，下一轮将重新读取目标片段后继续修改。";
      }
    });

    assert.equal(result.outcome, RUN_OUTCOMES.CONTINUABLE);
    assert.equal(result.loopResult.decision, "checkpoint");
    assert.equal(result.executionStopReason, RUN_STOP_REASONS.TOOL_ERROR);
    assert.match(result.finalText, /继续修改/u);
  });

  it("uses the deterministic fallback when finalization produces no text", async () => {
    const { engine } = createHarness({ maxSegments: 1 });
    const plan = [
      {
        id: "finish",
        title: "Finish remaining work",
        status: "in_progress"
      }
    ];
    const records = [
      {
        id: "tool-1",
        name: "read_text_file",
        title: "Read file",
        status: "completed",
        result: {
          summary: "Located the runtime entry"
        }
      }
    ];
    let finalText = "";
    const appended = [];

    const result = await engine.run({
      segmentCallbacks: {
        getPlan: () => plan,
        getRecords: () => records,
        executeSegment: () => ({
          plan,
          records,
          finishReason: "tool-calls",
          executionStopReason:
            RUN_STOP_REASONS.TOOL_CALL_LIMIT,
          finalText: ""
        })
      },
      getFinalText: () => finalText,
      setFinalText: (value) => {
        finalText = value;
      },
      appendFinalText: (value) => {
        appended.push(value);
      },
      runFinalization: async () => ({
        ok: false,
        text: ""
      })
    });

    assert.equal(result.outcome, RUN_OUTCOMES.CONTINUABLE);
    assert.match(result.finalText, /下一步建议/u);
    assert.doesNotMatch(result.finalText, /tool_call_limit|Segment/u);
    assert.deepEqual(appended, [result.finalText]);
  });
});
