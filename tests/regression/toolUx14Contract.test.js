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

describe("Tool UX 1.4 contract", () => {
  it("isolates the activity panel to one assistant message and run", () => {
    const model = read(
      "../../src/Conversation/utils/taskActivity.js"
    );
    const panel = read(
      "../../src/Conversation/components/TaskPanel.jsx"
    );

    assert.match(model, /return source \? \[source\] : \[\]/u);
    assert.match(model, /messageId:/u);
    assert.match(model, /runId:/u);
    assert.match(panel, /data-message-id/u);
    assert.match(panel, /data-run-id/u);
  });

  it("renders public commentary in chat and the activity timeline", () => {
    const list = read(
      "../../src/Conversation/components/MessageList.jsx"
    );
    const panel = read(
      "../../src/Conversation/components/TaskPanel.jsx"
    );

    assert.match(list, /event\.type === "commentary"/u);
    assert.match(list, /conversation-thinking-event--commentary/u);
    assert.match(panel, /event\.type === "commentary"/u);
    assert.match(panel, /conversation-activity-timeline__copy/u);
  });

  it("uses detailed display by default and developer mode for raw data", () => {
    const settings = read(
      "../../src/Setting/panels/ToolPanel.jsx"
    );
    const defaults = read(
      "../../electron/settings/defaultSettings.js"
    );
    const panel = read(
      "../../src/Conversation/components/TaskPanel.jsx"
    );

    assert.match(settings, /展示层级/u);
    assert.match(settings, />详细</u);
    assert.doesNotMatch(settings, /tool-display-detail/u);
    assert.match(defaults, /detailLevel: "detailed"/u);
    assert.match(panel, /developerMode &&/u);
    assert.match(panel, /title="Input"/u);
    assert.match(panel, /title="Result"/u);
  });
});
