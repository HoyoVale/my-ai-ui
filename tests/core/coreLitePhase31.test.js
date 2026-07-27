import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AgentRunSession
} from "../../electron/agent/AgentRunSession.js";
import {
  CoreLiteRunLoop
} from "../../electron/agent/execution/CoreLiteRunLoop.js";
import {
  RUN_STOP_REASONS
} from "../../electron/agent/runStopReasons.js";
import {
  RUN_OUTCOMES
} from "../../electron/agent/RunStateMachine.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const source = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

function createSession(overrides = {}) {
  return new AgentRunSession({
    runId: "run-31",
    taskId: "task-31",
    conversationId: "conversation-31",
    objective: "收敛 Core Lite 生产执行链",
    abortController: new AbortController(),
    activityStore: null,
    diffTracker: null,
    tokenLedger: null,
    startedAt: 1_000,
    ...overrides
  });
}

test("Core Lite 3.1 loop derives run identity and cancellation from AgentRunSession", async () => {
  const session = createSession();
  const observed = [];
  const loop = new CoreLiteRunLoop({
    session,
    runDeadline: 10_000,
    now: () => 2_000
  });

  const result = await loop.run({
    onRunStart: ({ runUnit, session: activeSession }) => {
      observed.push(runUnit.id);
      assert.equal(activeSession, session);
    },
    executeRun: async ({ runUnit, remainingRunMs, session: activeSession }) => {
      assert.equal(runUnit.objective, session.objective);
      assert.equal(remainingRunMs, 8_000);
      assert.equal(activeSession, session);
      return {
        records: [],
        executionStopReason: RUN_STOP_REASONS.COMPLETED
      };
    }
  });

  assert.deepEqual(observed, ["run:run-31"]);
  assert.equal(result.runUnit.id, "run:run-31");
  assert.equal(result.decision, "complete");

  session.abortController.abort("test-cancel");
  const cancelled = await new CoreLiteRunLoop({
    session,
    runDeadline: 10_000,
    now: () => 2_000
  }).run({
    executeRun: async () => {
      throw new Error("cancelled session must not execute");
    }
  });

  assert.equal(cancelled.decision, "cancelled");
  assert.equal(
    cancelled.stopReason,
    RUN_STOP_REASONS.CANCELLED_BY_USER
  );
});

test("Core Lite 3.1 loop completes execution finalization and outcome without RunEngine", async () => {
  const session = createSession();
  let finalText = "";
  let finalized = 0;
  let appended = "";
  const loop = new CoreLiteRunLoop({
    session,
    runDeadline: 10_000,
    now: () => 2_000,
    finalizationPolicy: () => true,
    fallbackFactory: () => "轻量运行已完成。",
    outcomeResolver: ({ stopReason }) => ({
      outcome: RUN_OUTCOMES.COMPLETED,
      stopReason,
      resumable: false,
      source: "core-lite-test"
    })
  });

  const result = await loop.runToCompletion({
    callbacks: {
      executeRun: async () => ({
        records: [],
        finishReason: "stop",
        executionStopReason: RUN_STOP_REASONS.COMPLETED
      })
    },
    getFinalText: () => finalText,
    setFinalText: (value) => {
      finalText = value;
    },
    appendFinalText: (value) => {
      appended += value;
    },
    runFinalization: async ({ executionStopReason }) => {
      finalized += 1;
      assert.equal(
        executionStopReason,
        RUN_STOP_REASONS.COMPLETED
      );
      return { ok: true };
    }
  });

  assert.equal(finalized, 1);
  assert.equal(appended, "轻量运行已完成。");
  assert.equal(finalText, "轻量运行已完成。");
  assert.equal(result.finalText, "轻量运行已完成。");
  assert.equal(result.outcome, RUN_OUTCOMES.COMPLETED);
  assert.equal(result.cancelled, false);
});

test("Core Lite 3.1 production path passes AgentRunSession directly to LiteRunLoop", () => {
  const preparation = source(
    "electron/agent/preparation/AgentRunPreparation.js"
  );
  const execution = source(
    "electron/agent/execution/AgentRunExecution.js"
  );
  const runtime = source("electron/agent/AgentRuntime.js");

  assert.match(preparation, /session: runtime\.activeRun/u);
  assert.doesNotMatch(
    preparation,
    /runId: runtime\.activeRun\.runId|abortController: runtime\.activeRun\.abortController/u
  );

  assert.match(execution, /resolveRunInvocation/u);
  assert.match(execution, /new CoreLiteRunLoop\(\{[\s\S]*session,/u);
  assert.match(execution, /runLoop\.runToCompletion/u);
  assert.match(execution, /executeRun:[\s\S]*executeModelLoop/u);
  assert.doesNotMatch(execution, /new RunEngine|segmentCallbacks|runEngine\.run/u);
  assert.doesNotMatch(execution, /from "\.\.\/RunEngine\.js"/u);

  assert.match(runtime, /async executeModelLoop\(options\)/u);
  assert.doesNotMatch(runtime, /executeAgentSegment/u);
});

test("Core Lite 3.1 compatibility shells are superseded by Core Lite 3.5 cleanup", () => {
  for (const relativePath of [
    "electron/agent/RunEngine.js",
    "electron/agent/ExecutionThread.js",
    "electron/agent/GoalCompletionVerifier.js",
    "electron/agent/orchestration/LongTaskOrchestrator.js",
    "electron/agent/orchestration/SegmentExecutionLoop.js"
  ]) {
    assert.equal(
      fs.existsSync(path.join(root, relativePath)),
      false,
      `${relativePath} should be physically removed`
    );
  }

  const productionSources = [
    "electron/agent/AgentRuntime.js",
    "electron/agent/preparation/AgentRunPreparation.js",
    "electron/agent/execution/AgentRunExecution.js",
    "electron/agent/finalization/AgentRunFinalization.js",
    "electron/agent/persistence/AgentRunPersistence.js"
  ].map(source).join("\n");

  assert.doesNotMatch(
    productionSources,
    /LongTaskOrchestrator|SegmentExecutionLoop|GoalCompletionVerifier|RunEngine|ExecutionThread|execution-model/u
  );
});
