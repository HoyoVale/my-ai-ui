import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";
import fs from "node:fs";

import {
  readAgentRuntimeSource
} from "../helpers/agentRuntimeSource.js";

function read(relativePath) {
  return fs.readFileSync(
    new URL(relativePath, import.meta.url),
    "utf8"
  );
}

describe("Tool Runtime state-machine refactor contract", () => {
  it("keeps terminal state derivation in RunStateMachine", () => {
    const runtime = readAgentRuntimeSource();
    const stateMachine = read(
      "../../electron/agent/RunStateMachine.js"
    );

    assert.match(runtime, /new RunStateMachine/u);
    assert.match(runtime, /finalizeRun\(/u);
    assert.match(stateMachine, /executionStopReason/u);
    assert.match(stateMachine, /activityStatus/u);
    assert.match(stateMachine, /messageStatus/u);
    assert.match(stateMachine, /resumable/u);
    assert.doesNotMatch(
      runtime,
      /reachedContinuationBoundary[\s\S]{0,240}AGENT_SEGMENT_LIMIT/u
    );
  });

  it("owns the segment while-loop outside AgentRuntime", () => {
    const runtime = readAgentRuntimeSource();
    const loop = read(
      "../../electron/agent/orchestration/SegmentExecutionLoop.js"
    );

    assert.match(runtime, /new SegmentExecutionLoop/u);
    assert.match(runtime, /executeAgentSegment/u);
    assert.doesNotMatch(runtime, /while\s*\(true\)/u);
    assert.match(loop, /while\s*\(this\.canContinue\(\)\)/u);
    assert.match(loop, /orchestrator\.beginSegment/u);
    assert.match(loop, /orchestrator\.completeSegment/u);
  });

  it("routes Activity finalization and active-run cleanup through finalizeRun only", () => {
    const runtime = readAgentRuntimeSource();
    const activityFinalizeCalls =
      runtime.match(/activityStore\?\.finalize\(/gu) ?? [];
    const activeRunCleanup =
      runtime.match(/this\.activeRun\s*=\s*null/gu) ?? [];

    assert.equal(activityFinalizeCalls.length, 1);
    assert.equal(activeRunCleanup.length, 2);
    assert.match(
      runtime,
      /finalizeRun\([\s\S]*activityStore\?\.finalize\([\s\S]*this\.activeRun\s*=\s*null/u
    );
  });
});
