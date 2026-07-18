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

describe("finalization and retired ask_user compatibility", () => {
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

  it("does not register ask_user while retaining legacy question recovery", () => {
    const runtime = read("../../electron/agent/AgentRuntime.js");
    const tools = read(
      "../../electron/agent/orchestration/agentTools.js"
    );
    const catalog = read("../../electron/tools/toolCatalog.js");

    assert.match(
      runtime,
      /getPendingQuestion\(/u
    );
    assert.doesNotMatch(tools, /name:\s*"ask_user"/u);
    assert.doesNotMatch(catalog, /name:\s*"ask_user"/u);
  });
});
