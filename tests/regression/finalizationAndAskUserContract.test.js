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

describe("finalization and ask_user runtime contract", () => {
  it("runs a separate no-tool finalization phase after ordinary execution", () => {
    const runtime = read(
      "../../electron/agent/AgentRuntime.js"
    );
    const finalization = read(
      "../../electron/agent/finalization.js"
    );

    assert.match(runtime, /runFinalization/u);
    assert.match(runtime, /phase =\s*"finalizing"/u);
    assert.match(runtime, /maxFinalizationAttempts/u);
    assert.match(finalization, /Do not call tools/u);
  });

  it("stops only when a real pending question exists and does not treat every rejected ask_user call as a pause", () => {
    const runtime = read(
      "../../electron/agent/AgentRuntime.js"
    );
    const tools = read(
      "../../electron/tools/agent/agentTools.js"
    );

    assert.match(
      runtime,
      /getPendingQuestion\(\)/u
    );
    assert.doesNotMatch(
      runtime,
      /hasToolCall\(\s*"ask_user"/u
    );
    assert.match(
      tools,
      /ASK_USER_MUST_ADVANCE/u
    );
    assert.match(
      tools,
      /ASK_USER_ALREADY_ANSWERED/u
    );
  });
});
