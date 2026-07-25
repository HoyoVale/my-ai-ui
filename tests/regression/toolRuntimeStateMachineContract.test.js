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
  it("keeps terminal state derivation in AgentRunSession and RunStateMachine", () => {
    const runtime = readAgentRuntimeSource();
    const session = read(
      "../../electron/agent/AgentRunSession.js"
    );
    const stateMachine = read(
      "../../electron/agent/RunStateMachine.js"
    );

    assert.match(session, /new RunStateMachine/u);
    assert.match(session, /applyState\(state\)/u);
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

  it("owns the single Core Lite segment outside AgentRuntime", () => {
    const execution = readAgentRuntimeSource("execution");
    const loop = read(
      "../../electron/agent/execution/CoreLiteRunLoop.js"
    );

    assert.match(execution, /new CoreLiteRunLoop/u);
    assert.match(execution, /executeAgentSegment/u);
    assert.doesNotMatch(execution, /while\s*\(true\)/u);
    assert.match(loop, /const segment = \{/u);
    assert.match(loop, /await executeSegment\(/u);
    assert.doesNotMatch(loop, /while\s*\(/u);
    assert.doesNotMatch(loop, /orchestrator/u);
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
