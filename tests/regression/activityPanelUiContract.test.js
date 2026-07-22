import {
  readConversationTaskPanelSource
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

describe("ChatGPT-inspired activity panel", () => {
  it("uses one activity timeline instead of plan and activity tabs", () => {
    const source = readConversationTaskPanelSource();

    assert.match(source, /conversation-activity-timeline/u);
    assert.match(source, />进度</u);
    assert.doesNotMatch(source, /conversation-task-tabs/u);
    assert.doesNotMatch(source, /conversation-task-overview/u);
  });

  it("keeps raw tool details inside developer mode", () => {
    const source = readConversationTaskPanelSource();

    assert.match(source, /developerMode &&/u);
    assert.match(source, /<DeveloperActivity/u);
    assert.match(source, /title="Input"/u);
    assert.match(source, /title="Result"/u);
    assert.doesNotMatch(source, /模型推理文本|reasoningText|reasoningSummary/u);
  });
});
