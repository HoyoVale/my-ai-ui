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
    const source = read(
      "../../src/Conversation/components/MessageList.jsx"
    );

    assert.doesNotMatch(source, /查看完整任务/u);
    assert.doesNotMatch(source, /resultSummary/u);
    assert.doesNotMatch(source, /describeToolTarget/u);
    assert.doesNotMatch(source, /message\.pendingQuestion[\s\S]*等待回复/u);
  });

  it("does not expose raw reasoning summaries in the normal timeline", () => {
    const source = read(
      "../../src/Conversation/components/MessageList.jsx"
    );

    assert.match(
      source,
      /"summary",[\s\S]*"question",[\s\S]*"batch",[\s\S]*"plan"/u
    );
  });
});
