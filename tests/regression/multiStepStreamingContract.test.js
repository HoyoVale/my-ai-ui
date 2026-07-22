import {
  readConversationMessageSource
} from "../helpers/conversationUiSource.js";

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

describe("multi-step assistant streaming", () => {
  it("separates live step text from the final answer at step boundaries", () => {
    const runtime = readAgentRuntimeSource();

    assert.match(runtime, /currentStepText/u);
    assert.match(runtime, /finalText/u);
    assert.match(runtime, /onStepEnd:[\s\S]*handleStepEnd/u);
    assert.match(runtime, /classifyAgentStep\(step\)/u);
    assert.match(
      runtime,
      /classified\.kind ===[\s\S]*"commentary"[\s\S]*recordCommentary/u
    );
    assert.match(
      runtime,
      /classified\.kind ===[\s\S]*"final"[\s\S]*finalText/u
    );
  });

  it("renders the current model step while tools are still running", () => {
    const source = readConversationMessageSource();

    assert.match(source, /liveStepText/u);
    assert.match(source, /conversation-live-step-text/u);
    assert.match(source, /activity\.finalText/u);
  });

});
