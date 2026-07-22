import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";
import fs from "node:fs";

function read(path) {
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Goal UI contract", () => {
  it("exposes Goal controls in both Conversation and Input", () => {
    const topbar = read("../../src/Conversation/components/Topbar.jsx");
    const panel = read("../../src/Conversation/components/GoalPanel.jsx");
    const inputMenu = read("../../src/Input/components/ContextMenu.jsx");

    assert.match(topbar, /conversation-goal-toggle/u);
    assert.match(panel, /conversation-goal-objective/u);
    assert.match(panel, /conversation-goal-criteria/u);
    assert.match(panel, /conversation-goal-auto-continue/u);
    assert.match(panel, /conversation-goal-progress/u);
    assert.match(panel, /conversation-goal-pause/u);
    assert.match(panel, /conversation-goal-clear/u);
    assert.match(inputMenu, /input-context-goal/u);
    assert.match(inputMenu, /input-goal-objective/u);
    assert.match(inputMenu, /input-goal-criteria/u);
  });

  it("uses text input operations for editable font family fields in E2E", () => {
    const e2e = read("../e2e/conversation-flow.cjs");
    assert.match(e2e, /appearance-latin-font-family[\s\S]*?\.fill\("Georgia"\)/u);
    assert.match(e2e, /appearance-chinese-font-family[\s\S]*?\.fill\("Source Han Serif SC"\)/u);
  });
});
