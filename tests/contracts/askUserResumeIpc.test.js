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

describe("ask_user resume IPC", () => {
  it("uses a dedicated channel exposed by preload", () => {
    const channels = read(
      "../../electron/shared/ipcChannels.cjs"
    );
    const preload = read(
      "../../electron/preload/preload.cjs"
    );

    assert.match(channels, /RESUME_QUESTION/u);
    assert.match(channels, /agent-resume-question/u);
    assert.match(preload, /answerAgentQuestion/u);
    assert.match(preload, /AGENT_RESUME_QUESTION/u);
  });

  it("allows only the Conversation window to resume a question", () => {
    const handler = read(
      "../../electron/ipc/handlers/agentIpc.js"
    );
    const windowSource = read(
      "../../electron/windows/conversation/conversationWindow.js"
    );

    assert.match(handler, /requireConversationSender/u);
    assert.match(handler, /\.resumeQuestion\(response\)/u);
    assert.match(windowSource, /isConversationSender/u);
  });

  it("validates the original conversation, message and option ids", () => {
    const runtime = read(
      "../../electron/agent/AgentRuntime.js"
    );

    assert.match(runtime, /resumeQuestion\(/u);
    assert.match(runtime, /expectedConversationId/u);
    assert.match(runtime, /expectedPendingMessageId/u);
    assert.match(runtime, /invalid-answer-option/u);
    assert.match(runtime, /question-expired/u);
  });
});
