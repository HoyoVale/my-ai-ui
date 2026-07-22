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

  it("waits for a committed model and selects it explicitly in E2E", () => {
    const topbar = read("../../src/Setting/components/Topbar.jsx");
    const e2e = read("../e2e/conversation-flow.cjs");

    assert.match(topbar, /data-testid="setting-save-status"/u);
    assert.match(topbar, /data-status=\{status\}/u);
    assert.match(e2e, /setting-save-status[^\n]*data-status="saved"/u);
    assert.match(e2e, /main-model-assignment[\s\S]*?Ollama · E2E Model/u);
    assert.match(e2e, /waitForConversationModel[\s\S]*?e2e-model/u);
    assert.match(e2e, /modelSnapshot[\s\S]*?modelId[\s\S]*?e2e-model/u);
  });

  it("keeps criterion actions readable and the Goal footer outside the scroll region", () => {
    const panel = read("../../src/Conversation/components/GoalPanel.jsx");
    const styles = read("../../src/Conversation/Conversation.css");

    assert.match(panel, /conversation-goal-criterion-status/u);
    assert.match(panel, /conversation-goal-actions conversation-goal-panel__footer/u);
    assert.match(styles, /\.conversation-goal-criterion-actions\s*\{[\s\S]*?min-width:\s*max-content/u);
    assert.match(styles, /\.conversation-goal-criteria-list button,[\s\S]*?white-space:\s*nowrap/u);
    assert.match(styles, /\.conversation-goal-panel__footer\s*\{[\s\S]*?border-top:/u);
    assert.doesNotMatch(styles, /\.conversation-goal-criteria-list\s*>\s*div\s*>\s*span\s*\{/u);
  });
});
