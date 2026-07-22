import {
  readConversationTaskPanelSource,
  readConversationStyles
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

describe("Plan UI 2.0", () => {
  it("keeps the dock on root plan data and exposes plan adjustment state", () => {
    const dock = read(
      "../../src/Conversation/components/PlanDock.jsx"
    );
    const activity = read(
      "../../src/Conversation/utils/taskActivity.js"
    );

    assert.match(dock, /snapshot\.plan\.map/u);
    assert.match(dock, /计划已调整/u);
    assert.match(dock, /data-plan-revision/u);
    assert.doesNotMatch(dock, /subplans\.map/u);
    assert.match(activity, /normalizePlanStateForView/u);
    assert.match(activity, /planState\.rootItems/u);
    assert.match(activity, /activeSubplan/u);
  });

  it("renders internal subplans only inside developer diagnostics", () => {
    const taskPanel = readConversationTaskPanelSource();

    assert.match(taskPanel, /DeveloperPlanInspector/u);
    assert.match(taskPanel, /conversation-developer-subplans/u);
    assert.match(taskPanel, /仅开发者可见，不计入用户总计划进度/u);
  });

  it("provides reduced-motion-safe status transitions", () => {
    const css = readConversationStyles();

    assert.match(css, /conversation-plan-step-in/u);
    assert.match(css, /conversation-plan-check-in/u);
    assert.match(css, /conversation-plan-adjusted-in/u);
    assert.match(css, /reduce-motion \.conversation-plan-dock/u);
  });
});
