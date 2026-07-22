import {
  readConversationMessageSource
} from "../helpers/conversationUiSource.js";

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

describe("compact thinking activity", () => {
  it("removes redundant descriptions and task links from chat", () => {
    const source = readConversationMessageSource();

    assert.doesNotMatch(source, /查看完整任务/u);
    assert.doesNotMatch(source, /resultSummary/u);
    assert.doesNotMatch(source, /describeToolTarget/u);
    assert.doesNotMatch(source, /message\.pendingQuestion[\s\S]*等待回复/u);
  });

  it("does not expose retired question or reasoning events in the normal timeline", () => {
    const source = readConversationMessageSource();

    assert.doesNotMatch(source, /PendingQuestionCard|reasoningSummary|reasoningText/u);
    assert.match(source, /event\.type === "batch"|event\.type === "plan"/u);
  });
});
