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

describe("compact plan dock", () => {
  it("renders the live plan as a bottom dock outside the message stream", () => {
    const conversation = read(
      "../../src/Conversation/Conversation.jsx"
    );
    const messageList = read(
      "../../src/Conversation/components/MessageList.jsx"
    );
    const dock = read(
      "../../src/Conversation/components/PlanDock.jsx"
    );

    assert.match(conversation, /<ConversationPlanDock/u);
    assert.match(conversation, /activity=\{currentLiveActivity\}/u);
    assert.match(dock, /conversation-plan-dock/u);
    assert.match(dock, /setCollapsed/u);
    assert.match(dock, /aria-expanded=\{!collapsed\}/u);
    assert.doesNotMatch(messageList, /PlanDashboard|conversation-plan-dashboard/u);
  });

  it("renders progress and all plan states in a manually collapsible panel", () => {
    const source = read(
      "../../src/Conversation/components/PlanDock.jsx"
    );
    const css = read(
      "../../src/Conversation/Conversation.css"
    );

    assert.match(source, /is-\$\{item\.status\}/u);
    assert.match(source, /status === "completed"/u);
    assert.match(source, /status === "in_progress"/u);
    assert.match(source, /\["blocked", "needs_input"\]\.includes\(status\)/u);
    assert.match(css, /conversation-plan-dock__progress/u);
    assert.match(css, /conversation-plan-dock\.is-collapsed/u);
    assert.match(css, /conversation-plan-dock__content/u);
    assert.match(css, /is-needs_input/u);
  });

  it("uses Tool manifest visibility instead of a duplicated tool-name filter", () => {
    const messageList = read(
      "../../src/Conversation/components/MessageList.jsx"
    );
    const taskPanel = read(
      "../../src/Conversation/components/TaskPanel.jsx"
    );

    assert.match(messageList, /isActivityEventVisible/u);
    assert.match(taskPanel, /isActivityEventVisible/u);
    assert.doesNotMatch(messageList, /"update_plan"/u);
    assert.doesNotMatch(taskPanel, /"update_plan"/u);
  });
});
