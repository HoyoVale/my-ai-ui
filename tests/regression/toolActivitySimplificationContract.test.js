import {
  readConversationMessageChromeSource,
  readConversationMessageSource
} from "../helpers/conversationUiSource.js";

import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

describe("compact thinking activity", () => {
  it("keeps redundant tool details out of the chat message chrome", () => {
    const source = readConversationMessageChromeSource();

    assert.doesNotMatch(source, /查看完整任务/u);
    assert.doesNotMatch(source, /resultSummary/u);
    assert.doesNotMatch(source, /describeToolTarget/u);
    assert.doesNotMatch(source, /message\.pendingQuestion[\s\S]*等待回复/u);
  });

  it("allows bounded tool summaries inside the dedicated tool card model", () => {
    const source = readConversationMessageSource();

    assert.match(source, /createToolActivityView/u);
    assert.match(source, /resultSummary/u);
    assert.match(source, /describeToolTarget/u);
  });

  it("does not expose retired question or reasoning events in the normal timeline", () => {
    const source = readConversationMessageSource();

    assert.doesNotMatch(source, /PendingQuestionCard|reasoningSummary|reasoningText/u);
    assert.match(source, /event\.type === "batch"|event\.type === "plan"/u);
  });
});
