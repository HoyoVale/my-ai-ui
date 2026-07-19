import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";
import fs from "node:fs";

function read(relativePath) {
  return fs.readFileSync(
    new URL(relativePath, import.meta.url),
    "utf8"
  );
}

describe("segment continuation runtime contract", () => {
  it("detects a resumable checkpoint before appending the next user message", () => {
    const runtime = read(
      "../../electron/agent/AgentRuntime.js"
    );

    assert.match(runtime, /resolveCheckpointContinuation/u);
    assert.match(runtime, /createCheckpointContinuationState/u);
    assert.match(runtime, /continuedTask/u);
    assert.match(runtime, /parentRunId/u);
    assert.match(runtime, /previousSegmentCount/u);
    assert.match(runtime, /initialPlan:\s*continuationState/u);
  });

  it("keeps the internal segment reason out of user-facing handoff copy", () => {
    const runtime = read(
      "../../electron/agent/AgentRuntime.js"
    );
    const finalization = read(
      "../../electron/agent/finalization.js"
    );
    const activity = read(
      "../../electron/agent/RunActivityStore.js"
    );

    assert.doesNotMatch(runtime, /已达到任务分段上限/u);
    assert.match(runtime, /当前阶段进展已整理/u);
    assert.match(finalization, /Never mention segments/u);
    assert.match(activity, /当前进展已整理/u);
  });
});
