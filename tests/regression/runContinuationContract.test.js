import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { readAgentRuntimeSource } from "../helpers/agentRuntimeSource.js";

function read(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("Core Lite run continuation contract", () => {
  it("detects a resumable checkpoint before appending the next user message", () => {
    const runtime = readAgentRuntimeSource();
    assert.match(runtime, /resolveCoreLiteCheckpointContinuation/u);
    assert.match(runtime, /createCoreLiteContinuationState/u);
    assert.match(runtime, /continuedTask/u);
    assert.match(runtime, /parentRunId/u);
    assert.match(runtime, /resumedFromMessageId/u);
    assert.doesNotMatch(runtime, /previousSegmentCount|initialPlan/u);
  });

  it("keeps retired Segment language out of the public handoff", () => {
    const runtime = readAgentRuntimeSource();
    const finalization = read("../../electron/agent/finalization.js");
    assert.doesNotMatch(runtime, /已达到任务分段上限/u);
    assert.match(runtime, /当前进展已整理/u);
    assert.match(finalization, /Never mention segments/u);
  });
});
