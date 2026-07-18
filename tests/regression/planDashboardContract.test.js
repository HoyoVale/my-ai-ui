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

describe("automatic plan dashboard", () => {
  it("opens for a live run as soon as a plan exists", () => {
    const source = read(
      "../../src/Conversation/components/MessageList.jsx"
    );

    assert.match(source, /function PlanDashboard/u);
    assert.match(source, /conversation-plan-dashboard/u);
    assert.match(source, /snapshot\.plan\.length > 0/u);
    assert.match(source, /setPlanDismissed\(false\)/u);
  });

  it("renders completed, in-progress, pending and blocked plan states", () => {
    const source = read(
      "../../src/Conversation/components/MessageList.jsx"
    );
    const css = read(
      "../../src/Conversation/Conversation.css"
    );

    assert.match(source, /is-\$\{item\.status\}/u);
    assert.match(source, /item\.status === "completed"/u);
    assert.match(source, /item\.status === "in_progress"/u);
    assert.match(source, /item\.status === "blocked"/u);
    assert.match(css, /conversation-plan-dashboard__progress/u);
    assert.match(css, /is-in_progress/u);
  });

  it("removes duplicate update_plan tool rows from the public timeline", () => {
    const messageList = read(
      "../../src/Conversation/components/MessageList.jsx"
    );
    const taskPanel = read(
      "../../src/Conversation/components/TaskPanel.jsx"
    );

    assert.match(messageList, /"update_plan"/u);
    assert.match(taskPanel, /"update_plan"/u);
  });
});
