import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AgentRunSession
} from "../../electron/agent/AgentRunSession.js";
import {
  createCoreLiteCheckpointInstruction,
  createCoreLiteRunCheckpoint
} from "../../electron/agent/CoreLiteCheckpoint.js";
import {
  createCoreLiteContinuationState,
  resolveCoreLiteCheckpointContinuation
} from "../../electron/agent/CoreLiteCheckpointResume.js";
import {
  CoreLiteRunLoop
} from "../../electron/agent/execution/CoreLiteRunLoop.js";
import {
  RUN_STOP_REASONS
} from "../../electron/agent/runStopReasons.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const source = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

function createSession(overrides = {}) {
  return new AgentRunSession({
    runId: "run-1",
    taskId: "task-1",
    conversationId: "conversation-1",
    objective: "检查并修复项目",
    abortController: new AbortController(),
    activityStore: null,
    diffTracker: null,
    tokenLedger: null,
    ...overrides
  });
}

test("Core Lite 2 uses a small AgentRunSession without advanced state", () => {
  const session = createSession();

  assert.equal(session.kind, "core-lite");
  assert.equal(session.currentSegmentId, "run:run-1");
  assert.equal(session.phase, "executing");
  assert.equal(session.objective, "检查并修复项目");

  for (const key of [
    "goalId",
    "persistentGoalId",
    "goalSpec",
    "orchestrator",
    "executionThreadId",
    "platformRunId",
    "initialPlan",
    "initialPlanState",
    "workingState"
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(session, key),
      false,
      `${key} should not exist on AgentRunSession`
    );
  }

  assert.deepEqual(session.snapshot(), {
    kind: "core-lite",
    version: 1,
    runId: "run-1",
    taskId: "task-1",
    conversationId: "conversation-1",
    parentRunId: "",
    resumedFromMessageId: "",
    continuationCount: 0,
    startedAt: session.startedAt,
    mode: "chat",
    workspaceId: null,
    currentSegmentId: "run:run-1",
    stepNumber: 0,
    phase: "executing",
    outcome: "running",
    stopReason: null,
    resumable: false,
    publicStatus: "running"
  });
});

test("Core Lite 2 checkpoint stores receipts without Goal Plan or Thread state", () => {
  const checkpoint = createCoreLiteRunCheckpoint({
    taskId: "task-1",
    runId: "run-1",
    objective: "修复输入框",
    continuationCount: 1,
    records: [
      {
        id: "tool-1",
        name: "read_text_file",
        title: "读取 App.jsx",
        status: "completed",
        result: {
          summary: "已读取",
          reference: { resultId: "result-1" }
        }
      }
    ],
    toolRuntime: {
      version: 1,
      totalCalls: 1,
      receiptCount: 1,
      unresolvedCount: 0,
      calls: [
        {
          callId: "tool-1",
          toolName: "read_text_file",
          state: "completed",
          recovery: "confirmed",
          effect: "read",
          hasReceipt: true,
          receiptId: "receipt-1"
        }
      ]
    }
  });

  assert.equal(checkpoint.runtimeFlavor, "core-lite");
  assert.equal(checkpoint.counts.tools, 1);
  assert.equal(checkpoint.counts.completedTools, 1);
  assert.deepEqual(checkpoint.reportedReceiptIds, ["receipt-1"]);

  for (const key of [
    "goalId",
    "executionThreadId",
    "plan",
    "planState",
    "orchestration",
    "workingState"
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(checkpoint, key),
      false,
      `${key} should not be persisted by Core Lite`
    );
  }

  const instruction = createCoreLiteCheckpointInstruction(checkpoint);
  assert.match(instruction, /Recent tool results/u);
  assert.match(instruction, /读取 App\.jsx/u);
  assert.doesNotMatch(instruction, /Root task plan|Goal completion/u);
});

