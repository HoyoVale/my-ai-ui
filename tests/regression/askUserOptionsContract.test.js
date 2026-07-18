import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";
import fs from "node:fs";

import {
  sanitizeMessage
} from "../../electron/conversation/conversationSchema.js";

function read(relativePath) {
  return fs.readFileSync(
    new URL(relativePath, import.meta.url),
    "utf8"
  );
}

describe("ask_user option UI", () => {
  it("renders selectable options and resumes through a dedicated question IPC", () => {
    const list = read(
      "../../src/Conversation/components/MessageList.jsx"
    );
    const conversation = read(
      "../../src/Conversation/Conversation.jsx"
    );

    assert.match(list, /conversation-question-options/u);
    assert.match(list, /selectionMode/u);
    assert.match(list, /conversation-question-actions/u);
    assert.match(conversation, /answerAgentQuestion/u);
    assert.doesNotMatch(conversation, /sendAgentMessage/u);
  });

  it("preserves selection mode and other-answer behavior in stored messages", () => {
    const message = sanitizeMessage(
      {
        id: "assistant-1",
        role: "assistant",
        content: "Choose",
        createdAt: 1,
        pendingQuestion: {
          question: "Choose tools",
          options: [
            {
              id: "a",
              label: "A"
            },
            {
              id: "b",
              label: "B"
            }
          ],
          selectionMode: "multiple",
          allowOther: false,
          status: "waiting"
        }
      },
      1,
      "fallback"
    );

    assert.equal(
      message.pendingQuestion.selectionMode,
      "multiple"
    );
    assert.equal(
      message.pendingQuestion.allowOther,
      false
    );
  });
});
