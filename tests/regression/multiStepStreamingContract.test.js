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

describe("multi-step assistant streaming", () => {
  it("separates live step text from the final answer at step boundaries", () => {
    const runtime = read(
      "../../electron/agent/AgentRuntime.js"
    );

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
    const source = read(
      "../../src/Conversation/components/MessageList.jsx"
    );

    assert.match(source, /liveStepText/u);
    assert.match(source, /conversation-live-step-text/u);
    assert.match(source, /activity\.finalText/u);
  });

  it("resumes ask_user inside the original assistant message and run", () => {
    const runtime = read(
      "../../electron/agent/AgentRuntime.js"
    );

    const resumeStart = runtime.indexOf("resumeQuestion({");
    const resumeEnd = runtime.indexOf("\n  stop() {", resumeStart);
    const resumeSource = runtime.slice(resumeStart, resumeEnd);

    assert.doesNotMatch(resumeSource, /startMessage\(/u);
    assert.doesNotMatch(resumeSource, /appendMessage\(/u);
    assert.match(resumeSource, /replaceMessageId:[\s\S]*normalizedMessageId/u);
    assert.match(resumeSource, /pending\.activity\?\.runId/u);
    assert.match(resumeSource, /resumedInPlace: true/u);
  });
});