test("Core Lite 2 continuation only restores core task bindings", () => {
  const continuation = resolveCoreLiteCheckpointContinuation({
    message: "继续完成剩余部分",
    conversation: {
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          activity: {
            status: "checkpoint_ready",
            checkpoint: {
              runtimeFlavor: "core-lite",
              taskId: "task-1",
              runId: "run-1",
              objective: "完成 Core Lite 2",
              stopReason: RUN_STOP_REASONS.AGENT_STEP_LIMIT,
              resumable: true,
              continuationCount: 2,
              counts: { contextCompactions: 1 }
            }
          }
        }
      ]
    }
  });

  assert.ok(continuation);
  const state = createCoreLiteContinuationState(continuation);
  assert.equal(state.taskId, "task-1");
  assert.equal(state.parentRunId, "run-1");
  assert.equal(state.continuationCount, 3);
  assert.equal(state.contextCompactionCount, 1);

  for (const key of [
    "goalId",
    "executionThreadId",
    "initialPlan",
    "initialPlanState",
    "workingState"
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(state, key),
      false
    );
  }
});

test("Core Lite 2 run loop executes one segment and preserves boundaries", async () => {
  const started = [];
  const completed = [];
  const loop = new CoreLiteRunLoop({
    runId: "run-1",
    objective: "修复项目",
    runDeadline: 10_000,
    now: () => 1_000
  });

  const result = await loop.run({
    executeSegment: async ({ segment, remainingRunMs }) => {
      assert.equal(segment.id, "run:run-1");
      assert.equal(remainingRunMs, 9_000);
      return {
        records: [{ id: "tool-1", status: "completed" }],
        executionStopReason: RUN_STOP_REASONS.COMPLETED
      };
    },
    createCheckpoint: ({ records }) => ({
      runtimeFlavor: "core-lite",
      tools: records
    }),
    onSegmentStart: ({ segment }) => started.push(segment.id),
    onSegmentComplete: ({ segment }) => completed.push(segment.id)
  });

  assert.equal(result.decision, "complete");
  assert.equal(result.source, "core_lite");
  assert.deepEqual(started, ["run:run-1"]);
  assert.deepEqual(completed, ["run:run-1"]);
  assert.equal(result.records.length, 1);
});

test("Core Lite 2 run loop distinguishes cancellation and timeout", async () => {
  const controller = new AbortController();
  controller.abort();
  const cancelled = await new CoreLiteRunLoop({
    runId: "run-cancelled",
    runDeadline: 10_000,
    now: () => 1_000,
    signal: controller.signal
  }).run({
    executeSegment: async () => {
      throw new Error("cancelled run must not execute");
    }
  });

  assert.equal(cancelled.decision, "cancelled");
  assert.equal(
    cancelled.stopReason,
    RUN_STOP_REASONS.CANCELLED_BY_USER
  );

  const timedOut = await new CoreLiteRunLoop({
    runId: "run-timeout",
    runDeadline: 500,
    now: () => 1_000
  }).run({
    executeSegment: async () => {
      throw new Error("timed out run must not execute");
    }
  });

  assert.equal(timedOut.decision, "checkpoint");
  assert.equal(
    timedOut.stopReason,
    RUN_STOP_REASONS.AGENT_RUN_TIMEOUT
  );
});

test("Core Lite 2 production path cannot reach advanced orchestration", () => {
  const runtime = source("electron/agent/AgentRuntime.js");
  const preparation = source(
    "electron/agent/preparation/AgentRunPreparation.js"
  );
  const execution = source(
    "electron/agent/execution/AgentRunExecution.js"
  );
  const persistence = source(
    "electron/agent/persistence/AgentRunPersistence.js"
  );
  const finalization = source(
    "electron/agent/finalization/AgentRunFinalization.js"
  );

  assert.match(preparation, /new AgentRunSession/u);
  assert.match(execution, /new CoreLiteRunLoop/u);
  assert.match(persistence, /createCoreLiteRunCheckpoint/u);

  for (const text of [
    runtime,
    preparation,
    execution,
    persistence,
    finalization
  ]) {
    assert.doesNotMatch(
      text,
      /threadRoutingDecisionStore|LongTaskOrchestrator|SegmentExecutionLoop|GoalCompletionVerifier|beginExecutionThread|finishExecutionThread|recordExecutionThreadCheckpoint|platformRunId|persistentGoal/u
    );
  }

  assert.doesNotMatch(
    preparation,
    /execution-model|checkpointResume\.js/u
  );
  assert.doesNotMatch(
    persistence,
    /runCheckpoint\.js|executionThreadId|goalId|planState|orchestration|workingState/u
  );
  assert.doesNotMatch(
    runtime,
    /\.goalId|\.orchestrator|initialPlan|threadRouting/u
  );
});
