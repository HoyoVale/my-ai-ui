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

describe("shared task activity event source", () => {
  it("drives both the thinking timeline and task panel from activity events", () => {
    const list = read(
      "../../src/Conversation/components/MessageList.jsx"
    );
    const panel = read(
      "../../src/Conversation/components/TaskPanel.jsx"
    );
    const model = read(
      "../../src/Conversation/utils/taskActivity.js"
    );

    assert.match(list, /createActivitySnapshot/u);
    assert.match(list, /conversation-thinking-timeline/u);
    assert.match(panel, /createTaskSnapshot/u);
    assert.match(model, /source\.activity\.events/u);
    assert.match(model, /event\.type === "tool"/u);
    assert.match(model, /event\.type === "plan"/u);
  });

  it("keeps raw tool data behind the developer task panel", () => {
    const panel = read(
      "../../src/Conversation/components/TaskPanel.jsx"
    );

    assert.match(panel, /developerMode/u);
    assert.match(panel, /title="Result"/u);
    assert.match(panel, /title="Model output"/u);
    assert.match(panel, /结果已截断/u);
  });
});
